import { SPRITES } from '../sprites.js';
import type { GameView, VisibleObject } from '../engine/types.js';

export interface Ui {
  /** Element, w ktorym IFrame Player API osadza odtwarzacz. */
  playerHost: HTMLElement;
  render(view: GameView): void;
  hideGate(): void;
  /** Przycisk "Graj" jest aktywny dopiero, gdy odtwarzacz jest gotowy. */
  setStartEnabled(enabled: boolean): void;
}

/**
 * Warstwa prezentacji: odwzorowuje stan silnika na DOM (ADR-0002).
 * Nie zawiera zadnej logiki gry i nie zna czasu wideo.
 */
export function createUi(
  root: HTMLElement,
  handlers: { onStart: () => void; onHit: (objectId: string) => void },
): Ui {
  root.innerHTML = `
    <main class="stage" id="stage">
      <div class="player" id="player"></div>
      <div class="overlay" id="overlay"></div>
      <div class="gate" id="gate">
        <button class="gate-button" id="start" type="button">Graj</button>
        <p class="gate-hint">Klikaj obiekty, gdy okrag zetknie sie z ich krawedzia.</p>
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
    <div class="hud">
      <span class="hud-score" id="hud-score">0</span>
      <span class="hud-frozen" id="hud-frozen" hidden>pauza</span>
    </div>
  `;

  const byId = <T extends HTMLElement>(id: string): T => root.querySelector<T>(`#${id}`)!;
  const overlay = byId('overlay');
  const gate = byId('gate');
  const results = byId('results');
  const hudScore = byId('hud-score');
  const hudFrozen = byId('hud-frozen');

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
    element.style.left = `${object.x}%`;
    element.style.top = `${object.y}%`;

    const sprite = SPRITES[object.sprite]!;
    const spriteElement =
      sprite.kind === 'image'
        ? Object.assign(document.createElement('img'), { src: sprite.src, alt: '' })
        : document.createElement('span');
    spriteElement.classList.add('sprite');
    if (sprite.kind === 'css') spriteElement.classList.add(sprite.className);
    element.append(spriteElement);

    const approach = document.createElement('span');
    approach.className = 'approach';
    element.append(approach);

    const feedback = document.createElement('span');
    feedback.className = 'feedback';
    element.append(feedback);

    // pointerdown obsluguje mysz, dotyk i pioro jednym zdarzeniem i nie ma
    // 300 ms opoznienia click-a na mobile (ADR-0009).
    element.addEventListener('pointerdown', (event) => {
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

      const approach = element.querySelector<HTMLElement>('.approach')!;
      approach.style.transform = `scale(${1 + visible.approach * 2.2})`;
      approach.style.opacity = `${0.35 + (1 - visible.approach) * 0.65}`;

      const resolved = visible.outcome === 'hit' || visible.outcome === 'miss';
      element.classList.toggle('is-hit', visible.outcome === 'hit');
      element.classList.toggle('is-miss', visible.outcome === 'miss');
      if (resolved) {
        element.querySelector<HTMLElement>('.feedback')!.textContent =
          visible.outcome === 'hit' ? '+1' : '✕';
      }
    }

    for (const [id, element] of elements) {
      if (seen.has(id)) continue;
      element.remove();
      elements.delete(id);
    }

    hudScore.textContent = String(view.stats.score);
    hudFrozen.hidden = !view.frozen;

    results.hidden = !view.showResults;
    if (view.showResults) {
      byId('r-score').textContent = String(view.stats.score);
      byId('r-hits').textContent = String(view.stats.hits);
      byId('r-misses').textContent = String(view.stats.misses);
      byId('r-accuracy').textContent = `${Math.round(view.stats.accuracy)}%`;
    }
  }

  return {
    playerHost: byId('player'),
    render,
    hideGate: () => {
      gate.hidden = true;
    },
    setStartEnabled: (enabled) => {
      startButton.disabled = !enabled;
      startButton.textContent = enabled ? 'Graj' : 'Ladowanie…';
    },
  };
}
