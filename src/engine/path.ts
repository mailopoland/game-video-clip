import type { PathPoint } from './types.js';

/**
 * Pozycja i rozmiar obiektu w danej sekundzie wideo (ADR-0014).
 * Interpolacja liniowa miedzy sasiednimi punktami; poza zakresem sciezki
 * przytrzymanie skrajnego punktu. Sciezki sa krotkie, wiec skan liniowy.
 */
export function samplePath(
  path: PathPoint[],
  timeSec: number,
): { x: number; y: number; size: number } {
  const first = path[0]!;
  if (path.length === 1 || timeSec <= first.t) {
    return { x: first.x, y: first.y, size: first.size };
  }

  const last = path[path.length - 1]!;
  if (timeSec >= last.t) {
    return { x: last.x, y: last.y, size: last.size };
  }

  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]!;
    const b = path[i + 1]!;
    if (timeSec >= a.t && timeSec <= b.t) {
      const u = (timeSec - a.t) / (b.t - a.t);
      return {
        x: a.x + (b.x - a.x) * u,
        y: a.y + (b.y - a.y) * u,
        size: a.size + (b.size - a.size) * u,
      };
    }
  }

  // Nieosiagalne: petla pokrywa cala domene miedzy first.t a last.t.
  return { x: last.x, y: last.y, size: last.size };
}
