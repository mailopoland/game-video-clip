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

  it('bramka pokazuje grafike instrukcji, a klik w nia startuje gre', () => {
    const clock = new FakeClock();
    mountGame(root, makeBeatmap([obj('o1', 10)], 20), clock, { now: clock.now });

    const image = root.querySelector<HTMLImageElement>('#gate-image')!;
    expect(image.getAttribute('src')).toContain('sprites/start-manual.gif');
    // Grafika zawiera juz „tap to start", wiec osobnego napisu/podpowiedzi nie ma.
    expect(root.querySelector('.gate-hint')).toBeNull();
    expect(root.querySelector('#start')!.textContent!.trim()).toBe('');

    tap(image);
    expect(root.querySelector<HTMLElement>('#gate')!.hidden).toBe(true);
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
    expect(frame.contains(root.querySelector('#transport'))).toBe(true);
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

  it('tarcza nie zaslania kadru — na pauzie wideo zostaje widoczne', () => {
    // Zaslona miala ukrywac branding stanu "pauza", ale duzy przycisk YouTube'a
    // i tak zostaje widoczny (nie da sie go usunac: jest wysrodkowany razem
    // z obrazem, a iframe jest cross-origin). Czernienie kadru nic wiec nie
    // kupowalo, a kosztowalo podglad wideo na pauzie — tarcza jest teraz
    // wylacznie blokada wskaznika i nie ma stanu (ADR-0019).
    const clock = new FakeClock();
    const game = mountGame(root, makeBeatmap([obj('o1', 10)]), clock, { now: clock.now });
    const shield = root.querySelector<HTMLElement>('#shield')!;

    clock.playing = false;
    game.frame();
    expect(shield.className).toBe('shield');

    clock.playing = true;
    playTo(clock, game.frame, 1);
    expect(shield.className).toBe('shield');
  });

  it('przezroczysty przycisk lezy tam, gdzie YouTube rysuje swoj, i jest nieaktywny do enableTransport', () => {
    // Duzego przycisku YouTube'a nie da sie usunac (wysrodkowany razem
    // z obrazem, iframe cross-origin), wiec zostaje widoczny — ale zdarzen
    // NIE przepuszczamy do iframe'a, bo pudlo obok dloni znowu pauzowaloby
    // wideo. Zamiast tego wlasny przezroczysty przycisk w tym samym miejscu,
    // spiety z transportem: wyglad YouTube'a, dzialanie nasze (ADR-0019).
    const clock = new FakeClock();
    const game = mountGame(root, makeBeatmap([obj('o1', 10)]), clock, { now: clock.now });

    const proxy = root.querySelector<HTMLButtonElement>('#yt-button-proxy')!;
    expect(proxy).not.toBeNull();
    expect(proxy.disabled).toBe(true);

    // Nad tarcza, ale pod warstwa gry — klik w dlon musi wygrac z przyciskiem.
    const shield = root.querySelector<HTMLElement>('#shield')!;
    const overlay = root.querySelector<HTMLElement>('#overlay')!;
    expect(shield.compareDocumentPosition(proxy) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(proxy.compareDocumentPosition(overlay) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    game.ui.enableTransport({
      play: vi.fn(),
      pause: vi.fn(),
      seekTo: vi.fn(),
      getDuration: vi.fn(() => 0),
      isMuted: vi.fn(() => false),
      setMuted: vi.fn(),
    });
    expect(proxy.disabled).toBe(false);
  });

  it('klik w przezroczysty przycisk przelacza odtwarzanie tak jak pasek transportu', () => {
    const clock = new FakeClock();
    const game = mountGame(root, makeBeatmap([obj('o1', 10)]), clock, { now: clock.now });
    const controls = {
      play: vi.fn(),
      pause: vi.fn(),
      seekTo: vi.fn(),
      getDuration: vi.fn(() => 0),
      isMuted: vi.fn(() => false),
      setMuted: vi.fn(),
    };
    game.ui.enableTransport(controls);
    game.ui.hideGate(); // za bramka startowa; pierwszy klik przed nia jest startem
    const proxy = root.querySelector<HTMLButtonElement>('#yt-button-proxy')!;

    clock.playing = false;
    game.frame();
    proxy.click();
    expect(controls.play).toHaveBeenCalledTimes(1);
    expect(controls.pause).not.toHaveBeenCalled();

    clock.playing = true;
    game.frame();
    proxy.click();
    expect(controls.pause).toHaveBeenCalledTimes(1);
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

  /** Gra rozegrana do konca klipu: 1 trafienie z 2 celow → ekran wyniku. */
  function playToResults(): { game: ReturnType<typeof mountGame> } {
    const clock = new FakeClock();
    const beatmap = makeBeatmap([obj('o1', 10), obj('o2', 12)], 15);
    const game = mountGame(root, beatmap, clock, { now: clock.now });

    playTo(clock, game.frame, 10.0);
    tap(root.querySelector('.obj[data-id="o1"]')!);
    playTo(clock, game.frame, 15.0); // o2 przepuszczone

    return { game };
  }

  it('na koncu klipu pokazuje wynik jako X / Y, procent i grafike', () => {
    playToResults();

    const results = root.querySelector<HTMLElement>('#results')!;
    expect(results.hidden).toBe(false);
    expect(root.querySelector('#r-score')!.textContent).toBe('1');
    expect(root.querySelector('#r-total')!.textContent).toBe('2');
    expect(root.querySelector('#r-percent')!.textContent).toBe('50%');
    expect(root.querySelector<HTMLImageElement>('#r-image')!.src).toMatch(
      /results\/score2\.gif$/,
    );
  });

  it('ekran wyniku nie ma polskich napisow (ADR-0025)', () => {
    playToResults();

    const text = root.querySelector<HTMLElement>('#results')!.textContent!;
    for (const word of ['Koniec', 'pkt', 'Trafienia', 'Pudla', 'Celnosc']) {
      expect(text).not.toContain(word);
    }
    expect(text).toContain('PLAY AGAIN');
  });

  it('PLAY AGAIN ma ikone SVG, nie glif Unicode (regresja iOS)', () => {
    playToResults();

    const again = root.querySelector<HTMLButtonElement>('#r-again')!;
    expect(again.querySelector('svg.icon')).not.toBeNull();
    expect(again.textContent).not.toContain('⟳');
  });

  it('PLAY AGAIN jest disabled przed enableTransport, a po nim przewija na 0 i gra', () => {
    const { game } = playToResults();
    const again = root.querySelector<HTMLButtonElement>('#r-again')!;
    expect(again.disabled).toBe(true);

    const controls = {
      play: vi.fn(),
      pause: vi.fn(),
      seekTo: vi.fn(),
      getDuration: vi.fn(() => 20),
      isMuted: vi.fn(() => false),
      setMuted: vi.fn(),
    };
    game.ui.enableTransport(controls);
    expect(again.disabled).toBe(false);

    again.click();
    expect(controls.seekTo).toHaveBeenCalledWith(0);
    expect(controls.play).toHaveBeenCalledTimes(1);
  });

  // Punkt zaczepienia telemetrii (ADR-0026): obserwator ma dostac dokladnie
  // ten `GameView`, ktory poszedl do DOM — bez drugiego `getView()` obok.
  it('onFrame dostaje ten sam view, ktory poszedl do render()', () => {
    const clock = new FakeClock();
    const seen: unknown[] = [];
    const game = mountGame(root, makeBeatmap([obj('o1', 10)], 20), clock, {
      now: clock.now,
      onFrame: (view) => seen.push(view),
    });

    // Montaz renderuje pierwsza klatke, wiec obserwator juz cos widzial.
    expect(seen).toHaveLength(1);

    playTo(clock, game.frame, 10.0);
    tap(root.querySelector('.obj[data-id="o1"]')!);
    game.frame();

    const last = seen[seen.length - 1] as { timeSec: number; stats: { score: number } };
    expect(last.timeSec).toBeCloseTo(10.0, 2);
    expect(last.stats.score).toBe(1);
    expect(root.querySelector('#hud-score')!.textContent).toContain('1');
  });

  it('brak onFrame nie zmienia niczego w petli', () => {
    const clock = new FakeClock();
    const game = mountGame(root, makeBeatmap([obj('o1', 10)], 20), clock, { now: clock.now });

    expect(() => playTo(clock, game.frame, 10.5)).not.toThrow();
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
    game.ui.hideGate(); // za bramka startowa; pierwszy klik przed nia jest startem

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
    expect(muteButton.getAttribute('aria-label')).toBe('Wlacz dzwiek');

    muteButton.click();
    expect(controls.setMuted).toHaveBeenCalledWith(false);
    expect(muteButton.getAttribute('aria-pressed')).toBe('false');
    expect(muteButton.getAttribute('aria-label')).toBe('Wycisz');
  });

  it('ikona glosnosci odzwierciedla stan dzwieku, takze od pierwszej klatki', () => {
    const clock = new FakeClock();
    const game = mountGame(root, makeBeatmap([obj('o1', 10)]), clock, { now: clock.now });
    const muteButton = root.querySelector<HTMLButtonElement>('#transport-mute')!;

    // Przed enableTransport: wideo gra z dzwiekiem, wiec nie wolno pokazywac wyciszenia.
    expect(muteButton.dataset.icon).toBe('sound-on');

    let muted = false;
    game.ui.enableTransport(
      makeControls({
        isMuted: vi.fn(() => muted),
        setMuted: vi.fn((next: boolean) => {
          muted = next;
        }),
      }),
    );
    expect(muteButton.dataset.icon).toBe('sound-on');

    muteButton.click();
    expect(muteButton.dataset.icon).toBe('sound-off');

    muteButton.click();
    expect(muteButton.dataset.icon).toBe('sound-on');
  });

  it('ikona glosnosci nadaza za wyciszeniem zmienionym poza przyciskiem', () => {
    const clock = new FakeClock();
    const game = mountGame(root, makeBeatmap([obj('o1', 10)]), clock, { now: clock.now });
    const muteButton = root.querySelector<HTMLButtonElement>('#transport-mute')!;

    let muted = false;
    game.ui.enableTransport(makeControls({ isMuted: vi.fn(() => muted) }));
    expect(muteButton.dataset.icon).toBe('sound-on');

    // Player wycisza sie sam (autoplay / iOS) — ikona musi to pokazac przy renderze.
    muted = true;
    playTo(clock, game.frame, 1);
    expect(muteButton.dataset.icon).toBe('sound-off');
    expect(muteButton.getAttribute('aria-pressed')).toBe('true');

    muted = false;
    playTo(clock, game.frame, 2);
    expect(muteButton.dataset.icon).toBe('sound-on');
    expect(muteButton.getAttribute('aria-pressed')).toBe('false');
  });

  it('ikony transportu sa inline SVG, nie glifami zaleznymi od fontu systemowego', () => {
    // iOS nie ma w foncie ani `❚❚`, ani `🕪` — glify rysowaly sie jako puste kwadraty.
    const clock = new FakeClock();
    const game = mountGame(root, makeBeatmap([obj('o1', 10)]), clock, { now: clock.now });
    game.ui.enableTransport(makeControls());

    for (const id of ['#transport-play', '#transport-mute']) {
      const button = root.querySelector<HTMLButtonElement>(id)!;
      const svg = button.querySelector('svg.icon');
      expect(svg).not.toBeNull();
      expect(svg!.getAttribute('viewBox')).toBe('0 0 24 24');
      expect(svg!.querySelector('path')).not.toBeNull();
      // Zaden tekst do wyrenderowania — caly znak niesie SVG.
      expect(button.textContent).toBe('');
    }
  });

  it('ikona play zmienia sie na pause wraz z wyrenderowanym stanem odtwarzania', () => {
    const clock = new FakeClock();
    const game = mountGame(root, makeBeatmap([obj('o1', 10)]), clock, { now: clock.now });
    game.ui.enableTransport(makeControls());
    const playButton = root.querySelector<HTMLButtonElement>('#transport-play')!;

    clock.playing = false;
    game.frame();
    expect(playButton.dataset.icon).toBe('play');

    clock.playing = true;
    game.frame();
    expect(playButton.dataset.icon).toBe('pause');
  });

  it('play w transporcie przy widocznej bramce startuje gre zamiast wolac play()', () => {
    const clock = new FakeClock();
    const onStart = vi.fn();
    const game = mountGame(root, makeBeatmap([obj('o1', 10)]), clock, { now: clock.now, onStart });
    const controls = makeControls();
    game.ui.enableTransport(controls);

    const gate = root.querySelector<HTMLElement>('#gate')!;
    expect(gate.hidden).toBe(false);

    root.querySelector<HTMLButtonElement>('#transport-play')!.click();

    expect(gate.hidden).toBe(true);
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(controls.play).not.toHaveBeenCalled();

    // Drugi klik to juz zwykle sterowanie odtwarzaniem.
    clock.playing = false;
    game.frame();
    root.querySelector<HTMLButtonElement>('#transport-play')!.click();
    expect(controls.play).toHaveBeenCalledTimes(1);
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('przezroczysty przycisk YouTube przy widocznej bramce tez startuje gre', () => {
    const clock = new FakeClock();
    const onStart = vi.fn();
    const game = mountGame(root, makeBeatmap([obj('o1', 10)]), clock, { now: clock.now, onStart });
    const controls = makeControls();
    game.ui.enableTransport(controls);

    root.querySelector<HTMLButtonElement>('#yt-button-proxy')!.click();

    expect(root.querySelector<HTMLElement>('#gate')!.hidden).toBe(true);
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(controls.play).not.toHaveBeenCalled();
  });

  it('play w transporcie nie startuje gry, dopoki odtwarzacz nie jest gotowy', () => {
    const clock = new FakeClock();
    const onStart = vi.fn();
    const game = mountGame(root, makeBeatmap([obj('o1', 10)]), clock, { now: clock.now, onStart });
    game.ui.setStartEnabled(false);
    const controls = makeControls();
    game.ui.enableTransport(controls);

    root.querySelector<HTMLButtonElement>('#transport-play')!.click();

    expect(root.querySelector<HTMLElement>('#gate')!.hidden).toBe(false);
    expect(onStart).not.toHaveBeenCalled();
    expect(controls.play).not.toHaveBeenCalled();
  });
});
