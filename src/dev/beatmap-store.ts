import type { Beatmap } from '../engine/types.js';

export interface BeatmapStore {
  get(): Beatmap;
  set(next: Beatmap): void;
}

export function createBeatmapStore(initial: Beatmap): BeatmapStore {
  let current = initial;

  return {
    get(): Beatmap {
      return current;
    },
    set(next: Beatmap): void {
      current = next;
    },
  };
}
