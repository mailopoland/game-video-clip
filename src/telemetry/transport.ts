/** Wysylka pojedynczego zdarzenia do PostgREST (ADR-0026). */

import { EVENTS_ENDPOINT, SUPABASE_KEY } from './config.js';

export type TelemetryEventName = 'visit' | 'gate_click' | 'play_start' | 'finish' | 'abandon';

/** Ksztalt wiersza tabeli `events` — kolumny `id` i `ts` sa serwerowe. */
export interface EventPayload {
  visitor_id: string;
  event: TelemetryEventName;
  play_id?: string;
  play_no?: number;
  score?: number;
  hits?: number;
  misses?: number;
  accuracy?: number;
  seeked?: boolean;
}

export interface TransportDeps {
  /** Wstrzykiwane w testach; brak `fetch` w srodowisku = cicha rezygnacja. */
  fetch?: typeof globalThis.fetch;
  endpoint?: string;
  key?: string;
}

/**
 * Fire-and-forget: **nigdy nie rzuca i nigdy nie zwraca obietnicy**. Brak sieci,
 * bloker reklam, HTTP 500 i sukces wygladaja dla wolajacego identycznie —
 * telemetria nie ma jak wywrocic ani spowolnic rozgrywki (ADR-0026).
 */
export function postEvent(payload: EventPayload, deps: TransportDeps = {}): void {
  const send = deps.fetch ?? globalThis.fetch?.bind(globalThis);
  if (!send) return;

  const key = deps.key ?? SUPABASE_KEY;
  try {
    const pending = send(deps.endpoint ?? EVENTS_ENDPOINT, {
      method: 'POST',
      // Przetrwa odladowanie dokumentu (`pagehide` -> `abandon`), a w
      // odroznieniu od `navigator.sendBeacon` pozwala ustawic naglowki,
      // ktorych wymaga PostgREST. Limit 64 kB, payload ma ~200 bajtow.
      keepalive: true,
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        // Jawny zapis DOMYSLKI PostgREST, nie obejscie bledu: goly POST bez
        // `Prefer` i tak zwraca 201 z pustym cialem (zmierzone). Naglowek ma
        // znaczenie dopiero wtedy, gdy o odpowiedz poprosi sie inaczej —
        // `return=representation` wymaga SELECT-a, ktorego rola `anon` nie ma,
        // wiec daje 401 mimo poprawnego zapisu. Tak wlasnie domyslnie wysyla
        // `@supabase/supabase-js`, gdyby ktos kiedys przeszedl z golego fetcha.
        Prefer: 'return=minimal',
      },
      body: JSON.stringify([payload]),
    });
    // Odrzucona obietnica (offline, bloker) nie moze zostac unhandled.
    void Promise.resolve(pending).catch(() => {});
  } catch {
    // `fetch` rzucajacy synchronicznie — stare WebView albo atrapa w tescie.
  }
}
