import type { PathPoint } from '../engine/types.js';

/**
 * Uproszczenie sciezki (Ramer-Douglas-Peucker), ale z metryka bledu liczaca
 * odchylenie od interpolacji PO CZASIE miedzy kandydatami na skraje segmentu —
 * nie klasyczna odlegloscia prostopadla do prostej. Klasyczne RDP na (x, y)
 * zgubiloby zmiany predkosci (przystanek) na odcinku, ktory w przestrzeni jest
 * prosty, ale w czasie nie jest liniowy — a to dokladnie ten blad, ktory
 * zobaczy gracz (ADR-0016).
 */
export function simplifyPath(points: PathPoint[], tolerance = 1.0): PathPoint[] {
  if (points.length <= 2) return points;

  function interpXY(a: PathPoint, b: PathPoint, t: number): { x: number; y: number } {
    if (b.t === a.t) return { x: a.x, y: a.y };
    const u = (t - a.t) / (b.t - a.t);
    return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
  }

  function maxDeviation(start: number, end: number): { index: number; dist: number } {
    const a = points[start]!;
    const b = points[end]!;
    let maxIndex = -1;
    let maxDist = -1;
    for (let i = start + 1; i < end; i++) {
      const p = points[i]!;
      const { x, y } = interpXY(a, b, p.t);
      const dist = Math.hypot(p.x - x, p.y - y);
      if (dist > maxDist) {
        maxDist = dist;
        maxIndex = i;
      }
    }
    return { index: maxIndex, dist: maxDist };
  }

  function simplify(start: number, end: number): PathPoint[] {
    const { index, dist } = maxDeviation(start, end);
    if (index === -1 || dist <= tolerance) {
      return [points[start]!, points[end]!];
    }
    const left = simplify(start, index);
    const right = simplify(index, end);
    return [...left.slice(0, -1), ...right];
  }

  return simplify(0, points.length - 1);
}
