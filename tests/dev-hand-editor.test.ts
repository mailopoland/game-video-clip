// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createUi } from '../src/ui/render.js';
import { mountGame } from '../src/game.js';
import { mountDevHandEditor } from '../src/dev/hand-editor.js';
import { createBeatmapStore } from '../src/dev/beatmap-store.js';
import { validateBeatmap } from '../src/engine/beatmap.js';
import { formatClock } from '../src/dev/record.js';
import { SPRITE_KEYS } from '../src/sprites.js';
import { FakeClock, makeBeatmap } from './fake-clock.js';
import type { Beatmap } from '../src/engine/types.js';

describe('dev-edit-hand: Ui.setHandSelection', () => {
  let root: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    root = document.querySelector<HTMLElement>('#app')!;
  });

  it('tworzy .dev-selection-ring z uchwytem rozmiaru i poprawna pozycja', () => {
    const ui = createUi(root, { onStart: () => {}, onHit: () => {} });

    ui.setHandSelection({ x: 30, y: 40, size: 50 });

    const ring = ui.overlay.querySelector<HTMLElement>('.dev-selection-ring');
    expect(ring).not.toBeNull();
    expect(ring!.style.left).toBe('30%');
    expect(ring!.style.top).toBe('40%');
    expect(ring!.style.width).toBe(`${(16 * 50) / 100}%`);
    expect(ring!.querySelector('.dev-size-handle')).not.toBeNull();
  });

  it('aktualizuje istniejacy element zamiast tworzyc duplikat', () => {
    const ui = createUi(root, { onStart: () => {}, onHit: () => {} });

    ui.setHandSelection({ x: 10, y: 10, size: 20 });
    ui.setHandSelection({ x: 60, y: 70, size: 80 });

    const rings = ui.overlay.querySelectorAll('.dev-selection-ring');
    expect(rings.length).toBe(1);
    const ring = rings[0] as HTMLElement;
    expect(ring.style.left).toBe('60%');
    expect(ring.style.top).toBe('70%');
    expect(ring.style.width).toBe(`${(16 * 80) / 100}%`);
  });

  it('usuwa element, gdy przekazane jest null', () => {
    const ui = createUi(root, { onStart: () => {}, onHit: () => {} });

    ui.setHandSelection({ x: 10, y: 10, size: 20 });
    expect(ui.overlay.querySelector('.dev-selection-ring')).not.toBeNull();

    ui.setHandSelection(null);
    expect(ui.overlay.querySelector('.dev-selection-ring')).toBeNull();
  });
});

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

/** Odtwarza do `targetSec`, po czym pauzuje (frozen=true) — interakcje edytora
    dzialaja tylko przy zamrozonym silniku. */
function pauseAt(clock: FakeClock, frame: () => void, targetSec: number): void {
  playTo(clock, frame, targetSec);
  clock.playing = false;
  frame();
}

describe('tryb deweloperski edycji punktow sciezki (dev-edit-hand)', () => {
  let root: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    root = document.querySelector<HTMLElement>('#app')!;
  });

  function movingObj(id: string, t0: number): Beatmap['objects'][number] {
    return {
      id,
      sprite: 'hand',
      path: [
        { t: t0, x: 20, y: 20, size: 100 },
        { t: t0 + 1, x: 80, y: 80, size: 100 },
      ],
    };
  }

  function setup(objects: Beatmap['objects'] = [movingObj('o1', 10)]) {
    const clock = new FakeClock();
    const beatmap = makeBeatmap(objects, 999);
    const game = mountGame(root, beatmap, clock, { now: clock.now });
    const store = createBeatmapStore(beatmap);

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

    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal('fetch', fetchMock);
    const pause = vi.fn();
    const seekBy = vi.fn();
    const onActiveChange = vi.fn();

    const dev = mountDevHandEditor({
      ui: game.ui,
      engine: game.engine,
      store,
      seekBy,
      pause,
      onActiveChange,
    });

    const checkbox = root.querySelector<HTMLInputElement>('#dev-edit-hand-toggle')!;
    return { clock, game, dev, checkbox, store, fetchMock, pause, seekBy, onActiveChange };
  }

  function activate(checkbox: HTMLInputElement): void {
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
  }

  function selectPointOne(): void {
    const button = root.querySelector<HTMLElement>('.dev-edit-point[data-index="1"] .dev-edit-point-seek')!;
    fire(button, 'click');
  }

  function fieldInput(index: number, field: 't' | 'x' | 'y' | 'size'): HTMLInputElement {
    return root.querySelector<HTMLInputElement>(
      `.dev-edit-point[data-index="${index}"] .dev-edit-point-${field}`,
    )!;
  }

  function setFieldAndCommit(input: HTMLInputElement, value: string): void {
    input.value = value;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  it('aktywacja wywoluje pause() dokladnie raz', () => {
    const { checkbox, pause } = setup();
    activate(checkbox);
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it('lewy klik na obiekcie (przy pauzie) pokazuje pierscien i panel z jednym <li> na punkt sciezki', () => {
    const { clock, game, dev, checkbox } = setup();
    activate(checkbox);
    pauseAt(clock, game.frame, 10.0);

    const target = root.querySelector<HTMLElement>('.obj[data-id="o1"]')!;
    fire(target, 'pointerdown', { button: 0 });
    dev.onFrame();

    expect(game.ui.overlay.querySelector('.dev-selection-ring')).not.toBeNull();
    const panel = root.querySelector<HTMLElement>('.dev-edit-panel')!;
    expect(panel.hidden).toBe(false);
    const items = panel.querySelectorAll<HTMLElement>('.dev-edit-point');
    expect(items.length).toBe(2);
    const path = game.engine.getView().visible.find((v) => v.object.id === 'o1')!.object.path;
    expect(fieldInput(0, 't').value).toBe(String(path[0]!.t));
    expect(fieldInput(0, 'x').value).toBe(String(path[0]!.x));
    expect(fieldInput(0, 'y').value).toBe(String(path[0]!.y));
    expect(fieldInput(0, 'size').value).toBe(String(path[0]!.size));
    expect(fieldInput(1, 't').value).toBe(String(path[1]!.t));
  });

  it('pokazuje aktualny czas wideo w formacie M:ss.mm tylko gdy tryb jest aktywny', () => {
    const { clock, game, dev, checkbox } = setup();

    clock.timeSec = 71.234;
    game.frame();
    dev.onFrame();
    let display = root.querySelector<HTMLElement>('.dev-time-display')!;
    expect(display.hidden).toBe(true);

    activate(checkbox);
    pauseAt(clock, game.frame, 71.234);
    dev.onFrame();

    display = root.querySelector<HTMLElement>('.dev-time-display')!;
    expect(display.hidden).toBe(false);
    expect(display.textContent).toBe(formatClock(71.234));

    dev.deactivate();
    expect(display.hidden).toBe(true);
  });

  it('edycja pola x/y/size/t w panelu zapisuje sie natychmiast po zmianie (change)', () => {
    const { clock, game, checkbox, store } = setup();
    activate(checkbox);
    pauseAt(clock, game.frame, 10.0);

    const target = root.querySelector<HTMLElement>('.obj[data-id="o1"]')!;
    fire(target, 'pointerdown', { button: 0 });

    setFieldAndCommit(fieldInput(0, 'x'), '65');
    setFieldAndCommit(fieldInput(0, 'y'), '35');
    setFieldAndCommit(fieldInput(0, 'size'), '150');

    const updated = store.get().objects.find((o) => o.id === 'o1')!;
    expect(updated.path[0]).toEqual({ t: 10, x: 65, y: 35, size: 150 });
  });

  it('edycja pola t przesuwa punkt w czasie, jesli zachowuje rosnaca kolejnosc', () => {
    const { clock, game, checkbox, store } = setup();
    activate(checkbox);
    pauseAt(clock, game.frame, 10.0);

    const target = root.querySelector<HTMLElement>('.obj[data-id="o1"]')!;
    fire(target, 'pointerdown', { button: 0 });

    setFieldAndCommit(fieldInput(0, 't'), '10.5');

    const updated = store.get().objects.find((o) => o.id === 'o1')!;
    expect(updated.path[0]!.t).toBe(10.5);
  });

  it('edycja pola t naruszajaca rosnaca kolejnosc jest odrzucana i wiersz wraca do poprzedniej wartosci', () => {
    const { clock, game, checkbox, store } = setup();
    activate(checkbox);
    pauseAt(clock, game.frame, 10.0);

    const target = root.querySelector<HTMLElement>('.obj[data-id="o1"]')!;
    fire(target, 'pointerdown', { button: 0 });

    const before = JSON.parse(JSON.stringify(store.get())) as Beatmap;
    const input = fieldInput(0, 't');
    setFieldAndCommit(input, '20');

    expect(store.get()).toEqual(before);
    expect(input.value).toBe('10');
  });

  it('klik w wiersz panelu wola seekBy z dokladnie point.t - view.timeSec, zaznacza ten wiersz i tylko ten', () => {
    const { clock, game, checkbox, seekBy } = setup();
    activate(checkbox);
    pauseAt(clock, game.frame, 10.0);

    const target = root.querySelector<HTMLElement>('.obj[data-id="o1"]')!;
    fire(target, 'pointerdown', { button: 0 });

    const viewTime = game.engine.getView().timeSec;
    selectPointOne();

    expect(seekBy).toHaveBeenCalledWith(11 - viewTime);
    const items = root.querySelectorAll<HTMLElement>('.dev-edit-point');
    expect(items[1]!.classList.contains('is-selected')).toBe(true);
    expect(items[0]!.classList.contains('is-selected')).toBe(false);
  });

  it('przeciagniecie obiektu PRZED wybraniem punktu z listy jest no-opem', () => {
    const { clock, game, dev, checkbox, fetchMock, store } = setup();
    activate(checkbox);
    pauseAt(clock, game.frame, 10.0);

    const before = JSON.parse(JSON.stringify(store.get())) as Beatmap;
    const target = root.querySelector<HTMLElement>('.obj[data-id="o1"]')!;
    fire(target, 'pointerdown', { button: 0 });
    fire(game.ui.stage, 'pointermove', { clientX: 200, clientY: 100 });
    dev.onFrame();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(store.get()).toEqual(before);
  });

  it('przeciagniecie PO wybraniu punktu zmienia x/y wylacznie tego punktu', () => {
    const { clock, game, dev, checkbox, store } = setup();
    activate(checkbox);
    pauseAt(clock, game.frame, 10.0);

    const target = root.querySelector<HTMLElement>('.obj[data-id="o1"]')!;
    fire(target, 'pointerdown', { button: 0 });
    selectPointOne();

    fire(target, 'pointerdown', { button: 0 });
    fire(game.ui.stage, 'pointermove', { clientX: 200, clientY: 100 });
    dev.onFrame();

    const updated = store.get().objects.find((o) => o.id === 'o1')!;
    expect(updated.path[1]!.x).toBeCloseTo(50, 6);
    expect(updated.path[1]!.y).toBeCloseTo(50, 6);
    expect(updated.path[0]!).toEqual({ t: 10, x: 20, y: 20, size: 100 });
  });

  it('przeciagniecie uchwytu rozmiaru skaluje size proporcjonalnie do zmiany odleglosci', () => {
    const { clock, game, dev, checkbox, store } = setup();
    activate(checkbox);
    pauseAt(clock, game.frame, 10.0);

    const target = root.querySelector<HTMLElement>('.obj[data-id="o1"]')!;
    fire(target, 'pointerdown', { button: 0 });
    selectPointOne();

    // Zblizamy sie do t=11 (koniec sciezki), gdzie x=80,y=80 (-> 320px,160px na rect 400x200).
    clock.seekTo(11);
    game.frame();
    dev.onFrame();

    const handle = game.ui.overlay.querySelector<HTMLElement>('.dev-size-handle')!;
    fire(handle, 'pointerdown', { button: 0, clientX: 340, clientY: 180 });
    // Poczatkowa odleglosc D0 od centrum (320,160) do (340,180).
    fire(game.ui.stage, 'pointermove', { clientX: 360, clientY: 200 }); // 2x D0
    dev.onFrame();

    const updated = store.get().objects.find((o) => o.id === 'o1')!;
    expect(updated.path[1]!.size).toBeCloseTo(200, 0);
  });

  it('brak interakcji (brak pierscienia, brak efektu dragu), gdy silnik nie jest zamrozony (odtwarzanie)', () => {
    const { clock, game, checkbox } = setup();
    activate(checkbox);
    clock.playing = true;
    clock.timeSec = 10.0;
    game.frame();
    expect(game.engine.getView().frozen).toBe(false);

    const target = root.querySelector<HTMLElement>('.obj[data-id="o1"]');
    if (target) fire(target, 'pointerdown', { button: 0 });

    expect(game.ui.overlay.querySelector('.dev-selection-ring')).toBeNull();
  });

  it('kazdy zapisany payload przechodzi validateBeatmap', () => {
    const { clock, game, dev, checkbox, fetchMock } = setup();
    activate(checkbox);
    pauseAt(clock, game.frame, 10.0);

    const target = root.querySelector<HTMLElement>('.obj[data-id="o1"]')!;
    fire(target, 'pointerdown', { button: 0 });
    selectPointOne();
    fire(target, 'pointerdown', { button: 0 });
    fire(game.ui.stage, 'pointermove', { clientX: 250, clientY: 120 });
    dev.onFrame();
    fire(game.ui.stage, 'pointerup');
    dev.onFrame();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, requestInit] = fetchMock.mock.calls[0]!;
    const payload = JSON.parse((requestInit as RequestInit).body as string) as Beatmap;
    expect(() => validateBeatmap(payload, SPRITE_KEYS)).not.toThrow();
  });

  it('klik na pustym miejscu chowa panel i usuwa pierscien', () => {
    const { clock, game, dev, checkbox } = setup();
    activate(checkbox);
    pauseAt(clock, game.frame, 10.0);

    const target = root.querySelector<HTMLElement>('.obj[data-id="o1"]')!;
    fire(target, 'pointerdown', { button: 0 });
    dev.onFrame();
    expect(game.ui.overlay.querySelector('.dev-selection-ring')).not.toBeNull();

    fire(game.ui.stage, 'pointerdown', { button: 0, clientX: 5, clientY: 5 });
    expect(game.ui.overlay.querySelector('.dev-selection-ring')).toBeNull();
    expect(root.querySelector<HTMLElement>('.dev-edit-panel')!.hidden).toBe(true);
  });

  it('koalescencja zapisow: kilka pointermove przed jednym onFrame() -> co najwyzej jeden fetch; w trakcie nierozwiazanego fetch kolejne zmiany nie wywoluja drugiego', async () => {
    const { clock, game, dev, checkbox, fetchMock } = setup();
    activate(checkbox);
    pauseAt(clock, game.frame, 10.0);

    const target = root.querySelector<HTMLElement>('.obj[data-id="o1"]')!;
    fire(target, 'pointerdown', { button: 0 });
    selectPointOne();
    fire(target, 'pointerdown', { button: 0 });

    fire(game.ui.stage, 'pointermove', { clientX: 100, clientY: 50 });
    fire(game.ui.stage, 'pointermove', { clientX: 110, clientY: 60 });
    fire(game.ui.stage, 'pointermove', { clientX: 120, clientY: 70 });
    dev.onFrame();

    expect(fetchMock).toHaveBeenCalledTimes(1);

    // fetch wciaz "w locie" (mockResolvedValue rozwiazuje sie async, ale
    // sprawdzamy stan zaraz po wywolaniu, przed flush mikrotaskow).
    fire(game.ui.stage, 'pointermove', { clientX: 130, clientY: 80 });
    dev.onFrame();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    dev.onFrame();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
