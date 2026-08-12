import { validateBeatmap } from '../engine/beatmap.js';
import { SPRITE_KEYS } from '../sprites.js';
import { buildPath, insertObject, nextObjectId, pushSample, removeObject, toOverlayPercent } from './record.js';
import type { Engine } from '../engine/engine.js';
import type { Ui } from '../ui/render.js';
import type { Beatmap, BeatmapObject, PathPoint } from '../engine/types.js';

export interface DevRecorderHandle {
  /** Wolane z petli rAF, po `game.frame()` (ADR-0016). */
  onFrame(): void;
}

/**
 * Tryb deweloperski nagrywania sciezki reki prawym przyciskiem myszy przy
 * zwolnionym tempie (ADR-0016). Zrodlem prawdy jest beatmapa w pamieci —
 * zapis na dysk (`POST /__beatmap`) jest efektem ubocznym, ktorego wynik nie
 * wplywa na stan gry; strona sie nie przeladowuje.
 */
export function mountDevRecorder(options: {
  ui: Ui;
  engine: Engine;
  beatmap: Beatmap;
  getRate: () => number;
  setRate: (rate: number) => void;
  getAvailableRates: () => number[];
  seekBy: (deltaSec: number) => void;
  pause: () => void;
  play: () => void;
  /** Ta sama sciezka co przy trafieniu w reke — guzik „Test dzwieku". */
  playHitSound?: () => void;
  /** Jednolinijkowa diagnostyka stanu audio do paska statusu. */
  describeHitSound?: () => string;
}): DevRecorderHandle {
  const { ui, engine } = options;
  let currentBeatmap = options.beatmap;

  let active = false;
  let recording = false;
  let samples: PathPoint[] = [];
  let lastX = 0;
  let lastY = 0;
  let capturedPointerId: number | null = null;

  const bar = document.createElement('div');
  bar.className = 'dev-bar';
  bar.innerHTML = `
    <label class="dev-toggle">
      <input type="checkbox" id="dev-toggle" />
      Developer: edycja grafiki na osi czasu
    </label>
    <button type="button" id="dev-seek-back">-100ms</button>
    <button type="button" id="dev-seek-fwd">+100ms</button>
    <button type="button" id="dev-stop">Stop</button>
    <button type="button" id="dev-play">Play</button>
    <button type="button" id="dev-reload">Reload beatmap.json</button>
    <button type="button" id="dev-sound">Test dzwieku</button>
    <span class="dev-status" id="dev-status"></span>
  `;
  ui.frame.append(bar);

  const checkbox = bar.querySelector<HTMLInputElement>('#dev-toggle')!;
  const status = bar.querySelector<HTMLElement>('#dev-status')!;
  const seekBackButton = bar.querySelector<HTMLButtonElement>('#dev-seek-back')!;
  const seekFwdButton = bar.querySelector<HTMLButtonElement>('#dev-seek-fwd')!;
  const stopButton = bar.querySelector<HTMLButtonElement>('#dev-stop')!;
  const playButton = bar.querySelector<HTMLButtonElement>('#dev-play')!;
  const reloadButton = bar.querySelector<HTMLButtonElement>('#dev-reload')!;
  const soundButton = bar.querySelector<HTMLButtonElement>('#dev-sound')!;

  const SEEK_STEP_SEC = 0.1;
  seekBackButton.addEventListener('click', () => options.seekBy(-SEEK_STEP_SEC));
  seekFwdButton.addEventListener('click', () => options.seekBy(SEEK_STEP_SEC));
  stopButton.addEventListener('click', () => options.pause());
  playButton.addEventListener('click', () => options.play());
  reloadButton.addEventListener('click', () => void reloadBeatmap());

  // Diagnostyka dzwieku na urzadzeniu bez devtoolsow (iOS). Odczyt stanu jest
  // opozniony, bo `play()` odrzuca sie asynchronicznie, a `currentTime` musi
  // zdazyc ruszyc — to wlasnie ono odroznia „zablokowane play()" od „gra, ale
  // nie slychac".
  const SOUND_PROBE_MS = 400;
  soundButton.addEventListener('click', () => {
    options.playHitSound?.();
    setStatus('Dzwiek: gram…');
    setTimeout(() => {
      setStatus(`Dzwiek: ${options.describeHitSound?.() ?? 'brak diagnostyki'}`);
    }, SOUND_PROBE_MS);
  });

  function setStatus(text: string): void {
    status.textContent = text;
  }

  function releaseCapture(): void {
    if (capturedPointerId === null) return;
    try {
      ui.stage.releasePointerCapture(capturedPointerId);
    } catch {
      // jsdom / brak wsparcia w przegladarce — bez znaczenia dla logiki.
    }
    capturedPointerId = null;
  }

  /** Przerwanie trwajacego nagrania bez zapisu (odznaczenie checkboxa,
      pointercancel, pointerleave sceny — rozstrzygniecie #2). */
  function cancelRecording(): void {
    recording = false;
    samples = [];
    ui.setRecordingPreview(null);
    releaseCapture();
  }

  function persist(): void {
    setStatus('Zapisywanie…');
    fetch('/__beatmap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(currentBeatmap),
    })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        setStatus('Zapisano.');
      })
      .catch((error: unknown) => {
        // Blad zapisu nie cofa stanu w pamieci — gra dziala dalej, edytujacy
        // moze od razu przewinac wideo (rozstrzygniecie #1).
        console.error('Zapis beatmapy nie powiodl sie:', error);
        setStatus(`Blad zapisu: ${(error as Error).message}`);
      });
  }

  /** Wczytuje beatmap.json z dysku (nadpisujac niezapisane zmiany w pamieci)
      i podmienia obiekty w silniku — przydatne po recznej edycji pliku. */
  function reloadBeatmap(): void {
    setStatus('Wczytywanie…');
    fetch('/src/data/beatmap.json')
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((json: unknown) => {
        const reloaded = validateBeatmap(json as Beatmap, SPRITE_KEYS);
        currentBeatmap = reloaded;
        engine.setObjects(currentBeatmap.objects);
        setStatus('Wczytano.');
      })
      .catch((error: unknown) => {
        console.error('Wczytanie beatmapy nie powiodlo sie:', error);
        setStatus(`Blad wczytania: ${(error as Error).message}`);
      });
  }

  checkbox.addEventListener('change', () => {
    active = checkbox.checked;
    // `.overlay` ma domyslnie `pointer-events: none` (klikalne sa tylko `.obj`),
    // zeby pasek kontrolek YouTube i klik-pauza dzialaly poza trybem dev. Bez
    // tego przelacznika prawy-drag na pustym miejscu (rysowanie nowej sciezki)
    // spadalby przez overlay wprost do iframe'a YouTube pod spodem, ktorego
    // zdarzenia nigdy nie babelkuja do naszego DOM.
    ui.overlay.classList.toggle('dev-active', active);
    if (active) {
      const rates = options.getAvailableRates();
      options.setRate(rates.length > 0 ? Math.min(...rates) : 1);
    } else {
      options.setRate(1);
      cancelRecording();
    }
  });

  ui.stage.addEventListener('contextmenu', (event) => {
    if (active) event.preventDefault();
  });

  ui.stage.addEventListener('pointerdown', (event) => {
    if (!active || event.button !== 2) return;

    // Prawy klik w istniejacy obiekt usuwa go i konczy — bez startu nagrania
    // (rozstrzygniecie #3). `is-preview` to podglad reki, nigdy prawdziwy obiekt.
    const hitObject = (event.target as Element).closest('.obj:not(.is-preview)');
    if (hitObject) {
      const id = (hitObject as HTMLElement).dataset.id;
      if (id) {
        currentBeatmap = removeObject(currentBeatmap, id);
        engine.setObjects(currentBeatmap.objects);
        persist();
      }
      return;
    }

    samples = [];
    recording = true;
    lastX = event.clientX;
    lastY = event.clientY;
    capturedPointerId = event.pointerId;
    try {
      ui.stage.setPointerCapture(event.pointerId);
    } catch {
      // jsdom nie ma prawdziwych PointerEvent — nagrywanie dziala i tak,
      // bo probki biora sie z onFrame(), nie z tego zdarzenia.
    }
  });

  ui.stage.addEventListener('pointermove', (event) => {
    if (!recording) return;
    lastX = event.clientX;
    lastY = event.clientY;
  });

  ui.stage.addEventListener('pointerup', () => {
    if (!recording) return;
    recording = false;
    releaseCapture();

    const path = buildPath(samples);
    samples = [];
    ui.setRecordingPreview(null);
    if (!path) return;

    const object: BeatmapObject = {
      id: nextObjectId(currentBeatmap, path[0]!.t),
      sprite: 'hand',
      path,
    };

    let updated: Beatmap;
    try {
      updated = insertObject(currentBeatmap, object);
      validateBeatmap(updated, SPRITE_KEYS);
    } catch (error) {
      setStatus(`Blad: ${(error as Error).message}`);
      return;
    }

    currentBeatmap = updated;
    engine.setObjects(currentBeatmap.objects);
    persist();
  });

  ui.stage.addEventListener('pointercancel', () => {
    if (recording) cancelRecording();
  });

  ui.stage.addEventListener('pointerleave', () => {
    if (recording) cancelRecording();
  });

  return {
    onFrame(): void {
      if (!recording) return;
      const view = engine.getView();
      if (view.frozen) return;

      const rect = ui.overlay.getBoundingClientRect();
      const pos = toOverlayPercent(rect, lastX, lastY);
      pushSample(samples, { t: view.timeSec, x: pos.x, y: pos.y });
      ui.setRecordingPreview(pos);
    },
  };
}
