import { Engine } from './engine/engine.js';
import { createUi, type Ui } from './ui/render.js';
import type { Beatmap, TimeSource } from './engine/types.js';

export interface GameHandle {
  engine: Engine;
  ui: Ui;
  /** Jedna klatka: odczyt czasu -> aktualizacja stanu -> render. */
  frame(): void;
}

/**
 * Spina silnik z warstwa DOM. Nie uruchamia petli ani nie zna YouTube — dzieki
 * temu test smoke montuje dokladnie te sama gre na wstrzyknietym zrodle czasu.
 */
export function mountGame(
  root: HTMLElement,
  beatmap: Beatmap,
  timeSource: TimeSource,
  options: { onStart?: () => void; now?: () => number } = {},
): GameHandle {
  const engine = new Engine(beatmap, timeSource, options.now);
  const ui = createUi(root, {
    onStart: () => {
      ui.hideGate();
      options.onStart?.();
    },
    onHit: (objectId) => {
      engine.hit(objectId);
      ui.render(engine.getView());
    },
  });

  const frame = (): void => {
    engine.tick();
    ui.render(engine.getView());
  };

  frame();
  return { engine, ui, frame };
}
