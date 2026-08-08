import { Engine } from './engine/engine.js';
import { createUi, type Ui } from './ui/render.js';
import { createHitSound, type HitSound } from './ui/sound.js';
import { HIT_SOUND_SRC } from './sprites.js';
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
  options: { onStart?: () => void; now?: () => number; sound?: HitSound } = {},
): GameHandle {
  const engine = new Engine(beatmap, timeSource, options.now);
  const sound = options.sound ?? createHitSound(HIT_SOUND_SRC);
  const ui = createUi(root, {
    onStart: () => {
      // Wewnatrz gestu uzytkownika: iOS/WebKit odblokowuje konkretny element
      // <audio>, na ktorym padlo play() w tym gescie — nie strone (ADR-0011).
      sound.unlock();
      ui.hideGate();
      options.onStart?.();
    },
    onHit: (objectId) => {
      if (engine.hit(objectId)) sound.play();
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
