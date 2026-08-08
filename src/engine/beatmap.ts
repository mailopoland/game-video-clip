import type { Beatmap } from './types.js';

/**
 * Waliduje beatmape wczytana z JSON-a (ADR-0004). Rzuca z czytelnym komunikatem
 * zamiast cicho ignorowac bledny obiekt.
 */
export function validateBeatmap(beatmap: Beatmap, spriteKeys: readonly string[]): Beatmap {
  if (!beatmap.videoId) throw new Error('Beatmapa: brak videoId.');
  if (beatmap.objects.length === 0) throw new Error('Beatmapa: pusta lista obiektow.');

  const seen = new Set<string>();
  let previousSpawn = -Infinity;

  for (const o of beatmap.objects) {
    const where = `Obiekt "${o.id}"`;
    if (seen.has(o.id)) throw new Error(`${where}: zduplikowane id.`);
    seen.add(o.id);

    if (!spriteKeys.includes(o.sprite)) {
      throw new Error(`${where}: nieznany sprite "${o.sprite}".`);
    }

    if (!Array.isArray(o.path) || o.path.length < 2) {
      throw new Error(`${where}: path musi miec co najmniej dwa punkty (start i koniec).`);
    }

    if (o.path[0]!.t < previousSpawn) {
      throw new Error(`${where}: obiekty musza byc posortowane po path[0].t.`);
    }
    previousSpawn = o.path[0]!.t;

    let previousPointTime = -Infinity;
    o.path.forEach((point, index) => {
      const whereP = `${where}: path[${index}]`;
      if (!Number.isFinite(point.t)) throw new Error(`${whereP}: t musi byc skonczona liczba.`);
      if (point.x < 0 || point.x > 100) throw new Error(`${whereP}: x poza zakresem 0–100.`);
      if (point.y < 0 || point.y > 100) throw new Error(`${whereP}: y poza zakresem 0–100.`);
      if (point.size <= 0) throw new Error(`${whereP}: size musi byc dodatnie.`);
      if (point.t <= previousPointTime) {
        throw new Error(`${where}: punkty path musza byc scisle rosnace po t.`);
      }
      previousPointTime = point.t;
    });
  }

  return beatmap;
}
