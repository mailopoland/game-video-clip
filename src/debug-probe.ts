/**
 * ⚠️ TYMCZASOWA SONDA DIAGNOSTYCZNA — wykrywanie reklam (ADR-0022).
 *
 * Reklamy YouTube pojawiaja sie wylacznie na deployu (GitHub Pages, iOS Safari),
 * gdzie nie ma ani trybu deweloperskiego, ani dostepu do konsoli. Sonda wypisuje
 * surowe odczyty IFrame API **na ekran**, z historia ostatnich zmian, zeby
 * wystarczyl jeden zrzut ekranu zrobiony w trakcie reklamy.
 *
 * JAK TO USUNAC (jedno miejsce, dwa kroki):
 *   1. skasuj ten plik,
 *   2. w `src/ui/youtube.ts` usun import `createAdProbe`, staly `probe`
 *      i wywolanie `probe?.(...)` w `sample()`.
 *   3. usun sekcje „Tymczasowa sonda diagnostyczna" z README.md.
 *
 * Zeby schowac sonde przed graczami bez usuwania kodu: `ENABLED_IN_PRODUCTION`
 * na `false` — zostanie wtedy wylacznie w `npm run dev`.
 */

/** Jedyne pokretlo: `false` = sonda tylko w trybie deweloperskim. */
const ENABLED_IN_PRODUCTION = true;

/** Ile ostatnich zmian trzyma pasek — zrzut ekranu po reklamie ma pokazac jej przebieg. */
const MAX_LINES = 8;

export interface AdProbeInputs {
  /** Dlugosc z beatmapy (`videoDurationSec`); 0 = brak, detekcja wylaczona. */
  expected: number;
  /** Surowe `player.getDuration()`. */
  getDuration: () => number;
  /** `getVideoData().video_id` — nieudokumentowane, wiec defensywnie. */
  getVideoId: () => string;
}

export type AdProbe = (state: number, duration: number, timeSec: number, ad: boolean) => void;

/** Ostatnia linia paska — stan gry, nie playera. Nadpisywana, nie dopisywana. */
let statusBox: HTMLElement | undefined;
/** Przedostatnia linia — pierwszy blad JS. Wyjatek w petli klatek zabija rAF
    na zawsze: ostatnia klatka (z rekami) zostaje na ekranie, a gra stoi. */
let errorBox: HTMLElement | undefined;

/**
 * Pokazuje stan silnika i DOM obok odczytow playera: bez tego nie da sie
 * odroznic „reka spawnowana przez silnik" od „grafika bramki startowej".
 * Nadpisuje jedna linie, wiec mozna wolac co klatke.
 */
export function setProbeStatus(text: string): void {
  if (!statusBox) return;
  if (statusBox.textContent !== text) statusBox.textContent = text;
}

/**
 * Zwraca funkcje logujaca albo `undefined`, gdy sonda jest wylaczona
 * (testy zawsze, produkcja przy `ENABLED_IN_PRODUCTION === false`).
 */
export function createAdProbe({ expected, getDuration, getVideoId }: AdProbeInputs): AdProbe | undefined {
  const enabled =
    import.meta.env.MODE !== 'test' && (import.meta.env.DEV || ENABLED_IN_PRODUCTION);
  if (!enabled || typeof document === 'undefined') return undefined;

  const lines: string[] = [];
  let last = '';
  const startMs = Date.now();

  const box = document.createElement('pre');
  box.style.cssText = [
    'position: fixed',
    'top: 0',
    'left: 0',
    'z-index: 2147483647',
    'margin: 0',
    'padding: 4px 6px',
    'max-width: 100vw',
    'background: rgba(0, 0, 0, 0.75)',
    'color: #0f0',
    'font: 700 11px/1.25 ui-monospace, monospace',
    'white-space: pre-wrap',
    // Nigdy nie zabiera klikniec rozgrywce — to tylko podglad.
    'pointer-events: none',
  ].join(';');
  document.body.append(box);

  // Historia i status to osobne wezly — inaczej `push()` kasowalby status.
  const history = document.createElement('div');
  box.append(history);

  const push = (line: string): void => {
    lines.push(line);
    if (lines.length > MAX_LINES) lines.shift();
    history.textContent = lines.join('\n');
    console.info(`[reklamy] ${line}`);
  };

  errorBox = document.createElement('div');
  errorBox.style.cssText = 'color: #f66';
  box.append(errorBox);

  statusBox = document.createElement('div');
  statusBox.style.cssText = 'color: #ff0';
  box.append(statusBox);

  const reportError = (what: string): void => {
    // Tylko pierwszy blad — kolejne sa zwykle jego konsekwencja.
    if (errorBox && !errorBox.textContent) errorBox.textContent = `BLAD: ${what}`;
  };
  window.addEventListener('error', (event) =>
    reportError(`${event.message} @ ${event.filename ?? '?'}:${event.lineno ?? 0}`),
  );
  window.addEventListener('unhandledrejection', (event) =>
    reportError(`odrzucona obietnica: ${String(event.reason)}`),
  );

  push(`start dur=${getDuration()} oczek=${expected || 'BRAK'} vid=${getVideoId()}`);

  return (state, duration, timeSec, ad) => {
    // Log tylko przy zmianie — inaczej pasek przewijalby sie co klatke.
    const key = `${state}|${Math.round(duration)}|${ad ? 'AD' : 'TR'}`;
    if (key === last) return;
    last = key;
    const at = ((Date.now() - startMs) / 1000).toFixed(1);
    push(
      `${at}s st=${state} dur=${duration} t=${timeSec.toFixed(1)} vid=${getVideoId()} ` +
        `=> ${ad ? 'REKLAMA' : 'TRESC'}`,
    );
  };
}
