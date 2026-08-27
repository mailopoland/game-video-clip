import { Engine } from './engine/engine.js';
import { createUi, type Ui } from './ui/render.js';
import { createHitSound, type HitSound } from './ui/sound.js';
import { HIT_SOUND_SRC, preloadResultImage } from './sprites.js';
import { resultImageSrc, resultPercent, shouldPrefetchResult } from './ui/result-image.js';
import type { Beatmap, GameView, TimeSource } from './engine/types.js';

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
 * Ile sekund przed ekranem wyniku zaczynamy sciagac jego grafike (ADR-0027).
 * Na tyle wczesnie, zeby plik zdazyl dojsc, i na tyle pozno, zeby wynik byl juz
 * praktycznie ustalony — czyli zeby poszedl jeden plik zamiast szesciu.
 */
export const RESULT_PREFETCH_LEAD_SEC = 15;

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
    /** Ten sam `GameView`, ktory poszedl do DOM — obserwator po renderze.
        Uzywane przez telemetrie (ADR-0026); spoiwo nie wie, kto slucha. */
    onFrame?: (view: GameView) => void;
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
      ui.hideGate();
      options.onStart?.();
    },
    onHit: (objectId) => {
      if (engine.hit(objectId)) sound.play();
      ui.render(engine.getView());
    },
  });

  // Grafika ekranu wyniku: jedna, a nie szesc (ADR-0027). Kubelek liczymy z tego
  // samego `resultPercent`, ktorego uzywa renderer, wiec pobrany plik to dokladnie
  // ten, ktory zaraz zobaczy gracz. Bez stanu w rejestrze assetow — pamietamy tu,
  // co juz poszlo, zeby `frame()` nie zamawial tego samego pliku 60 razy na sekunde.
  let prefetchedResultSrc: string | null = null;

  const prefetchResultImage = (view: GameView): void => {
    if (!shouldPrefetchResult(view.timeSec, beatmap.endScreenAtSec, RESULT_PREFETCH_LEAD_SEC)) return;
    const src = resultImageSrc(resultPercent(view.stats.hits, view.stats.total));
    if (src === prefetchedResultSrc) return;
    prefetchedResultSrc = src;
    preloadResultImage(src);
  };

  const frame = (): void => {
    engine.tick();
    const view = engine.getView();
    ui.render(view);
    prefetchResultImage(view);
    options.onFrame?.(view);
  };

  frame();
  return { engine, ui, sound, frame };
}
