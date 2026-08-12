// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { createUi } from '../src/ui/render.js';

describe('dev-edit-hand: Ui.setHandSelection', () => {
  let root: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    root = document.querySelector<HTMLElement>('#app')!;
  });

  it('tworzy .dev-selection-ring z uchwytem rozmiaru i poprawna pozycja', () => {
    const ui = createUi(root, { onStart: () => {}, onHit: () => {} });

    ui.setHandSelection({ x: 30, y: 40, size: 50 });

    const ring = ui.overlay.querySelector<HTMLElement>('.dev-selection-ring');
    expect(ring).not.toBeNull();
    expect(ring!.style.left).toBe('30%');
    expect(ring!.style.top).toBe('40%');
    expect(ring!.style.width).toBe(`${(16 * 50) / 100}%`);
    expect(ring!.querySelector('.dev-size-handle')).not.toBeNull();
  });

  it('aktualizuje istniejacy element zamiast tworzyc duplikat', () => {
    const ui = createUi(root, { onStart: () => {}, onHit: () => {} });

    ui.setHandSelection({ x: 10, y: 10, size: 20 });
    ui.setHandSelection({ x: 60, y: 70, size: 80 });

    const rings = ui.overlay.querySelectorAll('.dev-selection-ring');
    expect(rings.length).toBe(1);
    const ring = rings[0] as HTMLElement;
    expect(ring.style.left).toBe('60%');
    expect(ring.style.top).toBe('70%');
    expect(ring.style.width).toBe(`${(16 * 80) / 100}%`);
  });

  it('usuwa element, gdy przekazane jest null', () => {
    const ui = createUi(root, { onStart: () => {}, onHit: () => {} });

    ui.setHandSelection({ x: 10, y: 10, size: 20 });
    expect(ui.overlay.querySelector('.dev-selection-ring')).not.toBeNull();

    ui.setHandSelection(null);
    expect(ui.overlay.querySelector('.dev-selection-ring')).toBeNull();
  });
});
