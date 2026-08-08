import type { Beatmap, TimeSample, TimeSource } from '../src/engine/types.js';

/**
 * Wstrzykiwane zrodlo czasu (ADR-0006). Czas wideo i zegar scienny sa sterowane
 * recznie i niezaleznie — dzieki temu da sie odtworzyc pauze, buffering i seek.
 */
export class FakeClock implements TimeSource {
  timeSec = 0;
  playing = true;
  ended = false;
  wallMs = 0;

  sample(): TimeSample {
    return { timeSec: this.timeSec, playing: this.playing, ended: this.ended };
  }

  now = (): number => this.wallMs;

  /** Normalne odtwarzanie: czas wideo i zegar scienny plyna razem. */
  advance(sec: number): void {
    this.timeSec += sec;
    this.wallMs += sec * 1000;
  }

  /** Tylko zegar scienny — tak wyglada pauza i buffering z punktu widzenia gry. */
  advanceWallOnly(sec: number): void {
    this.wallMs += sec * 1000;
  }

  /** Przewiniecie: skok czasu wideo bez odpowiadajacego uplywu zegara sciennego. */
  seekTo(sec: number): void {
    this.timeSec = sec;
    this.wallMs += 30;
  }
}

export function makeBeatmap(objects: Beatmap['objects'], endScreenAtSec = 999): Beatmap {
  return { videoId: 'test', endScreenAtSec, objects };
}

export function obj(
  id: string,
  time: number,
  overrides: Partial<Beatmap['objects'][number]> = {},
): Beatmap['objects'][number] {
  return {
    id,
    sprite: 'hand',
    path: [
      { t: time, x: 50, y: 50, size: 100 },
      { t: time + 1, x: 50, y: 50, size: 100 },
    ],
    ...overrides,
  };
}
