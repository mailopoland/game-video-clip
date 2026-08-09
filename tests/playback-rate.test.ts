import { describe, expect, it } from 'vitest';
import { Engine } from '../src/engine/engine.js';
import { FakeClock, makeBeatmap, obj } from './fake-clock.js';

function setup(objects = [obj('o1', 10)], endScreenAtSec = 999) {
  const clock = new FakeClock();
  const engine = new Engine(makeBeatmap(objects, endScreenAtSec), clock, clock.now);
  engine.tick(); // pierwsza klatka: wejscie w stan PLAYING w t=0
  return { clock, engine };
}

/** Odtwarza wideo do `targetSec` malymi krokami wideo, przy zadanym tempie. */
function playToAtRate(
  clock: FakeClock,
  engine: Engine,
  targetSec: number,
  rate: number,
  stepSec = 0.016,
): void {
  while (clock.timeSec < targetSec - 1e-9) {
    clock.advanceAtRate(Math.min(stepSec, targetSec - clock.timeSec), rate);
    engine.tick();
  }
}

describe('tempo odtwarzania (playbackRate) w modelu czasu', () => {
  it('0.25x przez ~5s wideo nie powoduje falszywego resync (obiekt z przyszlosci zostaje trafialny)', () => {
    const { clock, engine } = setup([obj('future', 6)]); // spawn w t=6, poza zasiegiem tego testu
    playToAtRate(clock, engine, 5, 0.25);
    // Gdyby wystapil falszywy resync/seek w przod, obiekt zostalby oznaczony jako 'skipped'.
    expect(engine.getOutcome('future')).toBeUndefined();
    expect(engine.getView().timeSec).toBeCloseTo(5, 1);
  });

  it('2x jest rowniez stabilne (brak falszywego resync)', () => {
    const { clock, engine } = setup([obj('future', 6)]);
    playToAtRate(clock, engine, 5, 2);
    expect(engine.getOutcome('future')).toBeUndefined();
    expect(engine.getView().timeSec).toBeCloseTo(5, 1);
  });

  it('prawdziwy seek jest nadal wykrywany przy 0.25x', () => {
    const { clock, engine } = setup([obj('o1', 10)]);
    playToAtRate(clock, engine, 3, 0.25);
    clock.seekTo(20);
    engine.tick();
    // Seek w przod przed spawnem obiektu w t=10..11: obiekt powinien dostac 'skipped'.
    expect(engine.getOutcome('o1')?.outcome).toBe('skipped');
  });

  it('brak podanego rate zachowuje sie jak dotychczas (domyslnie 1x)', () => {
    const clock = new FakeClock();
    const engine = new Engine(makeBeatmap([obj('o1', 10)]), clock, clock.now);
    engine.tick();
    // sample() bez pola rate (symulacja starego TimeSource).
    const rawSample = clock.sample.bind(clock);
    clock.sample = () => {
      const s = rawSample();
      return { timeSec: s.timeSec, playing: s.playing, ended: s.ended };
    };
    clock.advance(9);
    engine.tick();
    expect(engine.getView().timeSec).toBeCloseTo(9, 1);
    expect(engine.getOutcome('o1')).toBeUndefined();
  });
});
