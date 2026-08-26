// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { mountGame } from '../src/game.js';
import { createTelemetry, type FrameView } from '../src/telemetry/telemetry.js';
import { FakeClock, makeBeatmap, obj } from './fake-clock.js';
import { getVisitorId, nextPlayNo, PLAY_NO_KEY, VISITOR_KEY, type KeyValueStorage } from '../src/telemetry/ids.js';
import { postEvent, type EventPayload } from '../src/telemetry/transport.js';

/** Atrapa `localStorage`. Wariant `throws` odwzorowuje Safari w trybie prywatnym. */
class FakeStorage implements KeyValueStorage {
  map = new Map<string, string>();
  throws = false;

  getItem(key: string): string | null {
    if (this.throws) throw new Error('SecurityError');
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.throws) throw new Error('SecurityError');
    this.map.set(key, value);
  }
}

/** Minimalny `GameView` — telemetria czyta z niego tylko trzy rzeczy. */
function view(
  overrides: Partial<Omit<FrameView, 'stats'>> & { stats?: Partial<FrameView['stats']> } = {},
): FrameView {
  return {
    frozen: overrides.frozen ?? false,
    showResults: overrides.showResults ?? false,
    stats: { score: 0, hits: 0, misses: 0, accuracy: 0, ...overrides.stats },
  };
}

function setup(storage: KeyValueStorage = new FakeStorage()) {
  const sent: EventPayload[] = [];
  const telemetry = createTelemetry({ send: (payload) => sent.push(payload), storage });
  const names = (): string[] => sent.map((payload) => payload.event);
  return { telemetry, sent, storage, names };
}

/** Skrot: wejscie -> bramka -> pierwsza zywa klatka. */
function startPlaying(t: ReturnType<typeof setup>): void {
  t.telemetry.visit();
  t.telemetry.gateClick();
  t.telemetry.frame(view());
}

describe('createTelemetry — cykl zdarzen', () => {
  it('visit() wysyla dokladnie jedno zdarzenie, drugie wywolanie nic nie dodaje', () => {
    const t = setup();
    t.telemetry.visit();
    t.telemetry.visit();

    expect(t.names()).toEqual(['visit']);
    expect(t.sent[0]!.visitor_id).toMatch(/^[0-9a-fA-F-]{8,64}$/);
  });

  it('gateClick() wysyla gate_click raz', () => {
    const t = setup();
    t.telemetry.gateClick();
    t.telemetry.gateClick();

    expect(t.names()).toEqual(['gate_click']);
  });

  it('klatki przed bramka nie otwieraja rozgrywki', () => {
    const t = setup();
    t.telemetry.visit();
    t.telemetry.frame(view());
    t.telemetry.frame(view());

    expect(t.names()).toEqual(['visit']);
  });

  // Pre-roll: adapter melduje `playing: false` przez cala reklame (ADR-0024),
  // wiec odplyw na niej ma wygladac jak gate_click BEZ play_start.
  it('zamrozone klatki po gate_click nie daja play_start', () => {
    const t = setup();
    t.telemetry.gateClick();
    for (let i = 0; i < 20; i++) t.telemetry.frame(view({ frozen: true }));

    expect(t.names()).toEqual(['gate_click']);
  });

  it('pierwsza zywa klatka daje play_start z play_no = 1, kolejne nie duplikuja', () => {
    const t = setup();
    t.telemetry.gateClick();
    t.telemetry.frame(view());
    t.telemetry.frame(view());
    t.telemetry.frame(view());

    expect(t.names()).toEqual(['gate_click', 'play_start']);
    expect(t.sent[1]!.play_no).toBe(1);
    expect(t.sent[1]!.play_id).toMatch(/^[0-9a-fA-F-]{8,64}$/);
  });

  it('showResults daje finish raz — takze gdy ekran wyniku zgasnie i zapali sie ponownie', () => {
    const t = setup();
    startPlaying(t);

    t.telemetry.frame(view({ showResults: true }));
    // Seek w tyl gasi ekran wyniku i zapala go ponownie — bez deduplikacji
    // jedna gra dawalaby N ukonczen.
    t.telemetry.frame(view({ showResults: true }));
    t.telemetry.frame(view({ showResults: true }));

    expect(t.names().filter((name) => name === 'finish')).toHaveLength(1);
  });

  it('finish niesie snapshot statystyk z klatki, w ktorej padl', () => {
    const t = setup();
    startPlaying(t);

    const last = view({ showResults: true, stats: { score: 7, hits: 7, misses: 3, accuracy: 70 } });
    t.telemetry.frame(last);

    // Pozniejsza zmiana statystyk nie moze ruszyc wyslanego payloadu — wynik
    // jest funkcja mapy wynikow i po seeku w tyl potrafi zmalec.
    last.stats.score = 999;

    const finish = t.sent.find((payload) => payload.event === 'finish')!;
    expect(finish.score).toBe(7);
    expect(finish.hits).toBe(7);
    expect(finish.misses).toBe(3);
    expect(finish.accuracy).toBe(70);
  });

  it('accuracy jest zaokraglane do dwoch miejsc (kolumna numeric(5,2))', () => {
    const t = setup();
    startPlaying(t);
    t.telemetry.frame(view({ showResults: true, stats: { accuracy: 66.66666666666667 } }));

    expect(t.sent.find((payload) => payload.event === 'finish')!.accuracy).toBe(66.67);
  });

  it('showResults bez wczesniejszego play_start nie daje finish', () => {
    const t = setup();
    t.telemetry.gateClick();
    t.telemetry.frame(view({ showResults: true }));
    t.telemetry.frame(view({ showResults: true, frozen: true }));

    expect(t.names()).toEqual(['gate_click']);
  });
});

describe('createTelemetry — wiele rozgrywek', () => {
  it('PLAY AGAIN po ekranie wyniku otwiera nowa rozgrywke z nowym play_id i play_no', () => {
    const t = setup();
    startPlaying(t);
    t.telemetry.frame(view({ showResults: true }));
    // `PLAY AGAIN` to seekTo(0) + play() (ADR-0025) — dla telemetrii zwykla
    // klatka bez ekranu wyniku.
    t.telemetry.seek(0);
    t.telemetry.frame(view());

    const starts = t.sent.filter((payload) => payload.event === 'play_start');
    expect(starts).toHaveLength(2);
    expect(starts[1]!.play_no).toBe(2);
    expect(starts[1]!.play_id).not.toBe(starts[0]!.play_id);
  });

  it('druga rozgrywka konczy sie wlasnym finish', () => {
    const t = setup();
    startPlaying(t);
    t.telemetry.frame(view({ showResults: true, stats: { score: 3 } }));
    t.telemetry.seek(0);
    t.telemetry.frame(view());
    t.telemetry.frame(view({ showResults: true, stats: { score: 9 } }));

    const finishes = t.sent.filter((payload) => payload.event === 'finish');
    expect(finishes.map((payload) => payload.score)).toEqual([3, 9]);
    expect(finishes[1]!.play_no).toBe(2);
  });

  it('play_no rosnie miedzy instancjami dzielacymi ten sam storage (powrot gracza)', () => {
    const storage = new FakeStorage();
    const first = setup(storage);
    startPlaying(first);

    const second = setup(storage);
    startPlaying(second);

    expect(first.sent.find((p) => p.event === 'play_start')!.play_no).toBe(1);
    expect(second.sent.find((p) => p.event === 'play_start')!.play_no).toBe(2);
  });

  it('visitor_id jest stabilny miedzy instancjami na tym samym storage', () => {
    const storage = new FakeStorage();
    const first = setup(storage);
    const second = setup(storage);
    first.telemetry.visit();
    second.telemetry.visit();

    expect(second.sent[0]!.visitor_id).toBe(first.sent[0]!.visitor_id);
  });

  it('storage rzucajacy przy kazdym dostepie nie wywraca telemetrii', () => {
    const storage = new FakeStorage();
    storage.throws = true;
    const t = setup(storage);
    startPlaying(t);
    t.telemetry.frame(view({ showResults: true }));

    expect(t.names()).toEqual(['visit', 'gate_click', 'play_start', 'finish']);
    // Id jest tylko nietrwale — ksztalt musi zostac zgodny z CHECK-iem w bazie.
    expect(t.sent[0]!.visitor_id).toMatch(/^[0-9a-fA-F-]{8,64}$/);
  });

  it('brak storage w ogole (deps.storage === undefined) nie wywraca telemetrii', () => {
    const sent: EventPayload[] = [];
    const telemetry = createTelemetry({ send: (payload) => sent.push(payload), storage: undefined });
    telemetry.visit();
    telemetry.gateClick();
    telemetry.frame(view());

    expect(sent.map((payload) => payload.event)).toEqual(['visit', 'gate_click', 'play_start']);
    expect(sent[2]!.play_no).toBe(1);
  });
});

describe('createTelemetry — flaga seeked', () => {
  it('przewiniecie w trakcie rozgrywki zapala seeked na finish', () => {
    const t = setup();
    startPlaying(t);
    t.telemetry.seek(42);
    t.telemetry.frame(view({ showResults: true }));

    expect(t.sent.find((payload) => payload.event === 'finish')!.seeked).toBe(true);
  });

  it('rozgrywka bez przewijania konczy sie seeked = false', () => {
    const t = setup();
    startPlaying(t);
    t.telemetry.frame(view({ showResults: true }));

    expect(t.sent.find((payload) => payload.event === 'finish')!.seeked).toBe(false);
  });

  it('seek(0) przy zamknietej rozgrywce to restart — nie brudzi nastepnej gry', () => {
    const t = setup();
    startPlaying(t);
    t.telemetry.frame(view({ showResults: true }));
    t.telemetry.seek(0);
    t.telemetry.frame(view());
    t.telemetry.frame(view({ showResults: true }));

    const finishes = t.sent.filter((payload) => payload.event === 'finish');
    expect(finishes[1]!.seeked).toBe(false);
  });

  it('seek w glab klipu przy zamknietej rozgrywce przechodzi na nastepna gre', () => {
    const t = setup();
    startPlaying(t);
    t.telemetry.frame(view({ showResults: true }));
    t.telemetry.seek(90);
    t.telemetry.frame(view());
    t.telemetry.frame(view({ showResults: true }));

    const finishes = t.sent.filter((payload) => payload.event === 'finish');
    expect(finishes[1]!.seeked).toBe(true);
  });

  it('seek przed pierwsza rozgrywka przechodzi na nia', () => {
    const t = setup();
    t.telemetry.gateClick();
    t.telemetry.seek(120);
    t.telemetry.frame(view());
    t.telemetry.frame(view({ showResults: true }));

    expect(t.sent.find((payload) => payload.event === 'finish')!.seeked).toBe(true);
  });
});

describe('createTelemetry — pagehide', () => {
  it('porzucenie rozpoczetej rozgrywki daje abandon ze snapshotem', () => {
    const t = setup();
    startPlaying(t);
    t.telemetry.frame(view({ stats: { score: 4, hits: 4, misses: 1, accuracy: 80 } }));
    t.telemetry.pageHide();

    const abandon = t.sent.find((payload) => payload.event === 'abandon')!;
    expect(abandon.score).toBe(4);
    expect(abandon.misses).toBe(1);
    expect(abandon.play_no).toBe(1);
  });

  it('pagehide po finish nie daje abandon', () => {
    const t = setup();
    startPlaying(t);
    t.telemetry.frame(view({ showResults: true }));
    t.telemetry.pageHide();

    expect(t.names()).toEqual(['visit', 'gate_click', 'play_start', 'finish']);
  });

  it('pagehide bez rozgrywki (wszedl i wyszedl) nie daje abandon', () => {
    const t = setup();
    t.telemetry.visit();
    t.telemetry.pageHide();

    expect(t.names()).toEqual(['visit']);
  });

  it('dwa pagehide z rzedu daja jeden abandon', () => {
    const t = setup();
    startPlaying(t);
    t.telemetry.pageHide();
    t.telemetry.pageHide();

    expect(t.names().filter((name) => name === 'abandon')).toHaveLength(1);
  });
});

describe('ids — tozsamosci nad storage', () => {
  it('getVisitorId zapisuje wygenerowane id i zwraca je przy kolejnym odczycie', () => {
    const storage = new FakeStorage();
    const first = getVisitorId(storage);

    expect(storage.map.get(VISITOR_KEY)).toBe(first);
    expect(getVisitorId(storage)).toBe(first);
  });

  // Recznie podmieniona wartosc w devtoolsach odbilaby sie o CHECK w bazie
  // i zdarzenia tej przegladarki znikalyby po cichu.
  it('getVisitorId odrzuca wartosc o zlym ksztalcie', () => {
    const storage = new FakeStorage();
    storage.map.set(VISITOR_KEY, 'nie-jest-hexem-!!');

    expect(getVisitorId(storage)).toMatch(/^[0-9a-fA-F-]{8,64}$/);
  });

  it('nextPlayNo liczy od 1 i rosnie', () => {
    const storage = new FakeStorage();

    expect(nextPlayNo(storage)).toBe(1);
    expect(nextPlayNo(storage)).toBe(2);
    expect(storage.map.get(PLAY_NO_KEY)).toBe('2');
  });

  it('nextPlayNo ignoruje smieci w storage', () => {
    const storage = new FakeStorage();
    storage.map.set(PLAY_NO_KEY, 'ala ma kota');

    expect(nextPlayNo(storage)).toBe(1);
  });
});

describe('postEvent — transport', () => {
  interface Call {
    url: string;
    init: RequestInit;
  }

  let calls: Call[];

  beforeEach(() => {
    calls = [];
  });

  const okFetch = ((url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve({ ok: true, status: 201 } as Response);
  }) as unknown as typeof globalThis.fetch;

  const payload: EventPayload = { visitor_id: 'abcdef12', event: 'visit' };

  it('POST-uje na endpoint tabeli z naglowkami wymaganymi przez PostgREST', () => {
    postEvent(payload, { fetch: okFetch, endpoint: 'https://example.test/rest/v1/events', key: 'K' });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://example.test/rest/v1/events');
    expect(calls[0]!.init.method).toBe('POST');

    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.apikey).toBe('K');
    expect(headers.Authorization).toBe('Bearer K');
    expect(headers['Content-Type']).toBe('application/json');
    // Bez tego PostgREST probuje zwrocic wiersz, a `anon` nie ma SELECT.
    expect(headers.Prefer).toBe('return=minimal');
  });

  it('uzywa keepalive, zeby zdarzenie przetrwalo pagehide', () => {
    postEvent(payload, { fetch: okFetch });

    expect(calls[0]!.init.keepalive).toBe(true);
  });

  it('cialo to tablica z jednym wierszem (format INSERT w PostgREST)', () => {
    postEvent({ ...payload, event: 'finish', score: 5 }, { fetch: okFetch });

    expect(JSON.parse(calls[0]!.init.body as string)).toEqual([
      { visitor_id: 'abcdef12', event: 'finish', score: 5 },
    ]);
  });

  it('odrzucone fetch (offline, bloker reklam) nie rzuca i nie zostawia unhandled rejection', async () => {
    const failing = (() => Promise.reject(new Error('Failed to fetch'))) as unknown as typeof globalThis.fetch;

    expect(() => postEvent(payload, { fetch: failing })).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('fetch rzucajacy synchronicznie nie rzuca dalej', () => {
    const throwing = (() => {
      throw new Error('SecurityError');
    }) as unknown as typeof globalThis.fetch;

    expect(() => postEvent(payload, { fetch: throwing })).not.toThrow();
  });

  it('HTTP 500 nie rzuca', async () => {
    const server500 = (() => Promise.resolve({ ok: false, status: 500 } as Response)) as unknown as typeof globalThis.fetch;

    expect(() => postEvent(payload, { fetch: server500 })).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('srodowisko bez fetch — cicha rezygnacja', () => {
    const original = globalThis.fetch;
    // @ts-expect-error celowo usuwamy fetch, zeby odwzorowac stare WebView
    delete globalThis.fetch;
    try {
      expect(() => postEvent(payload)).not.toThrow();
    } finally {
      globalThis.fetch = original;
    }
  });
});

/**
 * Odwzorowanie wpiecia z `src/main.ts` — ten sam `mountGame`, co produkcja,
 * tylko na wstrzyknietym zrodle czasu (jak `describe('dzwiek trafienia
 * w rozgrywce')` w `sound.test.ts`). `main.ts` samo w sobie nie da sie
 * zaimportowac w tescie: uruchamia bootstrap i YouTube przy imporcie.
 */
describe('telemetria w rozgrywce', () => {
  let root: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    root = document.querySelector<HTMLElement>('#app')!;
  });

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

  function mount(send: (payload: EventPayload) => void) {
    const clock = new FakeClock();
    const telemetry = createTelemetry({ send, storage: new FakeStorage() });
    telemetry.visit();
    const beatmap = makeBeatmap([obj('o1', 10)], 12);
    const game = mountGame(root, beatmap, clock, {
      now: clock.now,
      onStart: () => telemetry.gateClick(),
      onFrame: (gameView) => telemetry.frame(gameView),
    });
    return { clock, game, telemetry };
  }

  it('pelny przebieg daje visit, gate_click, play_start i finish z wynikiem', () => {
    const sent: EventPayload[] = [];
    const { clock, game } = mount((payload) => sent.push(payload));

    tap(root.querySelector('#start')!);
    playTo(clock, game.frame, 10.0);
    tap(root.querySelector('.obj[data-id="o1"]')!);
    playTo(clock, game.frame, 12.5); // przekroczenie endScreenAtSec

    expect(sent.map((payload) => payload.event)).toEqual([
      'visit',
      'gate_click',
      'play_start',
      'finish',
    ]);

    const finish = sent[3]!;
    expect(finish.score).toBe(1);
    expect(finish.hits).toBe(1);
    expect(finish.seeked).toBe(false);
    expect(finish.play_no).toBe(1);
    expect(finish.play_id).toBe(sent[2]!.play_id);
  });

  it('gate_click nie leci, dopoki gracz nie tapnie bramki', () => {
    const sent: EventPayload[] = [];
    const { clock, game } = mount((payload) => sent.push(payload));

    playTo(clock, game.frame, 10.5);

    expect(sent.map((payload) => payload.event)).toEqual(['visit']);
  });

  // Twarde wymaganie ADR-0026: brak sieci, bloker reklam ani blad zapisu nie
  // moga wywrocic rozgrywki. Tu `send` rzuca synchronicznie na kazdym zdarzeniu.
  it('rzucajaca wysylka nie przerywa petli gry ani nie psuje punktacji', () => {
    const { clock, game } = mount(() => {
      throw new Error('ERR_BLOCKED_BY_CLIENT');
    });

    expect(() => {
      tap(root.querySelector('#start')!);
      playTo(clock, game.frame, 10.0);
      tap(root.querySelector('.obj[data-id="o1"]')!);
      playTo(clock, game.frame, 12.5);
    }).not.toThrow();

    expect(game.engine.getStats().score).toBe(1);
    expect(root.querySelector<HTMLElement>('#results')!.hidden).toBe(false);
  });
});
