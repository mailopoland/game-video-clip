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
  /** Podglad reki podczas nagrywania w trybie dev (ADR-0016); `null` usuwa go. */
  setRecordingPreview(pos: { x: number; y: number } | null): void;
  /** Pierscien zaznaczenia + uchwyt rozmiaru dla trybu dev-edit-hand; `null` usuwa go. */
  setHandSelection(sel: { x: number; y: number; size: number } | null): void;
  /** Odblokowuje pasek transportu i podpina go pod kontrolki playera (ADR-0019). */
  enableTransport(controls: TransportControls): void;
}

/**
 * Ikony transportu jako inline SVG, nie znaki Unicode. iOS nie ma w foncie ani
 * `❚❚`, ani `🕪` — na iPhonie w miejsce guzikow byly puste kwadraty. SVG nie
 * zalezy od fontu ani od sieci (assetow nie pobieramy), skaluje sie bez
 * rozmycia i bierze kolor z `currentColor`.
 *
 * Ikona dzwieku odzwierciedla STAN, nie akcje: glosnik = gra, przekreslony = wyciszone.
 */
const ICONS = {
  play: '<path d="M8 5v14l11-7z" />',
  pause: '<path d="M6.5 5h3.5v14H6.5zM14 5h3.5v14H14z" />',
  'sound-on':
    '<path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4z" />' +
    '<path d="M15.4 8.6a4.8 4.8 0 0 1 0 6.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />' +
    '<path d="M18 6a8.4 8.4 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />',
  'sound-off':
    '<path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4z" />' +
    '<path d="M15.5 9.5l5 5M20.5 9.5l-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />',
} as const;

type IconName = keyof typeof ICONS;

function iconMarkup(name: IconName): string {
  return `<svg class="icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`;
}

/**
 * `data-icon` jest kontraktem dla testow (i debugowania) — po podmianie na SVG
 * `textContent` przycisku jest pusty, wiec nie da sie po nim rozpoznac ikony.
 */
function setIcon(button: HTMLButtonElement, name: IconName): void {
  if (button.dataset.icon === name) return;
  button.dataset.icon = name;
  button.innerHTML = iconMarkup(name);
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
        <div class="shield" id="shield"></div>
        <button class="yt-button-proxy" id="yt-button-proxy" type="button" disabled
                aria-label="Odtwarzaj lub wstrzymaj"></button>
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
        <button class="transport-button transport-icon" id="transport-play" type="button" disabled
                data-icon="play" aria-label="Odtwarzaj lub wstrzymaj">${iconMarkup('play')}</button>
        <input class="transport-seek" id="transport-seek" type="range"
               min="0" max="0" step="0.1" value="0" disabled aria-label="Przewijanie" />
        <span class="transport-time" id="transport-time">0:00 / 0:00</span>
        <button class="transport-button transport-icon" id="transport-mute" type="button"
                aria-pressed="false" disabled data-icon="sound-on"
                aria-label="Wycisz">${iconMarkup('sound-on')}</button>
        <span class="hud-score" id="hud-score">0</span>
        <span class="hud-hand" id="hud-hand" aria-hidden="true"></span>
      </div>
    </div>
  `;

  const byId = <T extends HTMLElement>(id: string): T => root.querySelector<T>(`#${id}`)!;
  const stage = byId('stage');
  const overlay = byId('overlay');
  const gate = byId('gate');
  const results = byId('results');
  const hudScore = byId('hud-score');
  const hudHand = byId('hud-hand');
  const ytButtonProxy = byId<HTMLButtonElement>('yt-button-proxy');

  {
    const sprite = SPRITES['hand']!;
    if (sprite.kind === 'image' && sprite.hitSrc) {
      hudHand.append(Object.assign(document.createElement('img'), { src: sprite.hitSrc, alt: '' }));
    }
  }

  const transportPlay = byId<HTMLButtonElement>('transport-play');
  const transportSeek = byId<HTMLInputElement>('transport-seek');
  const transportTime = byId('transport-time');
  const transportMute = byId<HTMLButtonElement>('transport-mute');
  let transportControls: TransportControls | null = null;
  let durationKnown = false;
  let durationSec = 0;
  let scrubbing = false;
  // Ikona dzwieku pokazuje STAN playera, nie skutek ostatniego klikniecia —
  // YouTube potrafi zmienic wyciszenie sam (autoplay, iOS), wiec odswiezamy ja
  // co klatke z `controls.isMuted()`.
  let lastMuted: boolean | null = null;
  let lastFrozen = true;

  const startButton = byId<HTMLButtonElement>('start');

  // Bramka startowa ma dwa wejscia: wlasny przycisk "Graj" i przycisk play
  // paska transportu (oraz proxy duzego przycisku YouTube'a) — pierwsze
  // klikniecie ktoregokolwiek z nich jest startem gry, nie zwyklym play.
  // `onStart` musi pojsc dokladnie raz: odblokowuje `AudioContext` (ADR-0017),
  // dlatego bramka jest warunkiem — `hideGate()` zamyka ja na dobre.
  function triggerStart(): void {
    if (gate.hidden || startButton.disabled) return;
    handlers.onStart();
  }

  startButton.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    triggerStart();
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

  function syncMuteIcon(controls: TransportControls): void {
    const muted = controls.isMuted();
    if (muted === lastMuted) return;
    lastMuted = muted;
    transportMute.setAttribute('aria-pressed', String(muted));
    transportMute.setAttribute('aria-label', muted ? 'Wlacz dzwiek' : 'Wycisz');
    setIcon(transportMute, muted ? 'sound-off' : 'sound-on');
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

    if (transportControls) {
      syncMuteIcon(transportControls);
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
      setIcon(transportPlay, view.frozen ? 'play' : 'pause');
    }

    results.hidden = !view.showResults;
    if (view.showResults) {
      byId('r-score').textContent = String(view.stats.score);
      byId('r-hits').textContent = String(view.stats.hits);
      byId('r-misses').textContent = String(view.stats.misses);
      byId('r-accuracy').textContent = `${Math.round(view.stats.accuracy)}%`;
    }
  }

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
    enableTransport: (controls) => {
      transportControls = controls;
      transportPlay.disabled = false;
      transportSeek.disabled = false;
      transportMute.disabled = false;

      const togglePlayback = (): void => {
        // Dopoki bramka stoi, play jest startem gry — inaczej wideo ruszyloby
        // pod nia, a `AudioContext` zostalby zablokowany.
        if (!gate.hidden) {
          triggerStart();
          return;
        }
        if (lastFrozen) controls.play();
        else controls.pause();
      };
      transportPlay.addEventListener('click', togglePlayback);

      // Duzego przycisku YouTube'a nie da sie usunac (jest wysrodkowany razem
      // z obrazem, a iframe jest cross-origin), wiec zostaje widoczny. Zdarzen
      // NIE przepuszczamy jednak do iframe'a — pudlo obok dloni znowu
      // pauzowaloby wideo. Zamiast tego wlasny przezroczysty przycisk dokladnie
      // w tym miejscu: wyglad YouTube'a, dzialanie nasze (ADR-0019).
      ytButtonProxy.disabled = false;
      ytButtonProxy.addEventListener('click', togglePlayback);

      transportSeek.addEventListener('input', () => {
        scrubbing = true;
      });
      transportSeek.addEventListener('change', () => {
        controls.seekTo(Number(transportSeek.value));
        scrubbing = false;
      });

      transportMute.addEventListener('click', () => {
        controls.setMuted(!controls.isMuted());
        syncMuteIcon(controls);
      });
      syncMuteIcon(controls);
    },
  };
}
