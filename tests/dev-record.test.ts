import { describe, expect, it } from 'vitest';
import {
  buildPath,
  insertObject,
  nextObjectId,
  pushSample,
  removeObject,
  toOverlayPercent,
  clamp0To100,
  MIN_SIZE,
  updatePathPoint,
  computeDragResize,
  distancePercent,
  formatClock,
} from '../src/dev/record.js';
import { Engine } from '../src/engine/engine.js';
import { validateBeatmap } from '../src/engine/beatmap.js';
import { SPRITE_KEYS } from '../src/sprites.js';
import { FakeClock, makeBeatmap, obj } from './fake-clock.js';
import type { PathPoint } from '../src/engine/types.js';

describe('toOverlayPercent', () => {
  it('konwertuje wspolrzedne px na procenty wzgledem nie-zerowego rect', () => {
    const rect = { left: 100, top: 50, width: 400, height: 200 };
    expect(toOverlayPercent(rect, 100, 50)).toEqual({ x: 0, y: 0 });
    expect(toOverlayPercent(rect, 500, 250)).toEqual({ x: 100, y: 100 });
    expect(toOverlayPercent(rect, 300, 150)).toEqual({ x: 50, y: 50 });
  });

  it('round-trip: % -> px wg wzoru renderera -> z powrotem %', () => {
    const rect = { left: 20, top: 10, width: 300, height: 150 };
    const originalX = 37;
    const originalY = 62;
    const clientX = rect.left + (originalX / 100) * rect.width;
    const clientY = rect.top + (originalY / 100) * rect.height;
    const { x, y } = toOverlayPercent(rect, clientX, clientY);
    expect(x).toBeCloseTo(originalX, 6);
    expect(y).toBeCloseTo(originalY, 6);
  });

  it('clampuje poza rectem do 0-100', () => {
    const rect = { left: 0, top: 0, width: 100, height: 100 };
    expect(toOverlayPercent(rect, -50, -50)).toEqual({ x: 0, y: 0 });
    expect(toOverlayPercent(rect, 200, 200)).toEqual({ x: 100, y: 100 });
  });

  it('rect o zerowym rozmiarze (jsdom bez layoutu) daje {0, 0}', () => {
    const rect = { left: 0, top: 0, width: 0, height: 0 };
    expect(toOverlayPercent(rect, 50, 50)).toEqual({ x: 0, y: 0 });
  });
});

describe('pushSample', () => {
  it('odrzuca probki z t <= ostatnie t', () => {
    const samples: PathPoint[] = [];
    expect(pushSample(samples, { t: 1, x: 10, y: 10 })).toBe(true);
    expect(pushSample(samples, { t: 1, x: 20, y: 20 })).toBe(false);
    expect(pushSample(samples, { t: 0.5, x: 20, y: 20 })).toBe(false);
    expect(pushSample(samples, { t: 1.5, x: 30, y: 30 })).toBe(true);
    expect(samples).toHaveLength(2);
  });
});

describe('buildPath', () => {
  it('bardzo krotki klik (jedna probka) daje dwa punkty odlegle o 0.25s', () => {
    const samples: PathPoint[] = [{ t: 5, x: 40, y: 60, size: 100 }];
    const path = buildPath(samples);
    expect(path).toHaveLength(2);
    expect(path![0]).toEqual({ t: 5, x: 40, y: 60, size: 100 });
    expect(path![1]).toEqual({ t: 5.25, x: 40, y: 60, size: 100 });
  });

  it('krotka sciezka ponizej MIN_PATH_SEC tez dostaje dosyntetyzowany punkt', () => {
    const samples: PathPoint[] = [
      { t: 5, x: 40, y: 60, size: 100 },
      { t: 5.1, x: 41, y: 61, size: 100 },
    ];
    const path = buildPath(samples);
    expect(path![0]!.t).toBe(5);
    expect(path![path!.length - 1]!.t).toBeCloseTo(5.25, 6);
  });

  it('brak probek zwraca null', () => {
    expect(buildPath([])).toBeNull();
  });

  it('dluzsza sciezka jest upraszczana przez RDP, ale zostaje dluzsza niz 0.25s', () => {
    const samples: PathPoint[] = [
      { t: 0, x: 0, y: 0, size: 100 },
      { t: 0.5, x: 25, y: 25, size: 100 },
      { t: 1, x: 50, y: 50, size: 100 },
      { t: 1.5, x: 75, y: 75, size: 100 },
    ];
    const path = buildPath(samples);
    expect(path![0]!.t).toBe(0);
    expect(path![path!.length - 1]!.t).toBe(1.5);
  });
});

describe('nextObjectId', () => {
  it('generuje id z zaokraglonego t*1000', () => {
    const beatmap = makeBeatmap([]);
    expect(nextObjectId(beatmap, 3.5)).toBe('dev-3500');
  });

  it('dodaje sufiks przy kolizji', () => {
    const beatmap = makeBeatmap([
      { id: 'dev-3500', sprite: 'hand', path: [{ t: 3.5, x: 1, y: 1, size: 100 }, { t: 3.75, x: 1, y: 1, size: 100 }] },
    ]);
    expect(nextObjectId(beatmap, 3.5)).toBe('dev-3500-2');
  });
});

describe('insertObject / removeObject', () => {
  it('insertObject trzyma sortowanie po path[0].t', () => {
    const beatmap = makeBeatmap([obj('o1', 10)]);
    const newObject = { id: 'dev-5000', sprite: 'hand', path: [{ t: 5, x: 50, y: 50, size: 100 }, { t: 5.25, x: 50, y: 50, size: 100 }] };
    const updated = insertObject(beatmap, newObject);
    expect(updated.objects.map((o) => o.id)).toEqual(['dev-5000', 'o1']);
  });

  it('wynik insertObject przechodzi validateBeatmap z SPRITE_KEYS', () => {
    const beatmap = makeBeatmap([obj('o1', 10)]);
    const newObject = { id: 'dev-5000', sprite: 'hand', path: [{ t: 5, x: 50, y: 50, size: 100 }, { t: 5.25, x: 50, y: 50, size: 100 }] };
    const updated = insertObject(beatmap, newObject);
    expect(() => validateBeatmap(updated, SPRITE_KEYS)).not.toThrow();
  });

  it('removeObject usuwa obiekt o danym id', () => {
    const beatmap = makeBeatmap([obj('o1', 10), obj('o2', 20)]);
    const updated = removeObject(beatmap, 'o1');
    expect(updated.objects.map((o) => o.id)).toEqual(['o2']);
  });
});

describe('Engine.setObjects', () => {
  it('dodany obiekt z przeszlosci jest klikalny (w byId), ale nie widoczny, i nie rusza statystyk', () => {
    const clock = new FakeClock();
    const beatmap = makeBeatmap([obj('o1', 10)]);
    const engine = new Engine(beatmap, clock, clock.now);
    engine.tick();
    clock.advance(20);
    engine.tick(); // t=20, o1 juz rozstrzygniety jako miss (despawn 11)

    const statsBefore = engine.getStats();
    const past = obj('dev-5000', 5); // spawn 5, despawn 6 — w przeszlosci wzgledem t=20
    engine.setObjects([...beatmap.objects, past]);

    expect(engine.getView().visible.find((v) => v.object.id === 'dev-5000')).toBeUndefined();
    expect(engine.getOutcome('dev-5000')?.outcome).toBe('skipped');
    // Punktacja bez zmian; rosnie tylko `total` — mianownik ekranu wyniku
    // jest zawsze liczba obiektow aktualnej beatmapy (ADR-0025).
    expect(engine.getStats()).toEqual({ ...statsBefore, total: statsBefore.total + 1 });

    // Klikalny przez seek wstecz do jego okna:
    clock.seekTo(5.5);
    engine.tick();
    expect(engine.hit('dev-5000')).toBe(true);
  });

  it('usuniecie obiektu przez setObjects kasuje jego wynik ze statystyk', () => {
    const clock = new FakeClock();
    const beatmap = makeBeatmap([obj('o1', 10)]);
    const engine = new Engine(beatmap, clock, clock.now);
    engine.tick();
    clock.advance(10);
    engine.tick();
    engine.hit('o1');
    expect(engine.getStats().hits).toBe(1);

    engine.setObjects([]);
    expect(engine.getStats()).toEqual({ score: 0, hits: 0, misses: 0, accuracy: 0, total: 0 });
    expect(engine.getOutcome('o1')).toBeUndefined();
  });
});

describe('clamp0To100', () => {
  it('zwraca wartosc w przedziale 0-100 bez zmian', () => {
    expect(clamp0To100(0)).toBe(0);
    expect(clamp0To100(50)).toBe(50);
    expect(clamp0To100(100)).toBe(100);
  });

  it('clampuje wartosci ujemne do 0', () => {
    expect(clamp0To100(-10)).toBe(0);
    expect(clamp0To100(-0.5)).toBe(0);
  });

  it('clampuje wartosci wieksze niz 100 do 100', () => {
    expect(clamp0To100(150)).toBe(100);
    expect(clamp0To100(1000)).toBe(100);
  });
});

describe('MIN_SIZE', () => {
  it('jest wiekszy od zera', () => {
    expect(MIN_SIZE).toBeGreaterThan(0);
  });

  it('wynosi 1', () => {
    expect(MIN_SIZE).toBe(1);
  });
});

describe('updatePathPoint', () => {
  it('modyfikuje tylko wskazany punkt obiektu', () => {
    const beatmap = makeBeatmap([
      {
        id: 'o1',
        sprite: 'hand',
        path: [
          { t: 10, x: 20, y: 30, size: 100 },
          { t: 11, x: 40, y: 50, size: 100 },
        ],
      },
    ]);

    const updated = updatePathPoint(beatmap, 'o1', 0, { x: 60 });
    expect(updated.objects[0].path[0]).toEqual({ t: 10, x: 60, y: 30, size: 100 });
    expect(updated.objects[0].path[1]).toEqual({ t: 11, x: 40, y: 50, size: 100 });
  });

  it('clampuje x i y do 0-100', () => {
    const beatmap = makeBeatmap([
      {
        id: 'o1',
        sprite: 'hand',
        path: [{ t: 10, x: 50, y: 50, size: 100 }, { t: 11, x: 50, y: 50, size: 100 }],
      },
    ]);

    const updated = updatePathPoint(beatmap, 'o1', 0, { x: 150, y: -20 });
    expect(updated.objects[0].path[0]).toEqual({ t: 10, x: 100, y: 0, size: 100 });
  });

  it('clampuje size do >= MIN_SIZE', () => {
    const beatmap = makeBeatmap([
      {
        id: 'o1',
        sprite: 'hand',
        path: [{ t: 10, x: 50, y: 50, size: 100 }, { t: 11, x: 50, y: 50, size: 100 }],
      },
    ]);

    const updated = updatePathPoint(beatmap, 'o1', 0, { size: 0.5 });
    expect(updated.objects[0].path[0].size).toBe(MIN_SIZE);
  });

  it('zwraca niezmieniona beatmape dla nieznanego objectId', () => {
    const beatmap = makeBeatmap([obj('o1', 10)]);
    const updated = updatePathPoint(beatmap, 'unknown', 0, { x: 60 });
    expect(updated).toBe(beatmap);
  });

  it('zwraca niezmieniona beatmape dla pointIndex poza zakresem', () => {
    const beatmap = makeBeatmap([
      {
        id: 'o1',
        sprite: 'hand',
        path: [
          { t: 10, x: 20, y: 30, size: 100 },
          { t: 11, x: 40, y: 50, size: 100 },
        ],
      },
    ]);

    const updated1 = updatePathPoint(beatmap, 'o1', -1, { x: 60 });
    expect(updated1).toBe(beatmap);

    const updated2 = updatePathPoint(beatmap, 'o1', 2, { x: 60 });
    expect(updated2).toBe(beatmap);
  });

  it('zwraca niezmieniona beatmape gdy brak zmian', () => {
    const beatmap = makeBeatmap([
      {
        id: 'o1',
        sprite: 'hand',
        path: [{ t: 10, x: 50, y: 50, size: 100 }, { t: 11, x: 50, y: 50, size: 100 }],
      },
    ]);

    const updated = updatePathPoint(beatmap, 'o1', 0, {});
    expect(updated).toBe(beatmap);
  });

  it('modyfikuje t punktu', () => {
    const beatmap = makeBeatmap([
      {
        id: 'o1',
        sprite: 'hand',
        path: [
          { t: 10, x: 20, y: 30, size: 100 },
          { t: 11, x: 40, y: 50, size: 100 },
        ],
      },
    ]);

    const updated = updatePathPoint(beatmap, 'o1', 0, { t: 10.5 });
    expect(updated.objects[0].path[0]).toEqual({ t: 10.5, x: 20, y: 30, size: 100 });
  });

  it('nie mutuje oryginalnej beatmapy', () => {
    const beatmap = makeBeatmap([
      {
        id: 'o1',
        sprite: 'hand',
        path: [
          { t: 10, x: 20, y: 30, size: 100 },
          { t: 11, x: 40, y: 50, size: 100 },
        ],
      },
    ]);

    const originalPath = beatmap.objects[0].path[0];
    updatePathPoint(beatmap, 'o1', 0, { x: 60 });
    expect(beatmap.objects[0].path[0]).toEqual(originalPath);
  });
});

describe('computeDragResize', () => {
  it('podwojenie dystansu podwaja rozmiar', () => {
    const result = computeDragResize(100, 50, 100);
    expect(result).toBeCloseTo(200, 5);
  });

  it('polowienie dystansu polawia rozmiar', () => {
    const result = computeDragResize(100, 50, 25);
    expect(result).toBeCloseTo(50, 5);
  });

  it('zwraca initialSize gdy initialDistance <= 0', () => {
    expect(computeDragResize(100, 0, 50)).toBe(100);
    expect(computeDragResize(100, -10, 50)).toBe(100);
  });

  it('wynik nigdy nie jest mniejszy niz MIN_SIZE', () => {
    const result = computeDragResize(50, 100, 1);
    expect(result).toBeGreaterThanOrEqual(MIN_SIZE);
  });

  it('przeciagniecie blisze do centrum (zmniejszenie dystansu) zmniejsza rozmiar', () => {
    const result = computeDragResize(100, 100, 50);
    expect(result).toBeCloseTo(50, 5);
  });
});

describe('distancePercent', () => {
  it('trojkat 3-4-5 daje dystans 5', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 3, y: 4 };
    expect(distancePercent(a, b)).toBeCloseTo(5, 5);
  });

  it('identyczne punkty daja dystans 0', () => {
    const a = { x: 50, y: 50 };
    const b = { x: 50, y: 50 };
    expect(distancePercent(a, b)).toBe(0);
  });

  it('pionowy dystans jest liczony poprawnie', () => {
    const a = { x: 50, y: 0 };
    const b = { x: 50, y: 100 };
    expect(distancePercent(a, b)).toBeCloseTo(100, 5);
  });

  it('poziomy dystans jest liczony poprawnie', () => {
    const a = { x: 0, y: 50 };
    const b = { x: 100, y: 50 };
    expect(distancePercent(a, b)).toBeCloseTo(100, 5);
  });

  it('dystans od srodka (50, 50) do rogu (0, 0) wynosi okolo 70.7', () => {
    const a = { x: 50, y: 50 };
    const b = { x: 0, y: 0 };
    expect(distancePercent(a, b)).toBeCloseTo(Math.sqrt(5000), 1);
  });
});

describe('formatClock', () => {
  it('formatuje czas ponizej minuty', () => {
    expect(formatClock(23.45)).toBe('0:23.45');
  });

  it('formatuje czas z pelnymi minutami', () => {
    expect(formatClock(83.45)).toBe('1:23.45');
  });

  it('dwucyfrowe minuty', () => {
    expect(formatClock(725)).toBe('12:05.00');
  });

  it('zaokragla setne w gore', () => {
    expect(formatClock(1.006)).toBe('0:01.01');
  });

  it('zero daje 0:00.00', () => {
    expect(formatClock(0)).toBe('0:00.00');
  });

  it('wartosci ujemne clampuja do 0:00.00', () => {
    expect(formatClock(-5)).toBe('0:00.00');
  });
});
