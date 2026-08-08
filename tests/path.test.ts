import { describe, expect, it } from 'vitest';
import { samplePath } from '../src/engine/path.js';
import type { PathPoint } from '../src/engine/types.js';

describe('samplePath', () => {
  it('jeden punkt: zawsze zwraca jego wartosci', () => {
    const path: PathPoint[] = [{ t: 5, x: 30, y: 40, size: 100 }];
    expect(samplePath(path, 0)).toEqual({ x: 30, y: 40, size: 100 });
    expect(samplePath(path, 5)).toEqual({ x: 30, y: 40, size: 100 });
    expect(samplePath(path, 100)).toEqual({ x: 30, y: 40, size: 100 });
  });

  it('przed pierwszym punktem: przytrzymuje wartosci pierwszego', () => {
    const path: PathPoint[] = [
      { t: 5, x: 10, y: 20, size: 50 },
      { t: 10, x: 90, y: 80, size: 150 },
    ];
    expect(samplePath(path, 0)).toEqual({ x: 10, y: 20, size: 50 });
  });

  it('za ostatnim punktem: przytrzymuje wartosci ostatniego', () => {
    const path: PathPoint[] = [
      { t: 5, x: 10, y: 20, size: 50 },
      { t: 10, x: 90, y: 80, size: 150 },
    ];
    expect(samplePath(path, 999)).toEqual({ x: 90, y: 80, size: 150 });
  });

  it('dokladnie w punkcie: zwraca wartosci tego punktu (takze srodkowego)', () => {
    const path: PathPoint[] = [
      { t: 0, x: 0, y: 0, size: 50 },
      { t: 5, x: 40, y: 60, size: 100 },
      { t: 10, x: 90, y: 80, size: 150 },
    ];
    expect(samplePath(path, 0)).toEqual({ x: 0, y: 0, size: 50 });
    expect(samplePath(path, 5)).toEqual({ x: 40, y: 60, size: 100 });
    expect(samplePath(path, 10)).toEqual({ x: 90, y: 80, size: 150 });
  });

  it('polowa segmentu: x, y i size zlerpowane naraz', () => {
    const path: PathPoint[] = [
      { t: 0, x: 0, y: 0, size: 0 },
      { t: 10, x: 100, y: 200, size: 100 },
    ];
    expect(samplePath(path, 5)).toEqual({ x: 50, y: 100, size: 50 });
  });

  it('trzy punkty: wybiera wlasciwy segment, nie bierze wartosci z pierwszego', () => {
    const path: PathPoint[] = [
      { t: 0, x: 0, y: 0, size: 0 },
      { t: 10, x: 100, y: 100, size: 100 },
      { t: 20, x: 0, y: 0, size: 0 },
    ];
    expect(samplePath(path, 15)).toEqual({ x: 50, y: 50, size: 50 });
  });

  it('segmenty o roznej dlugosci czasowej: interpolacja liczona wzgledem wlasnego segmentu', () => {
    const path: PathPoint[] = [
      { t: 0, x: 0, y: 0, size: 0 },
      { t: 1, x: 100, y: 100, size: 100 },
      { t: 11, x: 200, y: 200, size: 200 },
    ];
    // Drugi segment trwa 10x dluzej niz pierwszy — polowa jego dlugosci to t=6.
    expect(samplePath(path, 6)).toEqual({ x: 150, y: 150, size: 150 });
  });
});
