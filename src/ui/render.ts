import { SPRITES, preloadSprites } from '../sprites.js';
import type { GameView, VisibleObject } from '../engine/types.js';

export interface TransportControls {
  play(): void;
  pause(): void;
  seekTo(sec: number): void;
  getDuration(): number;
  isMuted(): boolean;
  setMuted(muted: boolean): void;
}

export interface Ui {
  /** Element, w ktorym IFrame Player API osadza odtwarzacz. */
  playerHost: HTMLElement;
  /** Scena + HUD — to ten element idzie na pelny ekran (ADR-0010). */
  frame: HTMLElement;
  /** Cel nasluchu trybu deweloperskiego (ADR-0016) — obejmuje `.overlay`. */
  stage: HTMLElement;
  /** Odwrotnosc px -> % dla trybu deweloperskiego liczona wzgledem tego elementu. */
  overlay: HTMLElement;
  render(view: GameView): void;
  hideGate(): void;
  /** Przycisk "Graj" jest aktywny dopiero, gdy odtwarzacz jest gotowy. */
  setStartEnabled(enabled: boolean): void;
  /** Pokazuje przycisk pelnego ekranu i podpina jego obsluge. */
  enableFullscreen(toggle: () => void): void;
  setFullscreenActive(active: boolean): void;
  /** Podglad reki podczas nagrywania w trybie dev (ADR-0016); `null` usuwa go. */
  setRecordingPreview(pos: { x: number; y: number } | null): void;
  /** Pierscien zaznaczenia + uchwyt rozmiaru dla trybu dev-edit-hand; `null` usuwa go. */
  setHandSelection(sel: { x: number; y: number; size: number } | null): void;
  /** Odblokowuje pasek transportu i podpina go pod kontrolki playera (ADR-0019). */
  enableTransport(controls: TransportControls): void;
}

/** `M:ss`, lokalny helper — nie reuzywac `formatClock` z `src/dev/record.ts` (kod dev, ADR-0016). */
function formatTime(sec: number): string {
  const total = Math.max(0, Math.floor(sec));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Warstwa prezentacji: odwzorowuje stan silnika na DOM (ADR-0002).
 * Nie zawiera zadnej logiki gry i nie zna czasu wideo.
 */
export function createUi(
  root: HTMLElement,
  handlers: { onStart: () => void; onHit: (objectId: string) => void },
): Ui {
  // Assety ida do cache od razu przy montazu, a nie przy pierwszym montazu
  // obiektu — pierwszy cel zyje ok. 2 s i inaczej zdazylby zniknac, zanim GIF
  // sie pobierze (dlon widoczna dopiero po przewinieciu w tyl).
  preloadSprites();

  // Scena i HUD siedza we wspolnej ramce, bo to ona idzie na pelny ekran —
  // element w top layer zasloniby wszystko, co zostaloby na zewnatrz (ADR-0010).
  root.innerHTML = `
    <div class="frame" id="frame">
      <main class="stage" id="stage">
        <div class="player" id="player"></div>
        <div class="overlay" id="overlay"></div>
        <div class="gate" id="gate">
          <button class="gate-button" id="start" type="button">Graj</button>
          <p class="gate-hint">Klikaj dlonie, gdy sie pojawia.</p>
        </div>
        <section class="results" id="results" hidden>
          <h1>Koniec</h1>
          <p class="results-score"><span id="r-score">0</span> pkt</p>
          <dl class="results-detail">
            <dt>Trafienia</dt><dd id="r-hits">0</dd>
            <dt>Pudla</dt><dd id="r-misses">0</dd>
            <dt>Celnosc</dt><dd id="r-accuracy">0%</dd>
          </dl>
        </section>
      </main>
      <div class="transport" id="transport">
        <button class="transport-button" id="transport-play" type="button" disabled>Odtwarzaj</button>
        <input class="transport-seek" id="transport-seek" type="range"
               min="0" max="0" step="0.1" value="0" disabled aria-label="Przewijanie" />
        <span class="transport-time" id="transport-time">0:00 / 0:00</span>
        <button class="transport-button" id="transport-mute" type="button"
                aria-pressed="false" disabled>Wycisz</button>
      </div>
      <div class="hud">
        <span class="hud-score" id="hud-score">0</span>
        <span class="hud-frozen" id="hud-frozen" hidden>pauza</span>
        <button class="hud-fullscreen" id="fullscreen" type="button" aria-pressed="false" hidden>
          Pelny ekran
        </button>
      </div>
    </div>
  `;

  const byId = <T extends HTMLElement>(id: string): T => root.querySelector<T>(`#${id}`)!;
  const stage = byId('stage');
  const overlay = byId('overlay');
  const gate = byId('gate');
  const results = byId('results');
  const hudScore = byId('hud-score');
  const hudFrozen = byId('hud-frozen');

  const transportPlay = byId<HTMLButtonElement>('transport-play');
  const transportSeek = byId<HTMLInputElement>('transport-seek');
  const transportTime = byId('transport-time');
  const transportMute = byId<HTMLButtonElement>('transport-mute');
  let transportControls: TransportControls | null = null;
  let durationKnown = false;
  let durationSec = 0;
  let scrubbing = false;
  let lastFrozen = true;

  const startButton = byId<HTMLButtonElement>('start');
  startButton.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    if (!startButton.disabled) handlers.onStart();
  });

  const elements = new Map<string, HTMLElement>();

  function createObjectElement(visible: VisibleObject): HTMLElement {
    const { object } = visible;
    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'obj';
    element.dataset.id = object.id;
    element.setAttribute('aria-label', 'Cel');

    const sprite = SPRITES[object.sprite]!;
    const spriteElement =
      sprite.kind === 'image'
        ? Object.assign(document.createElement('img'), { src: sprite.src, alt: '' })
        : document.createElement('span');
    spriteElement.classList.add('sprite');
    if (sprite.kind === 'css') spriteElement.classList.add(sprite.className);
    element.append(spriteElement);

    const feedback = document.createElement('span');
    feedback.className = 'feedback';
    element.append(feedback);

    // pointerdown obsluguje mysz, dotyk i pioro jednym zdarzeniem i nie ma
    // 300 ms opoznienia click-a na mobile (ADR-0009).
    element.addEventListener('pointerdown', (event) => {
      // Prawy przycisk sluzy trybowi deweloperskiemu (usuwanie obiektu,
      // ADR-0016) i nigdy nie liczy sie jako trafienie.
      if (event.button !== 0) return;
      event.preventDefault();
      handlers.onHit(object.id);
    });

    overlay.append(element);
    return element;
  }

  function render(view: GameView): void {
    const seen = new Set<string>();

    for (const visible of view.visible) {
      seen.add(visible.object.id);
      const element = elements.get(visible.object.id) ?? createObjectElement(visible);
      elements.set(visible.object.id, element);

      // Pozycja i rozmiar sa funkcja czasu wideo (ADR-0014) — zapisujemy je
      // bezwarunkowo co klatke, tak samo jak skale approach circle.
      element.style.left = `${visible.x}%`;
      element.style.top = `${visible.y}%`;
      element.style.width = `${(16 * visible.size) / 100}%`;

      element.classList.toggle('is-hit', visible.outcome === 'hit');
      element.classList.toggle('is-miss', visible.outcome === 'miss');
      if (visible.outcome === 'hit') {
        element.querySelector<HTMLElement>('.feedback')!.textContent = '+1';
      }
      if (visible.outcome === 'hit') {
        const sprite = SPRITES[visible.object.sprite]!;
        if (sprite.kind === 'image' && sprite.hitSrc) {
          const img = element.querySelector<HTMLImageElement>('img.sprite');
          if (img && !img.src.endsWith(sprite.hitSrc)) img.src = sprite.hitSrc;
        }
      }
    }

    for (const [id, element] of elements) {
      if (seen.has(id)) continue;
      element.remove();
      elements.delete(id);
    }

    hudScore.textContent = String(view.stats.score);
    hudFrozen.hidden = !view.frozen;

    if (transportControls) {
      lastFrozen = view.frozen;
      if (!durationKnown) {
        const duration = transportControls.getDuration();
        if (duration > 0) {
          durationSec = duration;
          transportSeek.max = String(duration);
          durationKnown = true;
        }
      }
      if (!scrubbing) transportSeek.value = String(view.timeSec);
      transportTime.textContent = `${formatTime(view.timeSec)} / ${formatTime(durationSec)}`;
      transportPlay.textContent = view.frozen ? 'Odtwarzaj' : 'Pauza';
    }

    results.hidden = !view.showResults;
    if (view.showResults) {
      byId('r-score').textContent = String(view.stats.score);
      byId('r-hits').textContent = String(view.stats.hits);
      byId('r-misses').textContent = String(view.stats.misses);
      byId('r-accuracy').textContent = `${Math.round(view.stats.accuracy)}%`;
    }
  }

  const fullscreenButton = byId<HTMLButtonElement>('fullscreen');

  // Podglad reki w trybie dev — zyje poza mapa `elements`, wiec render() go
  // nie kasuje co klatke (ADR-0016). Reuzywa budowy sprite'a z createObjectElement.
  let previewElement: HTMLElement | null = null;

  function setRecordingPreview(pos: { x: number; y: number } | null): void {
    if (!pos) {
      previewElement?.remove();
      previewElement = null;
      return;
    }

    if (!previewElement) {
      const element = document.createElement('div');
      element.className = 'obj is-preview';
      element.setAttribute('aria-hidden', 'true');

      const sprite = SPRITES['hand']!;
      const spriteElement =
        sprite.kind === 'image'
          ? Object.assign(document.createElement('img'), { src: sprite.src, alt: '' })
          : document.createElement('span');
      spriteElement.classList.add('sprite');
      if (sprite.kind === 'css') spriteElement.classList.add(sprite.className);
      element.append(spriteElement);

      overlay.append(element);
      previewElement = element;
    }

    previewElement.style.left = `${pos.x}%`;
    previewElement.style.top = `${pos.y}%`;
  }

  let selectionElement: HTMLElement | null = null;

  function setHandSelection(sel: { x: number; y: number; size: number } | null): void {
    if (!sel) {
      selectionElement?.remove();
      selectionElement = null;
      return;
    }

    if (!selectionElement) {
      const element = document.createElement('div');
      element.className = 'dev-selection-ring';
      element.setAttribute('aria-hidden', 'true');

      const handle = document.createElement('div');
      handle.className = 'dev-size-handle';
      element.append(handle);

      overlay.append(element);
      selectionElement = element;
    }

    selectionElement.style.left = `${sel.x}%`;
    selectionElement.style.top = `${sel.y}%`;
    selectionElement.style.width = `${(16 * sel.size) / 100}%`;
  }

  return {
    playerHost: byId('player'),
    frame: byId('frame'),
    stage,
    overlay,
    render,
    setRecordingPreview,
    setHandSelection,
    hideGate: () => {
      gate.hidden = true;
    },
    setStartEnabled: (enabled) => {
      startButton.disabled = !enabled;
      startButton.textContent = enabled ? 'Graj' : 'Ladowanie…';
    },
    enableFullscreen: (toggle) => {
      fullscreenButton.hidden = false;
      // Tu celowo `click`, nie `pointerdown`: to najpewniejsze zrodlo gestu
      // uzytkownika dla requestFullscreen we wszystkich przegladarkach, a
      // przycisk nie jest elementem rozgrywki, wiec opoznienie nie szkodzi.
      fullscreenButton.addEventListener('click', () => toggle());
    },
    setFullscreenActive: (active) => {
      fullscreenButton.setAttribute('aria-pressed', String(active));
      fullscreenButton.textContent = active ? 'Zamknij pelny ekran' : 'Pelny ekran';
    },
    enableTransport: (controls) => {
      transportControls = controls;
      transportPlay.disabled = false;
      transportSeek.disabled = false;
      transportMute.disabled = false;

      transportPlay.addEventListener('click', () => {
        if (lastFrozen) controls.play();
        else controls.pause();
      });

      transportSeek.addEventListener('input', () => {
        scrubbing = true;
      });
      transportSeek.addEventListener('change', () => {
        controls.seekTo(Number(transportSeek.value));
        scrubbing = false;
      });

      const updateMuteLabel = (): void => {
        const muted = controls.isMuted();
        transportMute.setAttribute('aria-pressed', String(muted));
        transportMute.textContent = muted ? 'Wlacz dzwiek' : 'Wycisz';
      };
      transportMute.addEventListener('click', () => {
        controls.setMuted(!controls.isMuted());
        updateMuteLabel();
      });
      updateMuteLabel();
    },
  };
}
