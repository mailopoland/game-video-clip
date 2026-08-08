import { describe, expect, it } from 'vitest';
import { Engine } from '../src/engine/engine.js';
import { FakeClock, makeBeatmap, obj } from './fake-clock.js';

function setup(objects = [obj('o1', 10)], endScreenAtSec = 999) {
  const clock = new FakeClock();
  const engine = new Engine(makeBeatmap(objects, endScreenAtSec), clock, clock.now);
  engine.tick(); // pierwsza klatka: wejscie w stan PLAYING w t=0
  return { clock, engine };
}

/** Odtwarza wideo do `targetSec` malymi krokami, jak realna petla rAF. */
function playTo(clock: FakeClock, engine: Engine, targetSec: number, stepSec = 0.016): void {
  while (clock.timeSec < targetSec - 1e-9) {
    clock.advance(Math.min(stepSec, targetSec - clock.timeSec));
    engine.tick();
  }
}

const spawnAt9DespawnAt10 = [
  { t: 9, x: 50, y: 50, size: 100 },
  { t: 10, x: 50, y: 50, size: 100 },
];

describe('spawn obiektu', () => {
  it('nie pokazuje obiektu przed path[0].t (spawn)', () => {
    const { clock, engine } = setup([obj('o1', 10, { path: spawnAt9DespawnAt10 })]);
    playTo(clock, engine, 8.9);
    expect(engine.getView().visible).toHaveLength(0);
  });

  it('pokazuje obiekt dokladnie od path[0].t', () => {
    const { clock, engine } = setup([obj('o1', 10, { path: spawnAt9DespawnAt10 })]);
    playTo(clock, engine, 9.0);
    const spawned = engine.getView().visible;
    expect(spawned).toHaveLength(1);
    expect(spawned[0]!.object.id).toBe('o1');
  });
});

describe('ocena trafienia — reka klikalna przez caly czas trwania sciezki', () => {
  it('klik zaraz po spawnie to trafienie i +1 punkt', () => {
    const { clock, engine } = setup([obj('o1', 10)]); // spawn 10, despawn 11
    playTo(clock, engine, 10.0);

    expect(engine.hit('o1')).toBe(true);
    expect(engine.getOutcome('o1')?.outcome).toBe('hit');
    expect(engine.getStats()).toMatchObject({ score: 1, hits: 1, misses: 0, accuracy: 100 });
  });

  it('klik w polowie okna aktywnosci to trafienie', () => {
    const { clock, engine } = setup([obj('o1', 10)]);
    playTo(clock, engine, 10.5);
    expect(engine.hit('o1')).toBe(true);
  });

  it('klik tuz przed despawnem to trafienie', () => {
    const { clock, engine } = setup([obj('o1', 10)]);
    playTo(clock, engine, 10.99);
    expect(engine.hit('o1')).toBe(true);
  });

  it('brak kliku do konca sciezki (despawn) to pudlo', () => {
    const { clock, engine } = setup([obj('o1', 10)]); // despawn 11
    playTo(clock, engine, 10.9);
    expect(engine.getOutcome('o1')).toBeUndefined();

    playTo(clock, engine, 11.05);
    expect(engine.getOutcome('o1')?.outcome).toBe('miss');
    expect(engine.getStats()).toMatchObject({ score: 0, misses: 1 });
  });

  it('drugi klik w ten sam obiekt nie zmienia wyniku', () => {
    const { clock, engine } = setup([obj('o1', 10)]);
    playTo(clock, engine, 10.0);

    expect(engine.hit('o1')).toBe(true);
    expect(engine.hit('o1')).toBe(false);
    expect(engine.getStats().score).toBe(1);
  });

  it('klik w obiekt, ktory jeszcze nie spawnowal, jest ignorowany', () => {
    const { clock, engine } = setup([obj('o1', 10)]);
    playTo(clock, engine, 5);

    expect(engine.hit('o1')).toBe(false);
    expect(engine.getOutcome('o1')).toBeUndefined();
  });
});

describe('pauza i buffering zamrazaja gre', () => {
  it('nie posuwa czasu gry, nie spawnuje i nie ocenia mimo uplywu zegara sciennego', () => {
    const { clock, engine } = setup([obj('o1', 10)]);
    playTo(clock, engine, 8.5);
    const frozenAt = engine.getView().timeSec;

    clock.playing = false;
    for (let i = 0; i < 200; i++) {
      clock.advanceWallOnly(0.05); // 10 s realnego czasu na pauzie
      engine.tick();
    }

    const view = engine.getView();
    expect(view.frozen).toBe(true);
    expect(view.timeSec).toBeCloseTo(frozenAt, 5);
    expect(view.visible).toHaveLength(0);
    expect(engine.getStats()).toMatchObject({ hits: 0, misses: 0 });
  });

  it('ignoruje klikniecia w stanie zamrozonym', () => {
    const { clock, engine } = setup([obj('o1', 10)]);
    playTo(clock, engine, 10.0);

    clock.playing = false;
    engine.tick();

    expect(engine.hit('o1')).toBe(false);
    expect(engine.getOutcome('o1')).toBeUndefined();
  });

  it('wznowienie po pauzie nie generuje falszywego przewiniecia ani pudel', () => {
    const { clock, engine } = setup([obj('o1', 10)]);
    playTo(clock, engine, 9.5);

    clock.playing = false;
    for (let i = 0; i < 100; i++) {
      clock.advanceWallOnly(0.05);
      engine.tick();
    }
    clock.playing = true;
    engine.tick();

    expect(engine.getView().timeSec).toBeCloseTo(9.5, 1);
    expect(engine.getStats()).toMatchObject({ hits: 0, misses: 0 });
    expect(engine.hit('o1')).toBe(false); // wciaz przed spawnem, ale gra dziala
  });
});

describe('przewijanie', () => {
  it('seek do tylu resetuje wyniki obiektow z przyszlosci i nie podwaja punktow', () => {
    const { clock, engine } = setup([obj('o1', 10), obj('o2', 20)]);
    playTo(clock, engine, 10.0);
    expect(engine.hit('o1')).toBe(true);
    expect(engine.getStats().score).toBe(1);

    clock.seekTo(5);
    engine.tick();
    expect(engine.getOutcome('o1')).toBeUndefined();
    expect(engine.getStats().score).toBe(0);

    playTo(clock, engine, 10.0);
    expect(engine.hit('o1')).toBe(true);
    expect(engine.getStats()).toMatchObject({ score: 1, hits: 1, misses: 0 });
  });

  it('seek do tylu nie kasuje wynikow obiektow pozostajacych w przeszlosci', () => {
    const { clock, engine } = setup([obj('o1', 10), obj('o2', 30)]);
    playTo(clock, engine, 10.0);
    engine.hit('o1');

    clock.seekTo(20);
    engine.tick();
    clock.seekTo(15);
    engine.tick();

    expect(engine.getOutcome('o1')?.outcome).toBe('hit');
    expect(engine.getStats().score).toBe(1);
  });

  it('seek do przodu oznacza pominiete obiekty jako skipped, bez falszywych pudel', () => {
    const { clock, engine } = setup([obj('o1', 10), obj('o2', 20), obj('o3', 40)]);
    playTo(clock, engine, 5);

    clock.seekTo(30);
    engine.tick();

    expect(engine.getOutcome('o1')?.outcome).toBe('skipped');
    expect(engine.getOutcome('o2')?.outcome).toBe('skipped');
    expect(engine.getOutcome('o3')).toBeUndefined();
    expect(engine.getStats()).toMatchObject({ score: 0, hits: 0, misses: 0, accuracy: 0 });
    expect(engine.getView().visible).toHaveLength(0); // zero "duchow"
  });

  it('obiekty skipped nie wchodza do mianownika celnosci', () => {
    const { clock, engine } = setup([obj('o1', 10), obj('o2', 20), obj('o3', 40)]);
    playTo(clock, engine, 5);
    clock.seekTo(30);
    engine.tick();

    playTo(clock, engine, 40.05);
    expect(engine.hit('o3')).toBe(true);

    expect(engine.getStats()).toMatchObject({ score: 1, hits: 1, misses: 0, accuracy: 100 });
  });

  it('przewiniecie w trakcie pauzy tez resynchronizuje stan', () => {
    const { clock, engine } = setup([obj('o1', 10), obj('o2', 20)]);
    playTo(clock, engine, 5);

    clock.playing = false;
    clock.seekTo(30);
    engine.tick();

    expect(engine.getOutcome('o1')?.outcome).toBe('skipped');
    expect(engine.getView().timeSec).toBeCloseTo(30, 5);
    expect(engine.getStats().misses).toBe(0);
  });
});

describe('punktacja i ekran wyniku', () => {
  it('zlicza punkty, trafienia, pudla i celnosc', () => {
    const objects = [obj('o1', 10), obj('o2', 12), obj('o3', 14), obj('o4', 16)];
    const { clock, engine } = setup(objects);

    playTo(clock, engine, 10.0);
    engine.hit('o1');
    playTo(clock, engine, 12.0);
    engine.hit('o2');
    playTo(clock, engine, 14.0);
    engine.hit('o3');
    playTo(clock, engine, 17.05); // o4 (spawn 16, despawn 17) przepuszczone

    expect(engine.getStats()).toMatchObject({ score: 3, hits: 3, misses: 1 });
    expect(engine.getStats().accuracy).toBeCloseTo(75, 5);
  });

  it('pokazuje ekran wyniku od endScreenAtSec', () => {
    const { clock, engine } = setup([obj('o1', 10)], 20);
    playTo(clock, engine, 19.0);
    expect(engine.getView().showResults).toBe(false);

    playTo(clock, engine, 20.0);
    expect(engine.getView().showResults).toBe(true);
  });

  it('pokazuje ekran wyniku po zakonczeniu wideo', () => {
    const { clock, engine } = setup([obj('o1', 10)], 999);
    playTo(clock, engine, 11.0);
    expect(engine.getView().showResults).toBe(false);

    clock.playing = false;
    clock.ended = true;
    engine.tick();
    expect(engine.getView().showResults).toBe(true);
  });
});

describe('sciezka ruchu', () => {
  const movingPath = [
    { t: 9, x: 0, y: 0, size: 50 },
    { t: 10, x: 100, y: 100, size: 150 },
  ];

  it('getView() zwraca zinterpolowana pozycje w polowie segmentu', () => {
    const { clock, engine } = setup([obj('o1', 10, { path: movingPath })]);
    playTo(clock, engine, 9.5);

    const visible = engine.getView().visible[0]!;
    expect(visible.x).toBeCloseTo(50, 5);
    expect(visible.y).toBeCloseTo(50, 5);
    expect(visible.size).toBeCloseTo(100, 5);
  });

  it('pauza: advanceWallOnly nie rusza pozycji', () => {
    const { clock, engine } = setup([obj('o1', 10, { path: movingPath })]);
    playTo(clock, engine, 9.5);
    const before = engine.getView().visible[0]!;

    clock.playing = false;
    clock.advanceWallOnly(10);
    engine.tick();

    const after = engine.getView().visible[0]!;
    expect(after.x).toBeCloseTo(before.x, 5);
    expect(after.y).toBeCloseTo(before.y, 5);
    expect(after.size).toBeCloseTo(before.size, 5);
  });

  it('seek w tyl: pozycja odpowiada nowemu czasowi, bez dryfu', () => {
    const { clock, engine } = setup([obj('o1', 10, { path: movingPath })]);
    playTo(clock, engine, 9.8);

    clock.seekTo(9.2);
    engine.tick();

    const visible = engine.getView().visible[0]!;
    expect(visible.x).toBeCloseTo(20, 5);
    expect(visible.y).toBeCloseTo(20, 5);
    expect(visible.size).toBeCloseTo(70, 5);
  });
});

describe('interpolacja czasu', () => {
  it('wygladza ziarnistosc getCurrentTime miedzy odczytami', () => {
    const clock = new FakeClock();
    const engine = new Engine(makeBeatmap([obj('o1', 10)]), clock, clock.now);
    engine.tick();

    // getCurrentTime stoi w miejscu, ale zegar scienny idzie do przodu:
    // czas gry ma plynac dalej, zeby pozycja na sciezce sie nie zacinala.
    clock.wallMs += 100;
    engine.tick();

    expect(engine.getView().timeSec).toBeCloseTo(0.1, 3);
    expect(engine.getStats().misses).toBe(0);
  });

  it('nie traktuje zwyklego szumu odczytu jako przewiniecia', () => {
    const { clock, engine } = setup([obj('o1', 10)]);
    playTo(clock, engine, 5);

    clock.timeSec -= 0.2; // szum ponizej progu SEEK_THRESHOLD_SEC
    clock.wallMs += 16;
    engine.tick();

    expect(engine.getView().timeSec).toBeGreaterThanOrEqual(5);
  });
});
