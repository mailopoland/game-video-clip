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

  it('odrzuca pozycje poza zakresem 0–100 w punkcie sciezki', () => {
    expect(() =>
      check(makeBeatmap([obj('o1', 1, { path: [{ t: 1, x: 120, y: 50, size: 100 }] })])),
    ).toThrow(/x poza zakresem/);
    expect(() =>
      check(makeBeatmap([obj('o1', 1, { path: [{ t: 1, x: 50, y: -5, size: 100 }] })])),
    ).toThrow(/y poza zakresem/);
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

  it('odrzuca niedodatni size w punkcie sciezki', () => {
    expect(() =>
      check(makeBeatmap([obj('o1', 1, { path: [{ t: 1, x: 50, y: 50, size: 0 }] })])),
    ).toThrow(/size/);
    expect(() =>
      check(makeBeatmap([obj('o1', 1, { path: [{ t: 1, x: 50, y: 50, size: -10 }] })])),
    ).toThrow(/size/);
  });

  it('odrzuca brak path', () => {
    expect(() =>
      check(makeBeatmap([obj('o1', 1, { path: undefined as never })])),
    ).toThrow(/path musi miec co najmniej jeden punkt/);
  });

  it('odrzuca pusta path', () => {
    expect(() => check(makeBeatmap([obj('o1', 1, { path: [] })]))).toThrow(
      /path musi miec co najmniej jeden punkt/,
    );
  });

  it('odrzuca t nierosnace w punktach path', () => {
    expect(() =>
      check(
        makeBeatmap([
          obj('o1', 1, {
            path: [
              { t: 1, x: 50, y: 50, size: 100 },
              { t: 0.5, x: 60, y: 60, size: 100 },
            ],
          }),
        ]),
      ),
    ).toThrow(/scisle rosnace po t/);
  });

  it('odrzuca zduplikowane t w punktach path', () => {
    expect(() =>
      check(
        makeBeatmap([
          obj('o1', 1, {
            path: [
              { t: 1, x: 50, y: 50, size: 100 },
              { t: 1, x: 60, y: 60, size: 100 },
            ],
          }),
        ]),
      ),
    ).toThrow(/scisle rosnace po t/);
  });

  it('odrzuca t = NaN w punkcie path', () => {
    expect(() =>
      check(makeBeatmap([obj('o1', 1, { path: [{ t: NaN, x: 50, y: 50, size: 100 }] })])),
    ).toThrow(/t musi byc skonczona liczba/);
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

  it('kazdy obiekt ma niepusta path', () => {
    for (const o of (beatmapJson as Beatmap).objects) {
      expect(o.path.length).toBeGreaterThan(0);
    }
  });
});
