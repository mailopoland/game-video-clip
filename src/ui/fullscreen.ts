/**
 * Pelny ekran calej ramki gry (ADR-0010).
 *
 * Przycisk pelnego ekranu YouTube rozszerza *element iframe*, ktory trafia do
 * top layer przegladarki — nad cala reszte dokumentu, poza zasiegiem z-index.
 * Warstwa gry, bramka i HUD sa rodzenstwem iframe'a, wiec znikaja pod nim,
 * a gra dalej tyka i zamienia niewidoczne cele w pudla.
 *
 * Dlatego: przycisk YT jest wylaczony (`fs: 0`), pelny ekran bierze `.frame`
 * (scena + HUD), a gdyby iframe mimo wszystko przejal pelny ekran (klawisz `f`,
 * dwuklik) — odbieramy mu go. Jesli odzyskanie sie nie uda, `onLost` pozwala
 * zatrzymac wideo, zeby silnik zamarzl zamiast naliczac pudla w ciemno.
 */

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

/**
 * `native` = Fullscreen API. `css` = tryb zastepczy dla iPhone'a, ktory tego API
 * nie ma wcale: ramka rozpycha sie na caly viewport (`position: fixed`), wiec
 * znika reszta strony, ale paski przegladarki zostaja. Prawdziwy pelny ekran na
 * iOS daje dopiero "Dodaj do ekranu poczatkowego" (manifest + meta w index.html).
 */
export type FullscreenMode = 'native' | 'css';

/** Klasa rozpychajaca ramke, gdy nie ma Fullscreen API. */
export const PSEUDO_FULLSCREEN_CLASS = 'is-pseudo-fullscreen';
/** Klasa na <html> blokujaca przewijanie tla w trybie zastepczym. */
export const PSEUDO_FULLSCREEN_ROOT_CLASS = 'has-pseudo-fullscreen';

export interface FullscreenController {
  readonly mode: FullscreenMode;
  isActive(): boolean;
  toggle(): Promise<void>;
  dispose(): void;
}

export interface FullscreenOptions {
  /** Element rozszerzany na pelny ekran — musi zawierac scene i HUD. */
  target: HTMLElement;
  /** Kontener iframe'a; pelny ekran w jego wnetrzu znaczy "YouTube przejal". */
  playerHost: HTMLElement;
  onChange?: (active: boolean) => void;
  /** Iframe przejal pelny ekran i nie udalo sie go odzyskac. */
  onLost?: () => void;
  doc?: Document;
}

const CHANGE_EVENTS = ['fullscreenchange', 'webkitfullscreenchange'] as const;

function currentElement(doc: FullscreenDocument): Element | null {
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

function requestOn(element: FullscreenElement): Promise<void> {
  const request = element.requestFullscreen ?? element.webkitRequestFullscreen;
  if (!request) return Promise.reject(new Error('Fullscreen API niedostepne'));
  return Promise.resolve(request.call(element)).then(() => undefined);
}

function exitFrom(doc: FullscreenDocument): Promise<void> {
  const exit = doc.exitFullscreen ?? doc.webkitExitFullscreen;
  if (!exit) return Promise.resolve();
  return Promise.resolve(exit.call(doc)).then(() => undefined);
}

export function createFullscreenController(options: FullscreenOptions): FullscreenController {
  const doc = (options.doc ?? document) as FullscreenDocument;
  const target = options.target as FullscreenElement;

  // `typeof`, bo TS uwaza `requestFullscreen` za zawsze zdefiniowane — na
  // iPhonie go nie ma i tylko test w czasie wykonania to wylapie.
  const hasNative =
    typeof target.requestFullscreen === 'function' ||
    typeof target.webkitRequestFullscreen === 'function';
  const mode: FullscreenMode = hasNative ? 'native' : 'css';

  const isActive = (): boolean =>
    mode === 'native'
      ? currentElement(doc) === target
      : target.classList.contains(PSEUDO_FULLSCREEN_CLASS);

  function togglePseudo(): void {
    const active = !target.classList.contains(PSEUDO_FULLSCREEN_CLASS);
    target.classList.toggle(PSEUDO_FULLSCREEN_CLASS, active);
    doc.documentElement.classList.toggle(PSEUDO_FULLSCREEN_ROOT_CLASS, active);
    options.onChange?.(active);
  }

  /** Trwa odbieranie pelnego ekranu iframe'owi — nie reagujemy na wlasne zdarzenia. */
  let reclaiming = false;

  const onChangeEvent = (): void => {
    if (reclaiming) return;

    const element = currentElement(doc);
    if (element && element !== target && options.playerHost.contains(element)) {
      void reclaim();
      return;
    }

    options.onChange?.(element === target);
  };

  async function reclaim(): Promise<void> {
    reclaiming = true;
    try {
      await exitFrom(doc);
      await requestOn(target);
    } catch {
      options.onLost?.();
    } finally {
      reclaiming = false;
    }
    options.onChange?.(isActive());
  }

  for (const type of CHANGE_EVENTS) doc.addEventListener(type, onChangeEvent);

  return {
    mode,
    isActive,
    toggle: async (): Promise<void> => {
      if (mode === 'css') return togglePseudo();
      try {
        if (isActive()) await exitFrom(doc);
        else await requestOn(target);
      } catch {
        // Odmowa (brak gestu, polityka przegladarki) — zostajemy w oknie.
      }
    },
    dispose: () => {
      for (const type of CHANGE_EVENTS) doc.removeEventListener(type, onChangeEvent);
    },
  };
}
