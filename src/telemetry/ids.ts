/**
 * Tozsamosci telemetrii (ADR-0026) nad wstrzykiwanym `Storage`.
 *
 * `visitor_id` identyfikuje PRZEGLADARKE, nie czlowieka — tryb prywatny,
 * uruchomienie PWA z ekranu poczatkowego (osobny storage), drugie urzadzenie
 * i wyczyszczenie danych tworza nowego „gracza". Swiadome ograniczenie,
 * opisane w README i w `docs/SUPABASE.md`.
 */

export const VISITOR_KEY = 'gvc.visitor';
export const PLAY_NO_KEY = 'gvc.playNo';

/** Gorna granica z CHECK-a `events_play_no_ck` w bazie. */
const MAX_PLAY_NO = 100000;

/** Ten sam ksztalt, co CHECK-i `events_visitor_ck` / `events_play_ck`. */
const ID_SHAPE = /^[0-9a-fA-F-]{8,64}$/;

/** Wycinek `Storage`, ktorego uzywamy — testy podstawiaja atrape. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Safari w trybie prywatnym potrafi rzucic na samym dostepie do storage. */
function read(storage: KeyValueStorage | undefined, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(storage: KeyValueStorage | undefined, key: string, value: string): void {
  try {
    storage?.setItem(key, value);
  } catch {
    // Brak trwalosci pogarsza statystyke, ale nie moze zatrzymac gry.
  }
}

/** UUID, a bez `crypto.randomUUID` — 32 znaki hex. Oba przechodza `ID_SHAPE`. */
export function randomId(): string {
  try {
    const uuid = globalThis.crypto?.randomUUID?.();
    if (uuid) return uuid;
  } catch {
    // randomUUID bywa niedostepne poza bezpiecznym kontekstem (http://).
  }
  let out = '';
  for (let i = 0; i < 8; i++) {
    out += Math.floor(Math.random() * 0x10000)
      .toString(16)
      .padStart(4, '0');
  }
  return out;
}

/**
 * Stale id przegladarki. Wartosc o zlym ksztalcie (recznie podmieniona
 * w devtoolsach) jest odrzucana — inaczej baza odbilaby INSERT CHECK-iem
 * i zdarzenia tej przegladarki znikalyby po cichu.
 */
export function getVisitorId(storage: KeyValueStorage | undefined): string {
  const stored = read(storage, VISITOR_KEY);
  if (stored && ID_SHAPE.test(stored)) return stored;

  const fresh = randomId();
  write(storage, VISITOR_KEY, fresh);
  return fresh;
}

/** Ktora to z kolei rozgrywka tej przegladarki — liczona takze miedzy wizytami. */
export function nextPlayNo(storage: KeyValueStorage | undefined): number {
  const previous = Number.parseInt(read(storage, PLAY_NO_KEY) ?? '', 10);
  const next = Number.isFinite(previous) && previous > 0 ? Math.min(previous + 1, MAX_PLAY_NO) : 1;
  write(storage, PLAY_NO_KEY, String(next));
  return next;
}
