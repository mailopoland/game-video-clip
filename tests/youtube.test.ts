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

describe('createPlayer — wykrywanie reklamy po dlugosci wideo (ADR-0022)', () => {
  afterEach(() => {
    delete (window as unknown as { YT?: unknown }).YT;
  });

  const withExpected = async (expectedDurationSec: number) => {
    installFakeYT();
    const player = await createPlayer(document.createElement('div'), 'abc123', expectedDurationSec);
    return { player, fake: FakePlayer.lastInstance };
  };

  it('zamraza gre, gdy getDuration() nie zgadza sie z dlugoscia z beatmapy', async () => {
    const { player, fake } = await withExpected(150);
    fake.getDuration = vi.fn(() => 30); // reklama
    fake.getCurrentTime = vi.fn(() => 12);

    expect(player.sample().playing).toBe(false);
  });

  it('nie podaje silnikowi czasu reklamy — trzyma ostatni czas tresci', async () => {
    const { player, fake } = await withExpected(150);
    fake.getDuration = vi.fn(() => 150);
    fake.getCurrentTime = vi.fn(() => 90); // tresc
    expect(player.sample().timeSec).toBe(90);

    fake.getDuration = vi.fn(() => 30); // wchodzi mid-roll
    fake.getCurrentTime = vi.fn(() => 5);

    expect(player.sample().timeSec).toBe(90);
  });

  it('wraca do normalnego odtwarzania, gdy dlugosc znow sie zgadza', async () => {
    const { player, fake } = await withExpected(150);
    fake.getDuration = vi.fn(() => 30);
    expect(player.sample().playing).toBe(false);

    fake.getDuration = vi.fn(() => 150.4); // w granicach tolerancji
    fake.getCurrentTime = vi.fn(() => 91);

    expect(player.sample()).toMatchObject({ playing: true, timeSec: 91 });
  });

  it('nie uznaje za reklame odczytu getDuration() === 0 (brak metadanych)', async () => {
    const { player, fake } = await withExpected(150);
    fake.getDuration = vi.fn(() => 0);

    expect(player.sample().playing).toBe(true);
  });

  it('bez podanej dlugosci detekcja jest wylaczona', async () => {
    installFakeYT();
    const player = await createPlayer(document.createElement('div'), 'abc123');
    FakePlayer.lastInstance.getDuration = vi.fn(() => 30);

    expect(player.sample().playing).toBe(true);
  });

  it('getDuration() zwraca dlugosc z beatmapy, zeby suwak nie skakal na reklamie', async () => {
    const { player, fake } = await withExpected(150);
    fake.getDuration = vi.fn(() => 30);

    expect(player.getDuration()).toBe(150);
  });
});
