// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mountGame } from '../src/game.js';
import { SPRITES } from '../src/sprites.js';
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

describe('smoke: render i wejscie dotykowe', () => {
  let root: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    root = document.querySelector<HTMLElement>('#app')!;
  });

  it('startuje z bramka, renderuje obiekt i zalicza tap na nim', () => {
    const clock = new FakeClock();
    const beatmap = makeBeatmap([obj('o1', 10)], 20); // spawn 10, despawn 11
    const game = mountGame(root, beatmap, clock, { now: clock.now });

    // Bramka startowa jest widoczna do pierwszego gestu (ADR-0009).
    const gate = root.querySelector<HTMLElement>('#gate')!;
    expect(gate.hidden).toBe(false);
    tap(root.querySelector('#start')!);
    expect(gate.hidden).toBe(true);

    playTo(clock, game.frame, 9.5);
    expect(root.querySelector('.obj[data-id="o1"]')).toBeNull(); // jeszcze nie spawnowany

    playTo(clock, game.frame, 10.0);
    const target = root.querySelector<HTMLElement>('.obj[data-id="o1"]');
    expect(target).not.toBeNull();
    tap(target!);

    expect(target!.classList.contains('is-hit')).toBe(true);
    expect(target!.querySelector('.feedback')!.textContent).toBe('+1');
    expect(root.querySelector('#hud-score')!.textContent).toBe('1');
  });

  it('renderuje sprite obrazkowy jako <img> ze zrodlem z rejestru', () => {
    const clock = new FakeClock();
    const beatmap = makeBeatmap([obj('o1', 10, { sprite: 'hand' })], 20);
    const game = mountGame(root, beatmap, clock, { now: clock.now });

    playTo(clock, game.frame, 10.0);
    const target = root.querySelector<HTMLElement>('.obj[data-id="o1"]')!;
    const img = target.querySelector<HTMLImageElement>('img.sprite');

    expect(img).not.toBeNull();
    const expectedSrc = (SPRITES.hand as { kind: 'image'; src: string }).src;
    expect(img!.src.endsWith(expectedSrc)).toBe(true);
  });

  it('trafienie podmienia grafike sprite-a na wariant "hit"', () => {
    const clock = new FakeClock();
    const beatmap = makeBeatmap([obj('o1', 10)], 20);
    const game = mountGame(root, beatmap, clock, { now: clock.now });

    playTo(clock, game.frame, 10.0);
    const target = root.querySelector<HTMLElement>('.obj[data-id="o1"]')!;
    tap(target);

    const img = target.querySelector<HTMLImageElement>('img.sprite')!;
    const expectedHitSrc = (SPRITES.hand as { kind: 'image'; hitSrc?: string }).hitSrc!;
    expect(img.src.endsWith(expectedHitSrc)).toBe(true);
  });

  it('pudlo nie podmienia grafiki sprite-a — zostaje wariant idle, gdy despawn minie bez kliku', () => {
    const clock = new FakeClock();
    const beatmap = makeBeatmap([obj('o1', 10)]); // despawn 11
    const game = mountGame(root, beatmap, clock, { now: clock.now });

    playTo(clock, game.frame, 10.5);
    const target = root.querySelector<HTMLElement>('.obj[data-id="o1"]')!;
    playTo(clock, game.frame, 11.05); // despawn bez kliku

    const img = target.querySelector<HTMLImageElement>('img.sprite')!;
    const expectedSrc = (SPRITES.hand as { kind: 'image'; src: string }).src;
    expect(img.src.endsWith(expectedSrc)).toBe(true);
  });

  it('brak kliku do despawnu nie pokazuje feedbacku i nie daje punktu', () => {
    const clock = new FakeClock();
    const beatmap = makeBeatmap([obj('o1', 10)]); // despawn 11
    const game = mountGame(root, beatmap, clock, { now: clock.now });

    playTo(clock, game.frame, 10.5);
    const target = root.querySelector<HTMLElement>('.obj[data-id="o1"]')!;
    playTo(clock, game.frame, 11.05);

    expect(target.classList.contains('is-miss')).toBe(true);
    expect(target.querySelector('.feedback')!.textContent).toBe('');
    expect(root.querySelector('#hud-score')!.textContent).toBe('0');
  });

  it('pauza wideo zatrzymuje spawnowanie obiektow', () => {
    const clock = new FakeClock();
    const beatmap = makeBeatmap([obj('o1', 10)]);
    const game = mountGame(root, beatmap, clock, { now: clock.now });

    playTo(clock, game.frame, 8.5);
    clock.playing = false;
    for (let i = 0; i < 100; i++) {
      clock.advanceWallOnly(0.05);
      game.frame();
    }

    expect(root.querySelectorAll('.obj')).toHaveLength(0);
    expect(root.querySelector<HTMLElement>('#hud-frozen')!.hidden).toBe(false);
  });

  it('ramka pelnego ekranu obejmuje scene razem z HUD-em', () => {
    const clock = new FakeClock();
    const game = mountGame(root, makeBeatmap([obj('o1', 10)]), clock, { now: clock.now });

    // Element idacy na pelny ekran musi zawierac wszystko, co ma byc widoczne —
    // to, co zostanie na zewnatrz, zaslania element w top layer (ADR-0010).
    const frame = game.ui.frame;
    expect(frame.contains(root.querySelector('#stage'))).toBe(true);
    expect(frame.contains(root.querySelector('#overlay'))).toBe(true);
    expect(frame.contains(root.querySelector('#gate'))).toBe(true);
    expect(frame.contains(root.querySelector('#results'))).toBe(true);
    expect(frame.contains(root.querySelector('.hud'))).toBe(true);
    expect(frame.contains(game.ui.playerHost)).toBe(true);
  });

  it('tarcza nad playerem znajduje sie miedzy .player a .overlay w porzadku DOM', () => {
    // Chroni przed dotknieciem iframe'a YouTube (kontrolki, duza ikona pauzy) —
    // `pointer-events: none` na iframie samo w sobie nie jest niezawodne na iOS
    // Safari (ADR-0019). Tarcza musi malowac sie NAD playerem, ale POD .overlay
    // (i wiec pod .obj/.gate/.results), zeby cele i bramka zostaly klikalne.
    const clock = new FakeClock();
    const game = mountGame(root, makeBeatmap([obj('o1', 10)]), clock, { now: clock.now });

    const shield = root.querySelector<HTMLElement>('#shield')!;
    expect(shield).not.toBeNull();

    const playerPos = game.ui.playerHost.compareDocumentPosition(shield);
    expect(playerPos & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const overlay = root.querySelector<HTMLElement>('#overlay')!;
    const shieldPos = shield.compareDocumentPosition(overlay);
    expect(shieldPos & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('tarcza zakrywa kadr, gdy silnik jest zamrozony, i odslania go przy odtwarzaniu', () => {
    // YouTube rysuje overlay stanu "pauza" (tytul, avatar, udostepnianie,
    // miniatury powiazane, logo, duzy przycisk) niezaleznie od `controls: 0`;
    // `modestbranding`/`showinfo` sa martwe, a `rel: 0` nie wylacza propozycji.
    // Jedyne skuteczne wyjscie to zaslonic kadr wlasna warstwa (ADR-0019).
    const clock = new FakeClock();
    const game = mountGame(root, makeBeatmap([obj('o1', 10)]), clock, { now: clock.now });
    const shield = root.querySelector<HTMLElement>('#shield')!;

    clock.playing = false;
    game.frame();
    expect(shield.classList.contains('is-covering')).toBe(true);

    clock.playing = true;
    playTo(clock, game.frame, 1);
    expect(shield.classList.contains('is-covering')).toBe(false);
  });

  it('przycisk pelnego ekranu jest ukryty do czasu wlaczenia i zmienia etykiete', () => {
    const clock = new FakeClock();
    const game = mountGame(root, makeBeatmap([obj('o1', 10)]), clock, { now: clock.now });
    const button = root.querySelector<HTMLButtonElement>('#fullscreen')!;
    expect(button.hidden).toBe(true);

    const toggle = vi.fn();
    game.ui.enableFullscreen(toggle);
    expect(button.hidden).toBe(false);

    button.click();
    expect(toggle).toHaveBeenCalledTimes(1);

    game.ui.setFullscreenActive(true);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.textContent).toContain('Zamknij');
  });

  it('size z punktu sciezki skaluje szerokosc obiektu wzgledem bazowych 16%', () => {
    const clock = new FakeClock();
    const beatmap = makeBeatmap(
      [
        obj('o1', 10, {
          path: [
            { t: 10, x: 50, y: 50, size: 50 },
            { t: 11, x: 50, y: 50, size: 50 },
          ],
        }),
      ],
      20,
    );
    const game = mountGame(root, beatmap, clock, { now: clock.now });

    playTo(clock, game.frame, 10.0);
    const target = root.querySelector<HTMLElement>('.obj[data-id="o1"]')!;

    expect(target.style.width).toBe('8%');
  });

  it('left/top/width zmieniaja sie miedzy klatkami wraz z uplywem czasu wideo', () => {
    const clock = new FakeClock();
    const beatmap = makeBeatmap(
      [
        obj('o1', 10, {
          path: [
            { t: 9, x: 0, y: 0, size: 50 },
            { t: 10, x: 100, y: 100, size: 150 },
          ],
        }),
      ],
      20,
    );
    const game = mountGame(root, beatmap, clock, { now: clock.now });

    playTo(clock, game.frame, 9.0);
    const target = root.querySelector<HTMLElement>('.obj[data-id="o1"]')!;
    expect(target.style.left).toBe('0%');
    expect(target.style.top).toBe('0%');
    expect(target.style.width).toBe('8%');

    playTo(clock, game.frame, 9.5);
    expect(target.style.left).toBe('50%');
    expect(target.style.top).toBe('50%');
    expect(target.style.width).toBe('16%');
  });

  it('sciezka statyczna (dwa punkty w tym samym miejscu) trzyma pozycje mimo uplywu czasu', () => {
    const clock = new FakeClock();
    const beatmap = makeBeatmap(
      [
        obj('o1', 10, {
          path: [
            { t: 10, x: 33, y: 66, size: 100 },
            { t: 11, x: 33, y: 66, size: 100 },
          ],
        }),
      ],
      20,
    );
    const game = mountGame(root, beatmap, clock, { now: clock.now });

    playTo(clock, game.frame, 10.2);
    const target = root.querySelector<HTMLElement>('.obj[data-id="o1"]')!;
    expect(target.style.left).toBe('33%');
    expect(target.style.top).toBe('66%');

    playTo(clock, game.frame, 10.9);
    expect(target.style.left).toBe('33%');
    expect(target.style.top).toBe('66%');
  });

  it('preladowuje wszystkie warianty sprite ow juz przy montazu UI', () => {
    // Pierwszy cel zyje ~1-2 s; gdyby GIF idle byl pobierany dopiero przy jego
    // montazu, na pierwszym przebiegu widac pusty obiekt (dopiero po przewinieciu
    // w tyl plik jest w cache). Preload musi objac oba warianty przed startem.
    const requested: string[] = [];
    class RecordingImage {
      set src(value: string) {
        requested.push(value);
      }
    }
    vi.stubGlobal('Image', RecordingImage);

    const clock = new FakeClock();
    mountGame(root, makeBeatmap([obj('o1', 10, { sprite: 'hand' })], 20), clock, {
      now: clock.now,
    });

    const hand = SPRITES.hand as { kind: 'image'; src: string; hitSrc?: string };
    expect(requested).toContain(hand.src);
    expect(requested).toContain(hand.hitSrc!);

    vi.unstubAllGlobals();
  });

  it('na koncu klipu pokazuje ekran wyniku z liczbami', () => {
    const clock = new FakeClock();
    const beatmap = makeBeatmap([obj('o1', 10), obj('o2', 12)], 15);
    const game = mountGame(root, beatmap, clock, { now: clock.now });

    playTo(clock, game.frame, 10.0);
    tap(root.querySelector('.obj[data-id="o1"]')!);
    playTo(clock, game.frame, 15.0); // o2 przepuszczone

    const results = root.querySelector<HTMLElement>('#results')!;
    expect(results.hidden).toBe(false);
    expect(root.querySelector('#r-score')!.textContent).toBe('1');
    expect(root.querySelector('#r-hits')!.textContent).toBe('1');
    expect(root.querySelector('#r-misses')!.textContent).toBe('1');
    expect(root.querySelector('#r-accuracy')!.textContent).toBe('50%');
  });
});

describe('pasek transportu (ADR-0019)', () => {
  let root: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    root = document.querySelector<HTMLElement>('#app')!;
  });

  function makeControls(overrides: Partial<{
    play: () => void;
    pause: () => void;
    seekTo: (sec: number) => void;
    getDuration: () => number;
    isMuted: () => boolean;
    setMuted: (muted: boolean) => void;
  }> = {}) {
    return {
      play: vi.fn(),
      pause: vi.fn(),
      seekTo: vi.fn(),
      getDuration: vi.fn(() => 0),
      isMuted: vi.fn(() => false),
      setMuted: vi.fn(),
      ...overrides,
    };
  }

  it('guziki i suwak sa disabled przed enableTransport', () => {
    const clock = new FakeClock();
    mountGame(root, makeBeatmap([obj('o1', 10)]), clock, { now: clock.now });

    expect(root.querySelector<HTMLButtonElement>('#transport-play')!.disabled).toBe(true);
    expect(root.querySelector<HTMLInputElement>('#transport-seek')!.disabled).toBe(true);
    expect(root.querySelector<HTMLButtonElement>('#transport-mute')!.disabled).toBe(true);
  });

  it('enableTransport odblokowuje guziki i suwak', () => {
    const clock = new FakeClock();
    const game = mountGame(root, makeBeatmap([obj('o1', 10)]), clock, { now: clock.now });

    game.ui.enableTransport(makeControls());

    expect(root.querySelector<HTMLButtonElement>('#transport-play')!.disabled).toBe(false);
    expect(root.querySelector<HTMLInputElement>('#transport-seek')!.disabled).toBe(false);
    expect(root.querySelector<HTMLButtonElement>('#transport-mute')!.disabled).toBe(false);
  });

  it('klik w play przy zamrozonym silniku wola play(), a w trakcie odtwarzania wola pause()', () => {
    const clock = new FakeClock();
    const game = mountGame(root, makeBeatmap([obj('o1', 10)]), clock, { now: clock.now });
    const controls = makeControls();
    game.ui.enableTransport(controls);

    clock.playing = false;
    game.frame(); // renderuje frozen === true
    root.querySelector<HTMLButtonElement>('#transport-play')!.click();
    expect(controls.play).toHaveBeenCalledTimes(1);
    expect(controls.pause).not.toHaveBeenCalled();

    clock.playing = true;
    game.frame(); // renderuje frozen === false
    root.querySelector<HTMLButtonElement>('#transport-play')!.click();
    expect(controls.pause).toHaveBeenCalledTimes(1);
  });

  it('render ustawia wartosc suwaka i etykiete czasu z view.timeSec i getDuration()', () => {
    const clock = new FakeClock();
    const game = mountGame(root, makeBeatmap([obj('o1', 10)]), clock, { now: clock.now });
    const controls = makeControls({ getDuration: vi.fn(() => 60) });
    game.ui.enableTransport(controls);

    playTo(clock, game.frame, 5);

    const seek = root.querySelector<HTMLInputElement>('#transport-seek')!;
    expect(Number(seek.value)).toBeCloseTo(5, 1);
    expect(seek.max).toBe('60');
    expect(root.querySelector('#transport-time')!.textContent).toBe('0:05 / 1:00');
  });

  it('getDuration() zwracajace najpierw 0 jest odpytywane az do pierwszej dodatniej wartosci, potem juz nie', () => {
    const clock = new FakeClock();
    const game = mountGame(root, makeBeatmap([obj('o1', 10)]), clock, { now: clock.now });
    const getDuration = vi.fn(() => 0);
    const controls = makeControls({ getDuration });
    game.ui.enableTransport(controls);

    game.frame();
    game.frame();
    expect(getDuration).toHaveBeenCalledTimes(2);
    expect(root.querySelector<HTMLInputElement>('#transport-seek')!.max).toBe('0');

    getDuration.mockReturnValue(30);
    game.frame();
    expect(root.querySelector<HTMLInputElement>('#transport-seek')!.max).toBe('30');

    game.frame();
    expect(getDuration).toHaveBeenCalledTimes(3); // nie pytamy juz po ustaleniu dlugosci
  });

  it('input na suwaku nie wola seekTo i wstrzymuje aktualizacje z render; change wola seekTo', () => {
    const clock = new FakeClock();
    const game = mountGame(root, makeBeatmap([obj('o1', 10)]), clock, { now: clock.now });
    const controls = makeControls({ getDuration: vi.fn(() => 60) });
    game.ui.enableTransport(controls);

    playTo(clock, game.frame, 5);
    const seek = root.querySelector<HTMLInputElement>('#transport-seek')!;

    seek.value = '20';
    seek.dispatchEvent(new Event('input', { bubbles: true }));
    expect(controls.seekTo).not.toHaveBeenCalled();

    playTo(clock, game.frame, 6); // render nie powinien nadpisac suwaka podczas scrub
    expect(seek.value).toBe('20');

    seek.dispatchEvent(new Event('change', { bubbles: true }));
    expect(controls.seekTo).toHaveBeenCalledWith(20);

    playTo(clock, game.frame, 6.5); // po change render znow aktualizuje suwak
    expect(Number(seek.value)).toBeCloseTo(6.5, 1);
  });

  it('mute: klik przelacza setMuted i aktualizuje aria-pressed oraz etykiete', () => {
    const clock = new FakeClock();
    const game = mountGame(root, makeBeatmap([obj('o1', 10)]), clock, { now: clock.now });
    let muted = false;
    const controls = makeControls({
      isMuted: vi.fn(() => muted),
      setMuted: vi.fn((next: boolean) => {
        muted = next;
      }),
    });
    game.ui.enableTransport(controls);

    const muteButton = root.querySelector<HTMLButtonElement>('#transport-mute')!;
    expect(muteButton.getAttribute('aria-pressed')).toBe('false');

    muteButton.click();
    expect(controls.setMuted).toHaveBeenCalledWith(true);
    expect(muteButton.getAttribute('aria-pressed')).toBe('true');
    expect(muteButton.textContent).toBe('Wlacz dzwiek');

    muteButton.click();
    expect(controls.setMuted).toHaveBeenCalledWith(false);
    expect(muteButton.getAttribute('aria-pressed')).toBe('false');
    expect(muteButton.textContent).toBe('Wycisz');
  });
});
