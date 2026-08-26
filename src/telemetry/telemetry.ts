/**
 * Maszyna stanu telemetrii (ADR-0026).
 *
 * Nie zna DOM, `fetch` ani `localStorage` — wszystko wchodzi przez `deps`,
 * dokladnie tak jak silnik dostaje czas przez `TimeSource` (ADR-0003). Dzieki
 * temu caly cykl zdarzen da sie przetestowac bez przegladarki i bez sieci.
 *
 * Piec zdarzen:
 *
 *   visit       — raz na zaladowanie strony
 *   gate_click  — raz, gdy gracz klika bramke startowa
 *   play_start  — pierwsza klatka, w ktorej gra faktycznie zyje
 *   finish      — pierwsza klatka z `showResults` dla danej rozgrywki
 *   abandon     — `pagehide`, gdy byl `play_start`, a nie bylo `finish`
 */

import { getVisitorId, nextPlayNo, randomId, type KeyValueStorage } from './ids.js';
import { postEvent, type EventPayload } from './transport.js';

/** Wycinek `GameView`, ktorego potrzebuje telemetria — `GameView` go spelnia. */
export interface FrameView {
  frozen: boolean;
  showResults: boolean;
  stats: { score: number; hits: number; misses: number; accuracy: number };
}

export interface Telemetry {
  /** Wejscie na strone. Kolejne wywolania sa ignorowane. */
  visit(): void;
  /** Klik w bramke startowa. Kolejne wywolania sa ignorowane. */
  gateClick(): void;
  /** Jedna klatka gry — jedyne zrodlo `play_start` i `finish`. */
  frame(view: FrameView): void;
  /** Przewiniecie suwakiem transportu (albo `PLAY AGAIN`). */
  seek(toSec: number): void;
  /** `pagehide` — ostatnia szansa na zameldowanie porzuconej rozgrywki. */
  pageHide(): void;
}

export interface TelemetryDeps {
  send?: (payload: EventPayload) => void;
  storage?: KeyValueStorage;
}

/**
 * `seekTo(0)` przy zamknietej rozgrywce to restart przez `PLAY AGAIN`
 * (ADR-0025), a nie „dojechanie suwakiem" — nie moze zapalac flagi `seeked`
 * kolejnej gry. Kazde inne przewiniecie owszem.
 */
const RESTART_EPSILON_SEC = 0.5;

interface Play {
  id: string;
  no: number;
  seeked: boolean;
}

interface StatsSnapshot {
  score: number;
  hits: number;
  misses: number;
  accuracy: number;
}

/** Kolumna `accuracy` to `numeric(5,2)` — nie ma po co wysylac 16 cyfr. */
function snapshot(stats: FrameView['stats']): StatsSnapshot {
  return {
    score: stats.score,
    hits: stats.hits,
    misses: stats.misses,
    accuracy: Math.round(stats.accuracy * 100) / 100,
  };
}

function defaultStorage(): KeyValueStorage | undefined {
  try {
    // Sam DOSTEP do `localStorage` potrafi rzucic (ustawienia prywatnosci).
    return globalThis.localStorage ?? undefined;
  } catch {
    return undefined;
  }
}

export function createTelemetry(deps: TelemetryDeps = {}): Telemetry {
  const emit = deps.send ?? ((payload: EventPayload) => postEvent(payload));
  // `postEvent` sam nigdy nie rzuca, ale gwarancja „telemetria nie wywraca
  // rozgrywki" ma byc strukturalna, a nie zalezec od tego, kto wstrzyknie
  // `send`. Koszt: jeden try/catch na PRZEJSCIE STANU, nie na klatke.
  const send = (payload: EventPayload): void => {
    try {
      emit(payload);
    } catch {
      // celowo cicho
    }
  };
  const storage = 'storage' in deps ? deps.storage : defaultStorage();
  const visitorId = getVisitorId(storage);

  let visitSent = false;
  let gateSent = false;
  let play: Play | null = null;
  /** Przewiniecie zrobione poza rozgrywka — przechodzi na nastepna. */
  let pendingSeek = false;
  let lastStats: StatsSnapshot = { score: 0, hits: 0, misses: 0, accuracy: 0 };

  const closePlay = (event: 'finish' | 'abandon', stats: StatsSnapshot): void => {
    if (!play) return;
    send({
      visitor_id: visitorId,
      event,
      play_id: play.id,
      play_no: play.no,
      seeked: play.seeked,
      ...stats,
    });
    play = null;
  };

  return {
    visit(): void {
      if (visitSent) return;
      visitSent = true;
      send({ visitor_id: visitorId, event: 'visit' });
    },

    gateClick(): void {
      if (gateSent) return;
      gateSent = true;
      send({ visitor_id: visitorId, event: 'gate_click' });
    },

    frame(view: FrameView): void {
      // Goraca sciezka: same porownania. Wysylka leci WYLACZNIE na przejsciach
      // stanu, wiec `frame()` nie robi I/O co klatke.
      if (!gateSent) return;

      if (!play) {
        // Zamrozony player to takze reklama (ADR-0024): pre-roll trzyma
        // `frozen` na `true`, wiec odplyw na reklamie zostaje widoczny jako
        // `gate_click` bez `play_start`, a nie jako brak zainteresowania.
        if (view.frozen || view.showResults) return;
        play = { id: randomId(), no: nextPlayNo(storage), seeked: pendingSeek };
        pendingSeek = false;
        lastStats = snapshot(view.stats);
        send({
          visitor_id: visitorId,
          event: 'play_start',
          play_id: play.id,
          play_no: play.no,
        });
        return;
      }

      lastStats = snapshot(view.stats);
      // `finish` idzie raz na rozgrywke: ekran wyniku gasnie po seeku w tyl
      // i zapala sie ponownie, wiec bez tego jedna gra dawalaby N ukonczen.
      // Zamkniecie rozgrywki jest deduplikacja — powrot do gry otwiera nowa.
      if (view.showResults) closePlay('finish', lastStats);
    },

    seek(toSec: number): void {
      if (play) {
        play.seeked = true;
        return;
      }
      if (toSec > RESTART_EPSILON_SEC) pendingSeek = true;
    },

    pageHide(): void {
      closePlay('abandon', lastStats);
    },
  };
}
