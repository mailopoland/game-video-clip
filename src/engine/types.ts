/** Model danych beatmapy i stanu gry — patrz ADR-0003 i ADR-0004. */

export interface PathPoint {
  /** Sekunda wideo — ta sama skala co BeatmapObject.time. */
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
  /** Sekundy odtwarzania wideo: moment idealnego trafienia. */
  time: number;
  /** Milisekundy fazy approach — obiekt pojawia sie w `time - duration`. */
  duration: number;
  /** Klucz w rejestrze SPRITES. */
  sprite: string;
  /** Tolerancja trafienia: +/- wokol `time`, w milisekundach. */
  hitWindowMs: number;
  /** Sciezka ruchu — min. 1 punkt, scisle rosnaco po `t`.
      Poza zakresem: przytrzymanie skrajnego punktu. */
  path: PathPoint[];
}

export interface Beatmap {
  videoId: string;
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
}

export interface VisibleObject {
  object: BeatmapObject;
  /** 1 = moment pojawienia sie, 0 = moment trafienia. Steruje approach circle. */
  approach: number;
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
