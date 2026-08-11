// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mountGame } from '../src/game.js';
import { mountDevRecorder } from '../src/dev/recorder.js';
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

    const dev = mountDevRecorder({
      ui: game.ui,
      engine: game.engine,
      beatmap,
      getRate: () => 1,
      setRate,
      getAvailableRates: () => [0.25, 0.5, 1],
    });

    const checkbox = root.querySelector<HTMLInputElement>('#dev-toggle')!;
    return { clock, game, dev, checkbox, setRate, fetchMock };
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

  it('contextmenu jest preventDefault tylko przy aktywnym trybie dev', () => {
    const { checkbox } = setup([]);

    const before = fire(document.querySelector<HTMLElement>('#stage')!, 'contextmenu');
    expect(before.defaultPrevented).toBe(false);

    activate(checkbox);
    const after = fire(document.querySelector<HTMLElement>('#stage')!, 'contextmenu');
    expect(after.defaultPrevented).toBe(true);
  });
});
