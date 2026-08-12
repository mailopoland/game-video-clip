// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mountGame } from '../src/game.js';
import { mountDevRecorder } from '../src/dev/recorder.js';
import { createBeatmapStore } from '../src/dev/beatmap-store.js';
import { validateBeatmap } from '../src/engine/beatmap.js';
import { SPRITE_KEYS } from '../src/sprites.js';
import { FakeClock, makeBeatmap, obj } from './fake-clock.js';
import type { Beatmap } from '../src/engine/types.js';

function fire(
  target: EventTarget,
  type: string,
  opts: { clientX?: number; clientY?: number; button?: number } = {},
): MouseEvent {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: opts.clientX ?? 0,
    clientY: opts.clientY ?? 0,
    button: opts.button ?? 0,
  });
  target.dispatchEvent(event);
  return event;
}

function playTo(clock: FakeClock, frame: () => void, targetSec: number): void {
  while (clock.timeSec < targetSec - 1e-9) {
    clock.advance(Math.min(0.016, targetSec - clock.timeSec));
    frame();
  }
}

describe('tryb deweloperski nagrywania sciezki (ADR-0016)', () => {
  let root: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    root = document.querySelector<HTMLElement>('#app')!;
  });

  function setup(objects: Beatmap['objects'] = [obj('o1', 10)]) {
    const clock = new FakeClock();
    const beatmap = makeBeatmap(objects, 999);
    const game = mountGame(root, beatmap, clock, { now: clock.now });
    const store = createBeatmapStore(beatmap);

    // jsdom nie liczy layoutu — podstawiamy rect dla .overlay (400x200, w rogu 0,0).
    game.ui.overlay.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 400,
        height: 200,
        right: 400,
        bottom: 200,
        x: 0,
        y: 0,
        toJSON: () => undefined,
      }) as DOMRect;

    const setRate = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal('fetch', fetchMock);
    const pause = vi.fn();
    const play = vi.fn();
    const playHitSound = vi.fn();
    const describeHitSound = vi.fn().mockReturnValue('graf=nie blad=brak');
    const onActiveChange = vi.fn();

    const dev = mountDevRecorder({
      ui: game.ui,
      engine: game.engine,
      store,
      getRate: () => 1,
      setRate,
      getAvailableRates: () => [0.25, 0.5, 1],
      seekBy: () => {},
      pause,
      play,
      playHitSound,
      describeHitSound,
      onActiveChange,
    });

    const checkbox = root.querySelector<HTMLInputElement>('#dev-toggle')!;
    return {
      clock,
      game,
      dev,
      checkbox,
      setRate,
      fetchMock,
      pause,
      play,
      playHitSound,
      describeHitSound,
      onActiveChange,
    };
  }

  function activate(checkbox: HTMLInputElement): void {
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
  }

  it('zaznaczenie checkboxa ustawia najnizsze dostepne tempo, odznaczenie wraca do 1x', () => {
    const { checkbox, setRate } = setup();

    activate(checkbox);
    expect(setRate).toHaveBeenLastCalledWith(0.25);

    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));
    expect(setRate).toHaveBeenLastCalledWith(1);
  });

  it('aktywacja trybu przelacza .overlay na pointer-events: auto, zeby prawy-drag na pustym miejscu nie spadal do iframe YouTube pod spodem', () => {
    const { game, checkbox } = setup();

    expect(game.ui.overlay.classList.contains('dev-active')).toBe(false);

    activate(checkbox);
    expect(game.ui.overlay.classList.contains('dev-active')).toBe(true);

    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));
    expect(game.ui.overlay.classList.contains('dev-active')).toBe(false);
  });

  it('prawy-drag przez kilka klatek tworzy obiekt o rosnacych t; wynik przechodzi walidacje i trafia do fetch', async () => {
    const { clock, game, dev, checkbox, fetchMock } = setup([]);
    activate(checkbox);

    // Kroki dluzsze niz MIN_PATH_SEC (0.25s), zeby sciezka nie zostala potraktowana
    // jako bardzo krotki klik i dosyntetyzowana do statycznego punktu.
    fire(game.ui.stage, 'pointerdown', { button: 2, clientX: 40, clientY: 20 });
    dev.onFrame();
    clock.advance(0.15);
    game.frame();

    fire(game.ui.stage, 'pointermove', { clientX: 80, clientY: 40 });
    dev.onFrame();
    clock.advance(0.15);
    game.frame();

    fire(game.ui.stage, 'pointermove', { clientX: 120, clientY: 60 });
    dev.onFrame();

    fire(game.ui.stage, 'pointerup');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, requestInit] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/__beatmap');
    const sentBeatmap = JSON.parse((requestInit as RequestInit).body as string) as Beatmap;

    expect(() => validateBeatmap(sentBeatmap, SPRITE_KEYS)).not.toThrow();
    expect(sentBeatmap.objects).toHaveLength(1);
    const path = sentBeatmap.objects[0]!.path;
    expect(path.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < path.length; i++) {
      expect(path[i]!.t).toBeGreaterThan(path[i - 1]!.t);
    }
    // Pozycja startowa odpowiada pierwszemu klikniеciu: clientX=40 na rect szer. 400 -> 10%.
    expect(path[0]!.x).toBeCloseTo(10, 6);
    expect(path[0]!.y).toBeCloseTo(10, 6);
  });

  it('podglad reki jest w DOM w trakcie nagrania i znika po pointerup', () => {
    const { clock, game, dev, checkbox } = setup([]);
    activate(checkbox);

    expect(game.ui.overlay.querySelector('.obj.is-preview')).toBeNull();

    fire(game.ui.stage, 'pointerdown', { button: 2, clientX: 40, clientY: 20 });
    dev.onFrame();
    expect(game.ui.overlay.querySelector('.obj.is-preview')).not.toBeNull();

    clock.advance(0.05);
    game.frame();
    fire(game.ui.stage, 'pointerup');

    expect(game.ui.overlay.querySelector('.obj.is-preview')).toBeNull();
  });

  it('prawy klik w istniejacy obiekt usuwa go, nie startuje nagrania i nie daje punktu', () => {
    const { clock, game, dev, checkbox, fetchMock } = setup([obj('o1', 10)]);
    activate(checkbox);

    playTo(clock, game.frame, 10.0);
    const target = root.querySelector<HTMLElement>('.obj[data-id="o1"]')!;
    expect(target).not.toBeNull();

    fire(target, 'pointerdown', { button: 2, clientX: 50, clientY: 50 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    game.frame();
    expect(root.querySelector('.obj[data-id="o1"]')).toBeNull();

    // Drag po tym samym gescie nie tworzy nowego obiektu (recording sie nie zaczal).
    fire(game.ui.stage, 'pointermove', { clientX: 90, clientY: 90 });
    dev.onFrame();
    fire(game.ui.stage, 'pointerup');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(game.ui.overlay.querySelector('.obj.is-preview')).toBeNull();
    expect(game.engine.getStats()).toMatchObject({ score: 0, hits: 0 });
  });

  it('lewy klik nadal trafia — brak regresji na button !== 0', () => {
    const { clock, game, checkbox } = setup([obj('o1', 10)]);
    activate(checkbox);

    playTo(clock, game.frame, 10.0);
    const target = root.querySelector<HTMLElement>('.obj[data-id="o1"]')!;
    fire(target, 'pointerdown', { button: 0 });

    expect(target.classList.contains('is-hit')).toBe(true);
    expect(game.engine.getStats().hits).toBe(1);
  });

  it('Stop/Play wywoluja pause/play playera', () => {
    const { pause, play } = setup();

    root.querySelector<HTMLButtonElement>('#dev-stop')!.click();
    expect(pause).toHaveBeenCalledTimes(1);

    root.querySelector<HTMLButtonElement>('#dev-play')!.click();
    expect(play).toHaveBeenCalledTimes(1);
  });

  // Guzik diagnostyczny dla iOS: te sama sciezke co trafienie w reke da sie
  // wywolac bez trafiania w ruchomy cel, a wynik laduje w pasku
  // statusu — na iPhonie nie ma jak odczytac console.warn.
  it('Test dzwieku odtwarza klaps i wypisuje diagnostyke w pasku statusu', () => {
    vi.useFakeTimers();
    try {
      const { playHitSound, describeHitSound } = setup();

      root.querySelector<HTMLButtonElement>('#dev-sound')!.click();
      expect(playHitSound).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(400);
      expect(describeHitSound).toHaveBeenCalledTimes(1);
      expect(root.querySelector('#dev-status')!.textContent).toContain('graf=nie blad=brak');
    } finally {
      vi.useRealTimers();
    }
  });

  it('Test dzwieku dziala niezaleznie od checkboxa trybu dev', () => {
    const { checkbox, playHitSound } = setup();
    expect(checkbox.checked).toBe(false);

    root.querySelector<HTMLButtonElement>('#dev-sound')!.click();
    expect(playHitSound).toHaveBeenCalledTimes(1);
  });

  it('Reload beatmap.json pobiera plik z dysku i podmienia obiekty w silniku', async () => {
    const { clock, game, fetchMock } = setup([obj('o1', 10)]);

    const freshBeatmap = makeBeatmap([obj('o2', 20)], 999);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve(freshBeatmap),
    });

    root.querySelector<HTMLButtonElement>('#dev-reload')!.click();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchMock).toHaveBeenLastCalledWith('/src/data/beatmap.json');

    clock.seekTo(20);
    game.frame();
    expect(game.engine.getView().visible.map((v) => v.object.id)).toEqual(['o2']);
  });

  it('contextmenu jest preventDefault tylko przy aktywnym trybie dev', () => {
    const { checkbox } = setup([]);

    const before = fire(document.querySelector<HTMLElement>('#stage')!, 'contextmenu');
    expect(before.defaultPrevented).toBe(false);

    activate(checkbox);
    const after = fire(document.querySelector<HTMLElement>('#stage')!, 'contextmenu');
    expect(after.defaultPrevented).toBe(true);
  });

  it('onActiveChange jest wywolywane z true przy aktywacji i z false przy deaktywacji checkboxem', () => {
    const { checkbox, onActiveChange } = setup();

    activate(checkbox);
    expect(onActiveChange).toHaveBeenLastCalledWith(true);

    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));
    expect(onActiveChange).toHaveBeenLastCalledWith(false);
  });

  it('deactivate() odznacza checkbox, przerywa trwajace nagranie, chowa podglad i wywoluje onActiveChange(false)', () => {
    const { game, dev, checkbox, onActiveChange } = setup([]);
    activate(checkbox);
    onActiveChange.mockClear();

    fire(game.ui.stage, 'pointerdown', { button: 2, clientX: 40, clientY: 20 });
    dev.onFrame();
    expect(game.ui.overlay.querySelector('.obj.is-preview')).not.toBeNull();

    dev.deactivate();

    expect(checkbox.checked).toBe(false);
    expect(game.ui.overlay.classList.contains('dev-active')).toBe(false);
    expect(game.ui.overlay.querySelector('.obj.is-preview')).toBeNull();
    expect(onActiveChange).toHaveBeenCalledTimes(1);
    expect(onActiveChange).toHaveBeenLastCalledWith(false);

    // pointerup po deaktywacji nie powinien nic dosypywac (nagranie juz przerwane).
    fire(game.ui.stage, 'pointerup');
    expect(game.ui.overlay.querySelector('.obj.is-preview')).toBeNull();
  });

  it('deactivate() jest idempotentne — powtorne wywolanie gdy tryb juz nieaktywny nie robi nic', () => {
    const { dev, checkbox, onActiveChange } = setup();
    activate(checkbox);
    onActiveChange.mockClear();

    dev.deactivate();
    expect(onActiveChange).toHaveBeenCalledTimes(1);
    expect(onActiveChange).toHaveBeenLastCalledWith(false);

    dev.deactivate();
    expect(onActiveChange).toHaveBeenCalledTimes(1);
  });

  it('setDisabled(true) ustawia checkbox.disabled, setDisabled(false) je zdejmuje', () => {
    const { dev, checkbox } = setup();

    expect(checkbox.disabled).toBe(false);

    dev.setDisabled(true);
    expect(checkbox.disabled).toBe(true);

    dev.setDisabled(false);
    expect(checkbox.disabled).toBe(false);
  });
});
