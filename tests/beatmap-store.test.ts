import { describe, expect, it } from 'vitest';
import { createBeatmapStore } from '../src/dev/beatmap-store.js';
import { makeBeatmap, obj } from './fake-clock.js';

describe('BeatmapStore', () => {
  it('get zwraca ostatnio ustawiona wartosc', () => {
    const initial = makeBeatmap([obj('o1', 1)]);
    const store = createBeatmapStore(initial);

    const first = store.get();
    expect(first).toBe(initial);

    const updated = makeBeatmap([obj('o2', 2)]);
    store.set(updated);

    const second = store.get();
    expect(second).toBe(updated);
  });

  it('set nadpisuje wartosc', () => {
    const initial = makeBeatmap([obj('o1', 1)]);
    const store = createBeatmapStore(initial);

    const v1 = store.get();
    expect(v1.objects).toHaveLength(1);
    expect(v1.objects[0].id).toBe('o1');

    const updated = makeBeatmap([obj('o2', 2), obj('o3', 3)]);
    store.set(updated);

    const v2 = store.get();
    expect(v2.objects).toHaveLength(2);
    expect(v2.objects[0].id).toBe('o2');
    expect(v2.objects[1].id).toBe('o3');
  });

  it('dwie instancje sa od siebie niezalezne', () => {
    const initial1 = makeBeatmap([obj('o1', 1)]);
    const initial2 = makeBeatmap([obj('o2', 2)]);

    const store1 = createBeatmapStore(initial1);
    const store2 = createBeatmapStore(initial2);

    expect(store1.get().objects[0].id).toBe('o1');
    expect(store2.get().objects[0].id).toBe('o2');

    const updated1 = makeBeatmap([obj('x1', 10)]);
    store1.set(updated1);

    expect(store1.get().objects[0].id).toBe('x1');
    expect(store2.get().objects[0].id).toBe('o2');

    const updated2 = makeBeatmap([obj('x2', 20)]);
    store2.set(updated2);

    expect(store1.get().objects[0].id).toBe('x1');
    expect(store2.get().objects[0].id).toBe('x2');
  });
});
