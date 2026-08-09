import { describe, expect, it } from 'vitest';
import { simplifyPath } from '../src/dev/rdp.js';
import type { PathPoint } from '../src/engine/types.js';

const p = (t: number, x: number, y: number): PathPoint => ({ t, x, y, size: 100 });

describe('simplifyPath', () => {
  it('sciezka dwupunktowa zostaje bez zmian', () => {
    const path = [p(0, 10, 10), p(1, 20, 20)];
    expect(simplifyPath(path)).toEqual(path);
  });

  it('redukuje punkty kolinearne (ruch po prostej ze stala predkoscia)', () => {
    const path = [p(0, 0, 0), p(1, 10, 10), p(2, 20, 20), p(3, 30, 30)];
    const simplified = simplifyPath(path, 1.0);
    expect(simplified).toEqual([p(0, 0, 0), p(3, 30, 30)]);
  });

  it('zawsze zachowuje pierwszy i ostatni punkt', () => {
    const path = [p(0, 0, 0), p(1, 50, 50), p(2, 100, 100)];
    const simplified = simplifyPath(path, 1.0);
    expect(simplified[0]).toEqual(path[0]);
    expect(simplified[simplified.length - 1]).toEqual(path[path.length - 1]);
  });

  it('nie usuwa przystanku w srodku odcinka prostego (metryka czasowa, nie przestrzenna)', () => {
    // Punkty sa przestrzennie kolinearne (0,0) -> (10,10) -> (10,10) -> (20,20),
    // ale reka "zatrzymala sie" w polowie zamiast poruszac sie ze stala predkoscia:
    // interpolacja PO CZASIE miedzy skrajnymi punktami (0,0)@t=0 i (20,20)@t=3
    // w chwili t=1 dalaby (6.67, 6.67), a t=2 dalaby (13.3, 13.3) — obie odlegle
    // od faktycznego (10,10), wiec przystanek musi przetrwac uproszczenie.
    const path = [p(0, 0, 0), p(1, 10, 10), p(2, 10, 10), p(3, 20, 20)];
    const simplified = simplifyPath(path, 1.0);
    expect(simplified.length).toBeGreaterThan(2);
  });

  it('respektuje tolerancje — male odchylenie ponizej progu jest usuwane', () => {
    const path = [p(0, 0, 0), p(1, 10.3, 10.3), p(2, 20, 20)];
    const simplified = simplifyPath(path, 1.0);
    expect(simplified).toEqual([p(0, 0, 0), p(2, 20, 20)]);
  });

  it('odchylenie powyzej progu jest zachowane', () => {
    const path = [p(0, 0, 0), p(1, 5, 15), p(2, 20, 20)];
    const simplified = simplifyPath(path, 1.0);
    expect(simplified).toEqual(path);
  });

  it('pojedynczy punkt zostaje bez zmian', () => {
    const path = [p(0, 5, 5)];
    expect(simplifyPath(path)).toEqual(path);
  });
});
