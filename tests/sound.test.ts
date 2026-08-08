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
  playCount = 0;

  play(): Promise<void> {
    this.playCount++;
    return Promise.resolve();
  }

  pause(): void {}
}

describe('createHitSound', () => {
  let elements: FakeAudio[];

  beforeEach(() => {
    elements = [];
  });

  function makeSound(size = 4, getReferenceVolume?: () => number) {
    return createHitSound(
      'clap.mp3',
      size,
      () => {
        const el = new FakeAudio();
        elements.push(el);
        return el as unknown as HTMLAudioElement;
      },
      getReferenceVolume,
    );
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
    const sound = createHitSound('clap.mp3', 4, () => {
      const el = new FakeAudio();
      elements.push(el);
      return el as unknown as HTMLAudioElement;
    });
    const game = mountGame(root, beatmap, clock, { now: clock.now, sound });
    return game;
  }

  function totalPlays(): number {
    return elements.reduce((sum, el) => sum + el.playCount, 0);
  }

  it('trafienie odtwarza dokladnie jeden klaps', () => {
    const clock = new FakeClock();
    const beatmap = makeBeatmap([obj('o1', 10, { duration: 1000, hitWindowMs: 300 })], 20);
    const game = mount(beatmap, clock);

    playTo(clock, game.frame, 10.0);
    tap(root.querySelector('.obj[data-id="o1"]')!);

    expect(totalPlays()).toBe(1);
  });

  it('pudlo nie odtwarza dzwieku', () => {
    const clock = new FakeClock();
    const beatmap = makeBeatmap([obj('o1', 10, { duration: 1000, hitWindowMs: 200 })]);
    const game = mount(beatmap, clock);

    playTo(clock, game.frame, 9.2);
    tap(root.querySelector('.obj[data-id="o1"]')!);

    expect(totalPlays()).toBe(0);
  });

  it('cel wygasly bez kliknięcia nie odtwarza dzwieku', () => {
    const clock = new FakeClock();
    const beatmap = makeBeatmap([obj('o1', 10, { duration: 1000, hitWindowMs: 200 })], 20);
    const game = mount(beatmap, clock);

    playTo(clock, game.frame, 11.0);

    expect(totalPlays()).toBe(0);
  });

  it('drugi tap w ten sam cel nie daje drugiego dzwieku', () => {
    const clock = new FakeClock();
    const beatmap = makeBeatmap([obj('o1', 10, { duration: 1000, hitWindowMs: 300 })], 20);
    const game = mount(beatmap, clock);

    playTo(clock, game.frame, 10.0);
    const target = root.querySelector('.obj[data-id="o1"]')!;
    tap(target);
    tap(target);

    expect(totalPlays()).toBe(1);
  });

  it('seek w tyl przez trafiony cel i seek w przod nie daja dodatkowego dzwieku', () => {
    const clock = new FakeClock();
    const beatmap = makeBeatmap([obj('o1', 10, { duration: 1000, hitWindowMs: 300 })], 20);
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
    const beatmap = makeBeatmap(
      [
        obj('o1', 10, { duration: 1000, hitWindowMs: 300 }),
        obj('o2', 10.5, { duration: 1000, hitWindowMs: 300 }),
      ],
      20,
    );
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
