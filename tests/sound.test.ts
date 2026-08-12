// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { mountGame } from '../src/game.js';
import { createHitSound } from '../src/ui/sound.js';
import { FakeClock, makeBeatmap, obj } from './fake-clock.js';

/** jsdom nie implementuje PointerEvent — gra i tak slucha tylko `pointerdown`. */
function tap(element: Element): void {
  element.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
}

function playTo(clock: FakeClock, frame: () => void, targetSec: number): void {
  while (clock.timeSec < targetSec - 1e-9) {
    clock.advance(Math.min(0.016, targetSec - clock.timeSec));
    frame();
  }
}

/** Atrapa HTMLAudioElement — jsdom nie implementuje HTMLMediaElement.play(). */
class FakeAudio {
  preload = '';
  muted = false;
  currentTime = 0;
  volume = 1;
  paused = true;
  readyState = 4;
  playCount = 0;

  play(): Promise<void> {
    this.playCount++;
    this.paused = false;
    return Promise.resolve();
  }

  pause(): void {
    this.paused = true;
  }
}

describe('createHitSound', () => {
  let elements: FakeAudio[];

  beforeEach(() => {
    elements = [];
  });

  function makeSound(size = 4, getReferenceVolume?: () => number) {
    return createHitSound('clap.mp3', {
      size,
      getReferenceVolume,
      make: () => {
        const el = new FakeAudio();
        elements.push(el);
        return el as unknown as HTMLAudioElement;
      },
    });
  }

  it('unlock() dotyka kazdego elementu puli', () => {
    const sound = makeSound(4);
    sound.unlock();
    expect(elements).toHaveLength(4);
    for (const el of elements) expect(el.playCount).toBe(1);
  });

  it('play() odtwarza dokladnie jeden element na wywolanie', () => {
    const sound = makeSound(4);
    sound.play();
    const totalPlays = elements.reduce((sum, el) => sum + el.playCount, 0);
    expect(totalPlays).toBe(1);
  });

  it('dwa szybkie trafienia uzywaja dwoch roznych elementow puli (round-robin)', () => {
    const sound = makeSound(4);
    sound.play();
    sound.play();
    const played = elements.filter((el) => el.playCount > 0);
    expect(played).toHaveLength(2);
  });

  // jsdom nie implementuje Web Audio API, wiec GainNode (podwojenie glosnosci
  // ponad 1.0, ADR-0013) nigdy sie nie podlacza w testach — tu sprawdzana jest
  // wylacznie proporcjonalnosc do referencyjnej glosnosci przez zapasowa sciezke
  // `el.volume`, ograniczona do 1.0. Realny x2 wymaga recznej weryfikacji w przegladarce.
  it('glosnosc jest proporcjonalna do referencyjnej glosnosci (fallback bez Web Audio)', () => {
    const sound = makeSound(4, () => 0.5);
    sound.play();
    expect(elements[0]!.volume).toBe(0.5);
  });

  it('referencyjna glosnosc powyzej 1 jest przycinana do 1 w fallbacku', () => {
    const sound = makeSound(4, () => 2);
    sound.play();
    expect(elements[0]!.volume).toBe(1);
  });

  it('domyslna referencyjna glosnosc to pelna (1) gdy nie podano', () => {
    const sound = makeSound(4);
    sound.play();
    expect(elements[0]!.volume).toBe(1);
  });

  // Diagnostyka dla urzadzen bez devtoolsow (iOS) — guzik „Test dzwieku"
  // w trybie dev pokazuje ten string w pasku statusu.
  it('describe() raportuje droge zapasowa i stan odtwarzanego elementu', () => {
    const sound = makeSound(4);
    sound.play();
    const report = sound.describe();
    expect(report).toContain('tryb=pula'); // jsdom nie ma Web Audio
    expect(report).toContain('paused=false');
    expect(report).toContain('blad=brak');
  });

  it('describe() pokazuje przyczyne odrzuconego play()', async () => {
    const failing = createHitSound('clap.mp3', {
      size: 1,
      make: () => {
        const el = new FakeAudio();
        el.play = () => Promise.reject(new Error('NotAllowedError'));
        return el as unknown as HTMLAudioElement;
      },
    });
    failing.play();
    await Promise.resolve();
    expect(failing.describe()).toContain('play: Error: NotAllowedError');
  });

  it('describe() liczy elementy faktycznie odblokowane przez unlock()', async () => {
    const sound = makeSound(4);
    expect(sound.describe()).toContain('odblokowane=0/4');
    sound.unlock();
    await Promise.resolve();
    await Promise.resolve();
    expect(sound.describe()).toContain('odblokowane=4/4');
  });
});

/**
 * Sciezka glowna z ADR-0017 — jsdom nie ma Web Audio API, wiec kontekst jest
 * podstawiony. Sprawdzamy to, czego nie da sie sprawdzic na urzadzeniu: ze
 * `play()` w ogole nie dotyka `HTMLAudioElement`, gdy bufor jest gotowy.
 */
describe('createHitSound — sciezka Web Audio na buforze', () => {
  class FakeSource {
    buffer: unknown = null;
    started = 0;
    connect(): void {}
    start(): void {
      this.started++;
    }
  }

  class FakeGain {
    gain = { value: 0 };
    connect(): void {}
  }

  class FakeContext {
    state = 'suspended';
    destination = {};
    resumed = 0;
    sources: FakeSource[] = [];
    gains: FakeGain[] = [];
    decodeFails = false;

    resume(): Promise<void> {
      this.resumed++;
      this.state = 'running';
      return Promise.resolve();
    }
    createBufferSource(): FakeSource {
      const source = new FakeSource();
      this.sources.push(source);
      return source;
    }
    createGain(): FakeGain {
      const gain = new FakeGain();
      this.gains.push(gain);
      return gain;
    }
    decodeAudioData(): Promise<AudioBuffer> {
      return this.decodeFails
        ? Promise.reject(new Error('EncodingError'))
        : Promise.resolve({ duration: 0.3 } as AudioBuffer);
    }
  }

  let elements: FakeAudio[];
  let context: FakeContext;

  beforeEach(() => {
    elements = [];
    context = new FakeContext();
  });

  function makeSound(getReferenceVolume?: () => number) {
    return createHitSound('clap.mp3', {
      getReferenceVolume,
      boost: 4,
      createContext: () => context as unknown as AudioContext,
      fetchBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      make: () => {
        const el = new FakeAudio();
        elements.push(el);
        return el as unknown as HTMLAudioElement;
      },
    });
  }

  /** unlock() -> fetch -> decodeAudioData -> przypisanie bufora: lancuch
      obietnic, ktorego dlugosc rozni sie miedzy sukcesem a odrzuceniem
      (adopcja odrzuconej obietnicy kosztuje dodatkowe mikrozadania). */
  function settle(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  it('unlock() wznawia kontekst i dekoduje bufor', async () => {
    const sound = makeSound();
    sound.unlock();
    await settle();

    expect(context.resumed).toBe(1);
    expect(sound.describe()).toContain('tryb=bufor');
  });

  it('po zdekodowaniu play() nie dotyka juz puli <audio>', async () => {
    const sound = makeSound();
    sound.unlock();
    await settle();

    const playsBefore = elements.reduce((sum, el) => sum + el.playCount, 0);
    sound.play();

    expect(context.sources).toHaveLength(1);
    expect(context.sources[0]!.started).toBe(1);
    expect(elements.reduce((sum, el) => sum + el.playCount, 0)).toBe(playsBefore);
  });

  it('wzmocnienie przekracza 1.0, czego HTMLAudioElement.volume nie umie', async () => {
    const sound = makeSound(() => 0.5);
    sound.unlock();
    await settle();
    sound.play();

    expect(context.gains[0]!.gain.value).toBe(2); // 0.5 * boost 4
  });

  it('kazde trafienie dostaje wlasny source — klapsy moga sie nakladac', async () => {
    const sound = makeSound();
    sound.unlock();
    await settle();
    sound.play();
    sound.play();

    expect(context.sources).toHaveLength(2);
    expect(context.sources.every((s) => s.started === 1)).toBe(true);
  });

  it('nieudane dekodowanie spada na droge zapasowa i raportuje przyczyne', async () => {
    context.decodeFails = true;
    const sound = makeSound();
    sound.unlock();
    await settle();
    sound.play();

    expect(context.sources).toHaveLength(0);
    expect(elements.reduce((sum, el) => sum + el.playCount, 0)).toBeGreaterThan(0);
    const report = sound.describe();
    expect(report).toContain('tryb=pula');
    expect(report).toContain('dekod: Error: EncodingError');
  });

  it('drugi unlock() nie tworzy drugiego kontekstu', async () => {
    const sound = makeSound();
    sound.unlock();
    sound.unlock();
    await settle();

    expect(context.resumed).toBe(1);
  });
});

describe('dzwiek trafienia w rozgrywce', () => {
  let root: HTMLElement;
  let elements: FakeAudio[];

  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    root = document.querySelector<HTMLElement>('#app')!;
    elements = [];
  });

  function mount(beatmap: ReturnType<typeof makeBeatmap>, clock: FakeClock) {
    const sound = createHitSound('clap.mp3', {
      make: () => {
        const el = new FakeAudio();
        elements.push(el);
        return el as unknown as HTMLAudioElement;
      },
    });
    const game = mountGame(root, beatmap, clock, { now: clock.now, sound });
    return game;
  }

  function totalPlays(): number {
    return elements.reduce((sum, el) => sum + el.playCount, 0);
  }

  it('trafienie odtwarza dokladnie jeden klaps', () => {
    const clock = new FakeClock();
    const beatmap = makeBeatmap([obj('o1', 10)], 20);
    const game = mount(beatmap, clock);

    playTo(clock, game.frame, 10.0);
    tap(root.querySelector('.obj[data-id="o1"]')!);

    expect(totalPlays()).toBe(1);
  });

  it('klik przed spawnem nie odtwarza dzwieku', () => {
    const clock = new FakeClock();
    const beatmap = makeBeatmap([obj('o1', 10)]);
    const game = mount(beatmap, clock);

    playTo(clock, game.frame, 9.2);
    expect(root.querySelector('.obj[data-id="o1"]')).toBeNull(); // jeszcze nie spawnowany

    expect(totalPlays()).toBe(0);
  });

  it('cel wygasly bez kliknięcia nie odtwarza dzwieku', () => {
    const clock = new FakeClock();
    const beatmap = makeBeatmap([obj('o1', 10)], 20); // despawn 11
    const game = mount(beatmap, clock);

    playTo(clock, game.frame, 11.05);

    expect(totalPlays()).toBe(0);
  });

  it('drugi tap w ten sam cel nie daje drugiego dzwieku', () => {
    const clock = new FakeClock();
    const beatmap = makeBeatmap([obj('o1', 10)], 20);
    const game = mount(beatmap, clock);

    playTo(clock, game.frame, 10.0);
    const target = root.querySelector('.obj[data-id="o1"]')!;
    tap(target);
    tap(target);

    expect(totalPlays()).toBe(1);
  });

  it('seek w tyl przez trafiony cel i seek w przod nie daja dodatkowego dzwieku', () => {
    const clock = new FakeClock();
    const beatmap = makeBeatmap([obj('o1', 10)], 20);
    const game = mount(beatmap, clock);

    playTo(clock, game.frame, 10.0);
    tap(root.querySelector('.obj[data-id="o1"]')!);
    expect(totalPlays()).toBe(1);

    clock.seekTo(5);
    game.frame();
    clock.seekTo(15);
    game.frame();

    expect(totalPlays()).toBe(1);
  });

  it('dwa trafienia w krotkim odstepie uzywaja dwoch roznych elementow puli', () => {
    const clock = new FakeClock();
    const beatmap = makeBeatmap([obj('o1', 10), obj('o2', 10.5)], 20);
    const game = mount(beatmap, clock);

    playTo(clock, game.frame, 10.0);
    tap(root.querySelector('.obj[data-id="o1"]')!);
    playTo(clock, game.frame, 10.5);
    tap(root.querySelector('.obj[data-id="o2"]')!);

    const played = elements.filter((el) => el.playCount > 0);
    expect(played).toHaveLength(2);
  });

  it('unlock() po tapnieciu "Graj" dotyka kazdego elementu puli', () => {
    const clock = new FakeClock();
    const beatmap = makeBeatmap([obj('o1', 10)], 20);
    mount(beatmap, clock);

    tap(root.querySelector('#start')!);

    expect(elements).toHaveLength(4);
    for (const el of elements) expect(el.playCount).toBe(1);
  });
});
