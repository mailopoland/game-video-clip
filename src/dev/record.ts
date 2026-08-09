import { simplifyPath } from './rdp.js';
import type { Beatmap, BeatmapObject, PathPoint } from '../engine/types.js';

/** Minimalna dlugosc nagranej sciezki — krotszy gest dostaje dosyntetyzowany
    drugi punkt (rozstrzygniecie #4 w planie ADR-0016). */
export const MIN_PATH_SEC = 0.25;

function clamp0To100(value: number): number {
  return Math.min(100, Math.max(0, value));
}

/** Odwrotnosc `render.ts`: `.obj` jest pozycjonowany wzgledem `.overlay`
    (procent szerokosci/wysokosci), nigdy `.stage` (ADR-0016). */
export function toOverlayPercent(
  rect: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  if (rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
  return {
    x: clamp0To100(((clientX - rect.left) / rect.width) * 100),
    y: clamp0To100(((clientY - rect.top) / rect.height) * 100),
  };
}

/** Dopisuje probke, jesli jej `t` jest scisle wieksze od ostatniej — gwarantuje
    scisle rosnace `t` mimo ziarnistosci `getCurrentTime()`. Zwraca, czy dopisano. */
export function pushSample(
  samples: PathPoint[],
  sample: { t: number; x: number; y: number },
): boolean {
  const last = samples[samples.length - 1];
  if (last && sample.t <= last.t) return false;
  samples.push({ t: sample.t, x: sample.x, y: sample.y, size: 100 });
  return true;
}

/** Upraszcza nagrane probki do sciezki gotowej do zapisu w beatmapie. `null`,
    gdy nie ma z czego zbudowac sciezki (brak probek). */
export function buildPath(samples: PathPoint[]): PathPoint[] | null {
  if (samples.length === 0) return null;

  const simplified = simplifyPath(samples, 1.0);
  const first = simplified[0]!;
  const last = simplified[simplified.length - 1]!;

  if (simplified.length === 1 || last.t - first.t < MIN_PATH_SEC) {
    return [first, { t: first.t + MIN_PATH_SEC, x: first.x, y: first.y, size: 100 }];
  }

  return simplified;
}

/** `id` = `dev-<t*1000 zaokraglone>`, z sufiksem `-2`, `-3`… przy kolizji. */
export function nextObjectId(beatmap: Beatmap, firstT: number): string {
  const base = `dev-${Math.round(firstT * 1000)}`;
  const existing = new Set(beatmap.objects.map((o) => o.id));
  if (!existing.has(base)) return base;
  let n = 2;
  while (existing.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/** Kopia beatmapy z dopisanym obiektem, posortowana po `path[0].t`. */
export function insertObject(beatmap: Beatmap, object: BeatmapObject): Beatmap {
  const objects = [...beatmap.objects, object].sort((a, b) => a.path[0]!.t - b.path[0]!.t);
  return { ...beatmap, objects };
}

/** Kopia beatmapy bez obiektu o danym `id`. */
export function removeObject(beatmap: Beatmap, id: string): Beatmap {
  return { ...beatmap, objects: beatmap.objects.filter((o) => o.id !== id) };
}
