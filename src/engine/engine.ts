import { samplePath } from './path.js';
import type {
  Beatmap,
  BeatmapObject,
  GameView,
  Result,
  Stats,
  TimeSource,
  VisibleObject,
} from './types.js';

/** Rozjazd wiekszy niz to = przewiniecie, nie szum odczytu (ADR-0003). */
export const SEEK_THRESHOLD_SEC = 0.35;
/** Jak dlugo rozstrzygniety obiekt zostaje na ekranie (animacja "+1" / "X"). */
export const FADE_OUT_MS = 500;

/**
 * Silnik gry. Nie zna ani DOM, ani YouTube — czas dostaje przez `TimeSource`,
 * a zegar scienny przez `now` (ADR-0003, ADR-0006).
 */
export class Engine {
  private readonly byId = new Map<string, BeatmapObject>();
  /** Jedyne zrodlo punktacji. Wynik jest funkcja tej mapy, nie licznikiem. */
  private readonly results = new Map<string, Result>();
  private timeSec = 0;
  private lastWallMs: number;
  private frozen = true;
  private ended = false;

  constructor(
    private readonly beatmap: Beatmap,
    private readonly timeSource: TimeSource,
    private readonly now: () => number = () => performance.now(),
  ) {
    for (const o of beatmap.objects) this.byId.set(o.id, o);
    this.lastWallMs = now();
  }

  /** Wolane raz na klatke (requestAnimationFrame). */
  tick(): void {
    const sample = this.timeSource.sample();
    const wallMs = this.now();
    this.ended = sample.ended;

    if (!sample.playing) {
      // Pauza / buffering / koniec: czas gry nie plynie. Przewiniecie w trakcie
      // pauzy nadal musi zresynchronizowac stan, zeby ekran pokazywal prawde.
      this.frozen = true;
      this.adopt(sample.timeSec);
    } else if (this.frozen) {
      // Wznowienie: brak wiarygodnego `lastWallMs`, wiec nie przewidujemy —
      // adoptujemy odczyt (z resyncem, jesli w miedzyczasie ktos przewinal).
      this.frozen = false;
      this.adopt(sample.timeSec);
    } else {
      const sampleRate = sample.rate;
      const rate = sampleRate !== undefined && Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 1;
      const predictedSec = this.timeSec + ((wallMs - this.lastWallMs) / 1000) * rate;
      if (Math.abs(sample.timeSec - predictedSec) > SEEK_THRESHOLD_SEC) {
        this.resync(sample.timeSec);
      } else {
        // Interpolacja: getCurrentTime() nie odswieza sie co klatke, wiec
        // wygladzamy jego ziarnistosc, nigdy nie cofajac sie o szum odczytu.
        this.timeSec = Math.max(sample.timeSec, predictedSec);
      }
    }

    this.lastWallMs = wallMs;
    this.sweepMisses();
  }

  /**
   * Wejscie gracza. Zwraca true tylko przy trafieniu. Klikniecie w zamrozonym
   * stanie jest ignorowane (wymaganie #5).
   */
  hit(objectId: string): boolean {
    if (this.frozen) return false;
    const object = this.byId.get(objectId);
    if (!object || this.results.has(objectId)) return false;

    const spawnSec = object.path[0]!.t;
    if (this.timeSec < spawnSec) return false; // obiekt jeszcze nie istnieje

    // Reka jest klikalna przez caly czas trwania sciezki (ADR-0015) — jesli
    // obiekt istnieje i nie ma jeszcze wyniku, klik zawsze trafia. Po
    // despawnie sweepMisses() zdazy ustawic 'miss' wczesniej (co tick), wiec
    // results.has(objectId) jest juz true i ta galaz sie nie wykona.
    this.results.set(objectId, { outcome: 'hit', atSec: this.timeSec });
    return true;
  }

  getView(): GameView {
    return {
      timeSec: this.timeSec,
      frozen: this.frozen,
      showResults: this.ended || this.timeSec >= this.beatmap.endScreenAtSec,
      visible: this.visibleObjects(),
      stats: this.getStats(),
    };
  }

  getStats(): Stats {
    let hits = 0;
    let misses = 0;
    for (const { outcome } of this.results.values()) {
      if (outcome === 'hit') hits++;
      else if (outcome === 'miss') misses++;
    }
    const judged = hits + misses;
    return {
      score: hits,
      hits,
      misses,
      accuracy: judged === 0 ? 0 : (hits / judged) * 100,
      // Czytane przy kazdym wywolaniu, wiec `setObjects()` z trybu dev
      // (ADR-0018) od razu przesuwa mianownik ekranu wyniku.
      total: this.beatmap.objects.length,
    };
  }

  /** Widoczne tylko dla testow/diagnostyki. */
  getOutcome(objectId: string): Result | undefined {
    return this.results.get(objectId);
  }

  /**
   * Podmienia liste obiektow bez restartu gry — dla trybu deweloperskiego
   * nagrywania sciezki (ADR-0016). Przebudowuje `byId`, kasuje wyniki
   * obiektow, ktorych juz nie ma, i resynchronizuje stan w biezacej chwili:
   * nowo dodany obiekt z despawnem w przeszlosci dostaje `skipped` zamiast
   * blysnac `X` z `sweepMisses`, a obiekty juz rozstrzygniete zostaja bez zmian.
   */
  setObjects(objects: BeatmapObject[]): void {
    this.beatmap.objects = objects;

    this.byId.clear();
    for (const o of objects) this.byId.set(o.id, o);

    const stillPresent = new Set(objects.map((o) => o.id));
    for (const id of this.results.keys()) {
      if (!stillPresent.has(id)) this.results.delete(id);
    }

    this.resync(this.timeSec);
  }

  private adopt(timeSec: number): void {
    if (Math.abs(timeSec - this.timeSec) > SEEK_THRESHOLD_SEC) this.resync(timeSec);
    else this.timeSec = timeSec;
  }

  /**
   * Jedyne miejsce obslugujace przewijanie (ADR-0003).
   * - w tyl: kasuje wyniki obiektow z przyszlosci => mozna zagrac je ponownie,
   *   a wynik jest nadpisywany, nie sumowany;
   * - w przod: pominiete obiekty dostaja `skipped` => zero falszywych pudel.
   */
  private resync(targetSec: number): void {
    for (const object of this.beatmap.objects) {
      const despawnSec = object.path[object.path.length - 1]!.t;
      if (despawnSec >= targetSec) {
        this.results.delete(object.id);
      } else if (!this.results.has(object.id)) {
        this.results.set(object.id, { outcome: 'skipped', atSec: targetSec });
      }
    }
    this.timeSec = targetSec;
  }

  /** Obiekt bez wyniku, ktoremu minal despawn (koniec sciezki), to pudlo. */
  private sweepMisses(): void {
    for (const object of this.beatmap.objects) {
      if (this.results.has(object.id)) continue;
      const despawnSec = object.path[object.path.length - 1]!.t;
      if (this.timeSec > despawnSec) {
        this.results.set(object.id, { outcome: 'miss', atSec: despawnSec });
      }
    }
  }

  private visibleObjects(): VisibleObject[] {
    const visible: VisibleObject[] = [];
    for (const object of this.beatmap.objects) {
      const result = this.results.get(object.id);
      if (result?.outcome === 'skipped') continue;

      if (result) {
        if (this.timeSec > result.atSec + FADE_OUT_MS / 1000) continue;
        if (this.timeSec < result.atSec) continue;
        const { x, y, size } = samplePath(object.path, this.timeSec);
        visible.push({ object, outcome: result.outcome, x, y, size });
        continue;
      }

      if (this.timeSec < object.path[0]!.t) continue; // jeszcze nie spawnowany
      const { x, y, size } = samplePath(object.path, this.timeSec);
      visible.push({ object, x, y, size });
    }
    return visible;
  }
}
