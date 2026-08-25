// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPlayer } from '../src/ui/youtube.js';

/**
 * Atrapa window.YT.Player: zapamietuje opcje konstrukcyjne i wola onReady
 * synchronicznie, zeby createPlayer() od razu sie rozstrzygal (ADR-0019).
 */
class FakePlayer {
  static lastOptions: unknown;
  static lastInstance: FakePlayer;

  playVideo = vi.fn();
  pauseVideo = vi.fn();
  getVolume = vi.fn(() => 80);
  isMuted = vi.fn(() => false);
  mute = vi.fn();
  unMute = vi.fn();
  setVolume = vi.fn();
  getCurrentTime = vi.fn(() => 0);
  getPlayerState = vi.fn(() => 1);
  getPlaybackRate = vi.fn(() => 1);
  setPlaybackRate = vi.fn();
  getAvailablePlaybackRates = vi.fn(() => [1]);
  getDuration = vi.fn(() => 42);
  seekTo = vi.fn();

  constructor(
    _element: HTMLElement,
    options: { videoId: string; playerVars: Record<string, number>; events: { onReady: () => void } },
  ) {
    FakePlayer.lastOptions = options;
    FakePlayer.lastInstance = this;
    // Prawdziwe IFrame API wola onReady asynchronicznie (po zaladowaniu
    // odtwarzacza) — synchroniczne wywolanie tu odslonieloby `instance`
    // przed przypisaniem w createPlayer().
    queueMicrotask(() => options.events.onReady());
  }
}

function installFakeYT(): void {
  (window as unknown as { YT: unknown }).YT = { Player: FakePlayer };
}

describe('createPlayer — adapter YouTube IFrame API (ADR-0019)', () => {
  afterEach(() => {
    delete (window as unknown as { YT?: unknown }).YT;
  });

  it('wylacza kontrolki i klawiature playera w playerVars', async () => {
    installFakeYT();
    const host = document.createElement('div');

    await createPlayer(host, 'abc123');

    const options = FakePlayer.lastOptions as { playerVars: Record<string, number> };
    expect(options.playerVars.controls).toBe(0);
    expect(options.playerVars.disablekb).toBe(1);
    expect(options.playerVars.fs).toBe(0);
    expect(options.playerVars.playsinline).toBe(1);
    expect(options.playerVars.rel).toBe(0);
  });

  it('setMuted(false) wola unMute() i setVolume(100)', async () => {
    installFakeYT();
    const host = document.createElement('div');

    const player = await createPlayer(host, 'abc123');
    player.setMuted(false);

    expect(FakePlayer.lastInstance.unMute).toHaveBeenCalledTimes(1);
    expect(FakePlayer.lastInstance.setVolume).toHaveBeenCalledWith(100);
    expect(FakePlayer.lastInstance.mute).not.toHaveBeenCalled();
  });

  it('setMuted(true) wola mute()', async () => {
    installFakeYT();
    const host = document.createElement('div');

    const player = await createPlayer(host, 'abc123');
    player.setMuted(true);

    expect(FakePlayer.lastInstance.mute).toHaveBeenCalledTimes(1);
    expect(FakePlayer.lastInstance.unMute).not.toHaveBeenCalled();
  });

  it('isMuted() proxuje na player.isMuted()', async () => {
    installFakeYT();
    const host = document.createElement('div');

    const player = await createPlayer(host, 'abc123');
    FakePlayer.lastInstance.isMuted = vi.fn(() => true);

    expect(player.isMuted()).toBe(true);
  });

  it('seekTo(sec) proxuje na player.seekTo(sec, true) — absolutny seek', async () => {
    installFakeYT();
    const host = document.createElement('div');

    const player = await createPlayer(host, 'abc123');
    player.seekTo(12.5);

    expect(FakePlayer.lastInstance.seekTo).toHaveBeenCalledWith(12.5, true);
  });

  it('getDuration() proxuje na player.getDuration()', async () => {
    installFakeYT();
    const host = document.createElement('div');

    const player = await createPlayer(host, 'abc123');

    expect(player.getDuration()).toBe(42);
  });
});
