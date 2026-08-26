// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPlayer, type PlayerHandle } from '../src/ui/youtube.js';

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

describe('createPlayer — zegar tresci kontra zegar reklamy (ADR-0024)', () => {
  afterEach(() => {
    delete (window as unknown as { YT?: unknown }).YT;
  });

  const setup = async (expectedDurationSec?: number) => {
    installFakeYT();
    const player = await createPlayer(document.createElement('div'), 'abc123', expectedDurationSec);
    return { player, fake: FakePlayer.lastInstance };
  };

  /** Reklama na iOS: state UNSTARTED, a getCurrentTime() odlicza czas kreacji. */
  const playAd = (fake: FakePlayer, adTimeSec: number): void => {
    fake.getPlayerState = vi.fn(() => -1);
    fake.getCurrentTime = vi.fn(() => adTimeSec);
  };

  /** Tresc uznajemy za rozpoczeta dopiero, gdy petla ja PROBKOWALA — tak samo
      jak w grze, gdzie stan poznajemy wylacznie przez `sample()`. */
  const playContent = (player: PlayerHandle, fake: FakePlayer, timeSec: number): void => {
    fake.getPlayerState = vi.fn(() => 1);
    fake.getCurrentTime = vi.fn(() => timeSec);
    player.sample();
  };

  it('pre-roll: nie wpuszcza zegara reklamy do silnika (czas zostaje na zerze)', async () => {
    const { player, fake } = await setup(150);
    playAd(fake, 4.3);

    expect(player.sample()).toMatchObject({ timeSec: 0, playing: false });
  });

  it('mid-roll: trzyma ostatni czas tresci, nie czas kreacji', async () => {
    const { player, fake } = await setup(150);
    playContent(player, fake, 90);
    expect(player.sample().timeSec).toBe(90);

    playAd(fake, 3);

    expect(player.sample()).toMatchObject({ timeSec: 90, playing: false });
  });

  it('po reklamie wraca do zegara tresci', async () => {
    const { player, fake } = await setup(150);
    playContent(player, fake, 12);
    playAd(fake, 5);
    expect(player.sample().timeSec).toBe(12);

    playContent(player, fake, 13);

    expect(player.sample()).toMatchObject({ timeSec: 13, playing: true });
  });

  it('pauza po starcie tresci nadal resynchronizuje (przewijanie suwakiem)', async () => {
    const { player, fake } = await setup(150);
    playContent(player, fake, 40);

    fake.getPlayerState = vi.fn(() => 2); // PAUSED
    fake.getCurrentTime = vi.fn(() => 80); // gracz przewinal suwakiem

    expect(player.sample()).toMatchObject({ timeSec: 80, playing: false });
  });

  it('koniec filmu nadal melduje ended', async () => {
    const { player, fake } = await setup(150);
    playContent(player, fake, 149);

    fake.getPlayerState = vi.fn(() => 0); // ENDED
    fake.getCurrentTime = vi.fn(() => 150);

    expect(player.sample()).toMatchObject({ ended: true, playing: false, timeSec: 150 });
  });

  it('sama rozbieznosc getDuration() nie zamraza juz gry (dur reklamy = dur filmu)', async () => {
    const { player, fake } = await setup(150);
    playContent(player, fake, 10);
    fake.getDuration = vi.fn(() => 30);

    expect(player.sample()).toMatchObject({ timeSec: 10, playing: true });
  });

  it('getDuration() zwraca dlugosc z beatmapy, zeby suwak byl stabilny', async () => {
    const { player, fake } = await setup(150);
    fake.getDuration = vi.fn(() => 30);

    expect(player.getDuration()).toBe(150);
  });

  it('bez videoDurationSec getDuration() proxuje na player', async () => {
    const { player } = await setup();

    expect(player.getDuration()).toBe(42);
  });
});
