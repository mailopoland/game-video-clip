import type { Beatmap } from './types.js';

/**
 * Waliduje beatmape wczytana z JSON-a (ADR-0004). Rzuca z czytelnym komunikatem
 * zamiast cicho ignorowac bledny obiekt.
 */
export function validateBeatmap(beatmap: Beatmap, spriteKeys: readonly string[]): Beatmap {
  if (!beatmap.videoId) throw new Error('Beatmapa: brak videoId.');
  if (beatmap.objects.length === 0) throw new Error('Beatmapa: pusta lista obiektow.');

  const seen = new Set<string>();
  let previousTime = -Infinity;

  for (const o of beatmap.objects) {
    const where = `Obiekt "${o.id}"`;
    if (seen.has(o.id)) throw new Error(`${where}: zduplikowane id.`);
    seen.add(o.id);

    if (o.time < previousTime) throw new Error(`${where}: obiekty musza byc posortowane po time.`);
    previousTime = o.time;

    if (o.x < 0 || o.x > 100) throw new Error(`${where}: x poza zakresem 0–100.`);
    if (o.y < 0 || o.y > 100) throw new Error(`${where}: y poza zakresem 0–100.`);
    if (o.duration <= 0) throw new Error(`${where}: duration musi byc dodatnie.`);
    if (o.hitWindowMs <= 0) throw new Error(`${where}: hitWindowMs musi byc dodatnie.`);
    if (o.hitWindowMs > o.duration) {
      throw new Error(`${where}: hitWindowMs > duration — okno trafienia otwiera sie, zanim obiekt sie pojawi.`);
    }
    if (!spriteKeys.includes(o.sprite)) {
      throw new Error(`${where}: nieznany sprite "${o.sprite}".`);
    }
  }

  return beatmap;
}
