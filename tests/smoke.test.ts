// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mountGame } from '../src/game.js';
import { SPRITES } from '../src/sprites.js';
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

  it('renderuje sprite obrazkowy jako <img> ze zrodlem z rejestru', () => {
    const clock = new FakeClock();
    const beatmap = makeBeatmap([obj('o1', 10, { duration: 1000, sprite: 'hand' })], 20);
    const game = mountGame(root, beatmap, clock, { now: clock.now });

    playTo(clock, game.frame, 9.5);
    const target = root.querySelector<HTMLElement>('.obj[data-id="o1"]')!;
    const img = target.querySelector<HTMLImageElement>('img.sprite');

    expect(img).not.toBeNull();
    const expectedSrc = (SPRITES.hand as { kind: 'image'; src: string }).src;
    expect(img!.src.endsWith(expectedSrc)).toBe(true);
  });

  it('trafienie podmienia grafike sprite-a na wariant "hit"', () => {
    const clock = new FakeClock();
    const beatmap = makeBeatmap([obj('o1', 10, { duration: 1000, hitWindowMs: 300 })], 20);
    const game = mountGame(root, beatmap, clock, { now: clock.now });

    playTo(clock, game.frame, 10.0);
    const target = root.querySelector<HTMLElement>('.obj[data-id="o1"]')!;
    tap(target);

    const img = target.querySelector<HTMLImageElement>('img.sprite')!;
    const expectedHitSrc = (SPRITES.hand as { kind: 'image'; hitSrc?: string }).hitSrc!;
    expect(img.src.endsWith(expectedHitSrc)).toBe(true);
  });

  it('okrag jest "uzbrojony" (mozna trafic) tylko w oknie tolerancji', () => {
    const clock = new FakeClock();
    const beatmap = makeBeatmap([obj('o1', 10, { duration: 1000, hitWindowMs: 200 })], 20);
    const game = mountGame(root, beatmap, clock, { now: clock.now });

    playTo(clock, game.frame, 9.5);
    const target = root.querySelector<HTMLElement>('.obj[data-id="o1"]')!;
    expect(target.classList.contains('is-armed')).toBe(false);

    playTo(clock, game.frame, 9.85);
    expect(target.classList.contains('is-armed')).toBe(true);

    playTo(clock, game.frame, 10.25);
    expect(target.classList.contains('is-armed')).toBe(false);
  });

  it('trafienie wylacza "uzbrojenie" okregu', () => {
    const clock = new FakeClock();
    const beatmap = makeBeatmap([obj('o1', 10, { duration: 1000, hitWindowMs: 300 })], 20);
    const game = mountGame(root, beatmap, clock, { now: clock.now });

    playTo(clock, game.frame, 10.0);
    const target = root.querySelector<HTMLElement>('.obj[data-id="o1"]')!;
    tap(target);

    expect(target.classList.contains('is-armed')).toBe(false);
  });

  it('pudlo nie podmienia grafiki sprite-a — zostaje wariant idle', () => {
    const clock = new FakeClock();
    const beatmap = makeBeatmap([obj('o1', 10, { duration: 1000, hitWindowMs: 200 })]);
    const game = mountGame(root, beatmap, clock, { now: clock.now });

    playTo(clock, game.frame, 9.2);
    const target = root.querySelector<HTMLElement>('.obj[data-id="o1"]')!;
    tap(target);

    const img = target.querySelector<HTMLImageElement>('img.sprite')!;
    const expectedSrc = (SPRITES.hand as { kind: 'image'; src: string }).src;
    expect(img.src.endsWith(expectedSrc)).toBe(true);
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

  it('ramka pelnego ekranu obejmuje scene razem z HUD-em', () => {
    const clock = new FakeClock();
    const game = mountGame(root, makeBeatmap([obj('o1', 10)]), clock, { now: clock.now });

    // Element idacy na pelny ekran musi zawierac wszystko, co ma byc widoczne —
    // to, co zostanie na zewnatrz, zaslania element w top layer (ADR-0010).
    const frame = game.ui.frame;
    expect(frame.contains(root.querySelector('#stage'))).toBe(true);
    expect(frame.contains(root.querySelector('#overlay'))).toBe(true);
    expect(frame.contains(root.querySelector('#gate'))).toBe(true);
    expect(frame.contains(root.querySelector('#results'))).toBe(true);
    expect(frame.contains(root.querySelector('.hud'))).toBe(true);
    expect(frame.contains(game.ui.playerHost)).toBe(true);
  });

  it('przycisk pelnego ekranu jest ukryty do czasu wlaczenia i zmienia etykiete', () => {
    const clock = new FakeClock();
    const game = mountGame(root, makeBeatmap([obj('o1', 10)]), clock, { now: clock.now });
    const button = root.querySelector<HTMLButtonElement>('#fullscreen')!;
    expect(button.hidden).toBe(true);

    const toggle = vi.fn();
    game.ui.enableFullscreen(toggle);
    expect(button.hidden).toBe(false);

    button.click();
    expect(toggle).toHaveBeenCalledTimes(1);

    game.ui.setFullscreenActive(true);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.textContent).toContain('Zamknij');
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
