/** Model danych beatmapy i stanu gry — patrz ADR-0003 i ADR-0004. */

export interface PathPoint {
  /** Sekunda wideo, absolutna. */
  t: number;
  /** Procent szerokosci warstwy gry (srodek obiektu). */
  x: number;
  /** Procent wysokosci warstwy gry (srodek obiektu). */
  y: number;
  /** Procent bazowego rozmiaru obiektu (100 = domyslny rozmiar z CSS). */
  size: number;
}

export interface BeatmapObject {
  /** Unikalny, stabilny identyfikator — klucz wynikow przy przewijaniu. */
  id: string;
  /** Klucz w rejestrze SPRITES. */
  sprite: string;
  /** Sciezka ruchu — min. 2 punkty (start i koniec), scisle rosnaco po `t`.
      `path[0].t` to spawn obiektu, `path[ostatni].t` to despawn — caly ten
      przedzial jest jednoczesnie oknem klikalnosci (ADR-0015). */
  path: PathPoint[];
}

export interface Beatmap {
  videoId: string;
  /** Dlugosc samego filmu w sekundach. Odniesienie do wykrywania reklam
      (ADR-0022) — `getDuration()` w trakcie reklamy zwraca dlugosc kreacji.
      Brak pola = detekcja wylaczona. */
  videoDurationSec?: number;
  /** Sekunda, od ktorej pokazujemy ekran wyniku (poza tym: stan ENDED). */
  endScreenAtSec: number;
  objects: BeatmapObject[];
}

/** `skipped` = obiekt pominiety przez przewiniecie do przodu; nie liczy sie do celnosci. */
export type Outcome = 'hit' | 'miss' | 'skipped';

export interface Result {
  outcome: Outcome;
  /** Sekunda wideo, w ktorej obiekt zostal rozstrzygniety (do animacji zaniku). */
  atSec: number;
}

export interface TimeSample {
  timeSec: number;
  /** false => gra zamrozona (pauza / buffering / cued / ended). */
  playing: boolean;
  ended: boolean;
  /** Tempo odtwarzania. Brak/niedodatnie/nieskonczone == 1 (domyslne, 1x). */
  rate?: number;
}

/** Jedyne wejscie czasu do silnika. Testy wstrzykuja fake clock (ADR-0006). */
export interface TimeSource {
  sample(): TimeSample;
}

export interface Stats {
  score: number;
  hits: number;
  misses: number;
  /** Procent 0–100. Obiekty `skipped` sa poza mianownikiem. */
  accuracy: number;
  /** Liczba WSZYSTKICH celow beatmapy — mianownik ekranu wyniku (ADR-0025). */
  total: number;
}

export interface VisibleObject {
  object: BeatmapObject;
  /** Ustawione dopiero po rozstrzygnieciu — steruje animacja "+1" / "X". */
  outcome?: Outcome;
  /** Zinterpolowana pozycja i rozmiar dla `GameView.timeSec`. */
  x: number;
  y: number;
  size: number;
}

export interface GameView {
  timeSec: number;
  frozen: boolean;
  showResults: boolean;
  visible: VisibleObject[];
  stats: Stats;
}
