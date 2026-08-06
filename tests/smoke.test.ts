// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { mountGame } from '../src/game.js';
import { FakeClock, makeBeatmap, obj } from './fake-clock.js';

/** jsdom nie implementuje PointerEvent — gra i tak slucha tylko `pointerdown`. */
function tap(element: Element): void {
  element.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
}

function playTo(clock: FakeClock, frame: () => void, targetSec: number): void {
  while (clock.timeSec < targetSec - 1e-9) {
    clock.advance(Math.min(0.016, targetSec - clock.timeSec));
    frame();
  }
}

describe('smoke: render i wejscie dotykowe', () => {
  let root: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    root = document.querySelector<HTMLElement>('#app')!;
  });

  it('startuje z bramka, renderuje obiekt i zalicza tap na nim', () => {
    const clock = new FakeClock();
    const beatmap = makeBeatmap([obj('o1', 10, { duration: 1000, hitWindowMs: 300 })], 20);
    const game = mountGame(root, beatmap, clock, { now: clock.now });

    // Bramka startowa jest widoczna do pierwszego gestu (ADR-0009).
    const gate = root.querySelector<HTMLElement>('#gate')!;
    expect(gate.hidden).toBe(false);
    tap(root.querySelector('#start')!);
    expect(gate.hidden).toBe(true);

    playTo(clock, game.frame, 9.5);
    const target = root.querySelector<HTMLElement>('.obj[data-id="o1"]');
    expect(target).not.toBeNull();

    playTo(clock, game.frame, 10.0);
    tap(target!);

    expect(target!.classList.contains('is-hit')).toBe(true);
    expect(target!.querySelector('.feedback')!.textContent).toBe('+1');
    expect(root.querySelector('#hud-score')!.textContent).toBe('1');
  });

  it('tap poza oknem tolerancji pokazuje X i nie daje punktu', () => {
    const clock = new FakeClock();
    const beatmap = makeBeatmap([obj('o1', 10, { duration: 1000, hitWindowMs: 200 })]);
    const game = mountGame(root, beatmap, clock, { now: clock.now });

    playTo(clock, game.frame, 9.2);
    const target = root.querySelector<HTMLElement>('.obj[data-id="o1"]')!;
    tap(target);

    expect(target.classList.contains('is-miss')).toBe(true);
    expect(target.querySelector('.feedback')!.textContent).toBe('✕');
    expect(root.querySelector('#hud-score')!.textContent).toBe('0');
  });

  it('pauza wideo zatrzymuje spawnowanie obiektow', () => {
    const clock = new FakeClock();
    const beatmap = makeBeatmap([obj('o1', 10, { duration: 1000 })]);
    const game = mountGame(root, beatmap, clock, { now: clock.now });

    playTo(clock, game.frame, 8.5);
    clock.playing = false;
    for (let i = 0; i < 100; i++) {
      clock.advanceWallOnly(0.05);
      game.frame();
    }

    expect(root.querySelectorAll('.obj')).toHaveLength(0);
    expect(root.querySelector<HTMLElement>('#hud-frozen')!.hidden).toBe(false);
  });

  it('na koncu klipu pokazuje ekran wyniku z liczbami', () => {
    const clock = new FakeClock();
    const beatmap = makeBeatmap([obj('o1', 10), obj('o2', 12)], 15);
    const game = mountGame(root, beatmap, clock, { now: clock.now });

    playTo(clock, game.frame, 10.0);
    tap(root.querySelector('.obj[data-id="o1"]')!);
    playTo(clock, game.frame, 15.0); // o2 przepuszczone

    const results = root.querySelector<HTMLElement>('#results')!;
    expect(results.hidden).toBe(false);
    expect(root.querySelector('#r-score')!.textContent).toBe('1');
    expect(root.querySelector('#r-hits')!.textContent).toBe('1');
    expect(root.querySelector('#r-misses')!.textContent).toBe('1');
    expect(root.querySelector('#r-accuracy')!.textContent).toBe('50%');
  });
});
