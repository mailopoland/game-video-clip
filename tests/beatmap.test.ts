import { describe, expect, it } from 'vitest';
import { validateBeatmap } from '../src/engine/beatmap.js';
import { SPRITE_KEYS } from '../src/sprites.js';
import beatmapJson from '../src/data/beatmap.json';
import type { Beatmap } from '../src/engine/types.js';
import { makeBeatmap, obj } from './fake-clock.js';

const check = (beatmap: Beatmap) => validateBeatmap(beatmap, ['hand']);

describe('validateBeatmap', () => {
  it('przepuszcza poprawna beatmape', () => {
    expect(() => check(makeBeatmap([obj('o1', 1), obj('o2', 2)]))).not.toThrow();
  });

  it('odrzuca zduplikowane id', () => {
    expect(() => check(makeBeatmap([obj('o1', 1), obj('o1', 2)]))).toThrow(/zduplikowane id/);
  });

  it('odrzuca obiekty nieposortowane po czasie', () => {
    expect(() => check(makeBeatmap([obj('o1', 5), obj('o2', 2)]))).toThrow(/posortowane/);
  });

  it('odrzuca pozycje poza zakresem 0–100', () => {
    expect(() => check(makeBeatmap([obj('o1', 1, { x: 120 })]))).toThrow(/x poza zakresem/);
    expect(() => check(makeBeatmap([obj('o1', 1, { y: -5 })]))).toThrow(/y poza zakresem/);
  });

  it('odrzuca nieznany sprite', () => {
    expect(() => check(makeBeatmap([obj('o1', 1, { sprite: 'brak' })]))).toThrow(/nieznany sprite/);
  });

  it('odrzuca niedodatnie duration i hitWindowMs', () => {
    expect(() => check(makeBeatmap([obj('o1', 1, { duration: 0 })]))).toThrow(/duration/);
    expect(() => check(makeBeatmap([obj('o1', 1, { hitWindowMs: 0 })]))).toThrow(/hitWindowMs/);
  });

  it('odrzuca okno trafienia szersze niz faza approach', () => {
    expect(() => check(makeBeatmap([obj('o1', 1, { duration: 200, hitWindowMs: 500 })]))).toThrow(
      /zanim obiekt sie pojawi/,
    );
  });

  it('odrzuca pusta beatmape', () => {
    expect(() => check(makeBeatmap([]))).toThrow(/pusta/);
  });
});

describe('beatmapa produkcyjna', () => {
  it('jest poprawna wzgledem rejestru sprite-ow', () => {
    expect(() => validateBeatmap(beatmapJson as Beatmap, SPRITE_KEYS)).not.toThrow();
  });

  it('uzywa kazdego sprite-a z rejestru', () => {
    const used = new Set((beatmapJson as Beatmap).objects.map((o) => o.sprite));
    expect(used).toEqual(new Set(SPRITE_KEYS));
  });

  it('wskazuje docelowy klip', () => {
    expect((beatmapJson as Beatmap).videoId).toBe('5OyTxEbT-fM');
  });

  it('nie uzywa juz usunietych sprite-ow guy/girl', () => {
    const used = (beatmapJson as Beatmap).objects.map((o) => o.sprite);
    expect(used).not.toContain('guy');
    expect(used).not.toContain('girl');
  });
});
