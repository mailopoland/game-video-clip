// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mountGame } from '../src/game.js';
import { mountDevRecorder } from '../src/dev/recorder.js';
import { mountDevHandEditor, type DevHandEditorHandle } from '../src/dev/hand-editor.js';
import { createBeatmapStore } from '../src/dev/beatmap-store.js';
import { FakeClock, makeBeatmap } from './fake-clock.js';
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

function pauseAt(clock: FakeClock, frame: () => void, targetSec: number): void {
  playTo(clock, frame, targetSec);
  clock.playing = false;
  frame();
}

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

describe('wyluczajaca sie aktywacja trybow dev (nagrywanie / edycja punktow)', () => {
  let root: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    root = document.querySelector<HTMLElement>('#app')!;
  });

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
    const seekBy = vi.fn();
    const pause = vi.fn();
    const play = vi.fn();
    const setRate = vi.fn();

    let handEditor: DevHandEditorHandle | undefined;

    const recorder = mountDevRecorder({
      ui: game.ui,
      engine: game.engine,
      store,
      getRate: () => 1,
      setRate,
      getAvailableRates: () => [0.25, 0.5, 1],
      seekBy,
      pause,
      play,
      onActiveChange: (active) => {
        if (active) handEditor?.deactivate();
        handEditor?.setDisabled(active);
      },
    });

    handEditor = mountDevHandEditor({
      ui: game.ui,
      engine: game.engine,
      store,
      seekBy,
      pause,
      onActiveChange: (active) => {
        if (active) recorder.deactivate();
        recorder.setDisabled(active);
      },
    });

    const recorderCheckbox = root.querySelector<HTMLInputElement>('#dev-toggle')!;
    const editorCheckbox = root.querySelector<HTMLInputElement>('#dev-edit-hand-toggle')!;

    return { clock, game, store, recorder, handEditor, recorderCheckbox, editorCheckbox, fetchMock };
  }

  function activate(checkbox: HTMLInputElement): void {
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
  }

  it('aktywacja rekordera odznacza i blokuje checkbox edytora', () => {
    const { recorderCheckbox, editorCheckbox } = setup();

    activate(recorderCheckbox);

    expect(editorCheckbox.checked).toBe(false);
    expect(editorCheckbox.disabled).toBe(true);
  });

  it('aktywacja edytora odznacza i blokuje checkbox rekordera', () => {
    const { recorderCheckbox, editorCheckbox } = setup();

    activate(editorCheckbox);

    expect(recorderCheckbox.checked).toBe(false);
    expect(recorderCheckbox.disabled).toBe(true);
  });

  it('aktywacja rekordera w trakcie zaznaczenia w edytorze czysci pierscien i panel edytora', () => {
    const { clock, game, handEditor, recorderCheckbox, editorCheckbox } = setup();

    activate(editorCheckbox);
    pauseAt(clock, game.frame, 10.0);
    const target = root.querySelector<HTMLElement>('.obj[data-id="o1"]')!;
    fire(target, 'pointerdown', { button: 0 });
    handEditor?.onFrame();

    expect(game.ui.overlay.querySelector('.dev-selection-ring')).not.toBeNull();
    expect(root.querySelector<HTMLElement>('.dev-edit-panel')!.hidden).toBe(false);

    activate(recorderCheckbox);

    expect(game.ui.overlay.querySelector('.dev-selection-ring')).toBeNull();
    expect(root.querySelector<HTMLElement>('.dev-edit-panel')!.hidden).toBe(true);
  });

  it('aktywacja edytora w trakcie trwajacego nagrania w rekorderze czysci podglad reki', () => {
    const { clock, game, recorder, recorderCheckbox, editorCheckbox } = setup([]);

    activate(recorderCheckbox);
    fire(game.ui.stage, 'pointerdown', { button: 2, clientX: 40, clientY: 20 });
    recorder.onFrame();
    expect(game.ui.overlay.querySelector('.obj.is-preview')).not.toBeNull();

    activate(editorCheckbox);

    expect(game.ui.overlay.querySelector('.obj.is-preview')).toBeNull();
    void clock;
  });

  it('zmiany zrobione w trybie edycji sa widoczne przez store.get() po przelaczeniu na nagrywanie', () => {
    const { clock, game, store, recorderCheckbox, editorCheckbox } = setup();

    activate(editorCheckbox);
    pauseAt(clock, game.frame, 10.0);

    const target = root.querySelector<HTMLElement>('.obj[data-id="o1"]')!;
    fire(target, 'pointerdown', { button: 0 });
    const seekButton = root.querySelector<HTMLElement>('.dev-edit-point[data-index="1"] .dev-edit-point-seek')!;
    fire(seekButton, 'click');
    fire(target, 'pointerdown', { button: 0 });
    fire(game.ui.stage, 'pointermove', { clientX: 200, clientY: 100 });

    const updated = store.get().objects.find((o) => o.id === 'o1')!;
    expect(updated.path[1]!.x).toBeCloseTo(50, 6);
    expect(updated.path[1]!.y).toBeCloseTo(50, 6);

    activate(recorderCheckbox);

    const afterSwitch = store.get().objects.find((o) => o.id === 'o1')!;
    expect(afterSwitch.path[1]!.x).toBeCloseTo(50, 6);
    expect(afterSwitch.path[1]!.y).toBeCloseTo(50, 6);
  });
});
