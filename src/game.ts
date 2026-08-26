import { Engine } from './engine/engine.js';
import { createUi, type Ui } from './ui/render.js';
import { createHitSound, type HitSound } from './ui/sound.js';
import { HIT_SOUND_SRC, preloadResultImages } from './sprites.js';
import type { Beatmap, TimeSource } from './engine/types.js';

export interface GameHandle {
  engine: Engine;
  ui: Ui;
  /** Ta sama instancja, ktora gra przy trafieniu — tryb dev testuje przez nia
      dokladnie te sama sciezke odtwarzania, bez drugiej puli obok. */
  sound: HitSound;
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
  options: {
    onStart?: () => void;
    now?: () => number;
    sound?: HitSound;
    /** Aktualna glosnosc playera, 0–1 — skaluje dzwiek trafienia (ADR-0013). */
    getReferenceVolume?: () => number;
  } = {},
): GameHandle {
  const engine = new Engine(beatmap, timeSource, options.now);
  const sound =
    options.sound ?? createHitSound(HIT_SOUND_SRC, { getReferenceVolume: options.getReferenceVolume });
  // Plik klapsa leci do pamieci juz teraz, przed bramka startowa — tak jak
  // sprite'y (ADR-0017). Bez tego pobranie startowaloby dopiero w `unlock()`
  // i pierwsze trafienie moglo wypasc, zanim bufor bedzie gotowy.
  sound.prefetch();
  const ui = createUi(root, {
    onStart: () => {
      // Wewnatrz gestu uzytkownika: `AudioContext` rodzi sie `suspended`
      // i tylko gest pozwala go wznowic (ADR-0017).
      sound.unlock();
      // Grafiki ekranu wyniku dopiero teraz — przed startem nie moga
      // konkurowac o pasmo z buforowaniem wideo (ADR-0025).
      preloadResultImages();
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
  return { engine, ui, sound, frame };
}
