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
      const predictedSec = this.timeSec + (wallMs - this.lastWallMs) / 1000;
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

    const hitWindowSec = object.hitWindowMs / 1000;
    const spawnSec = object.time - object.duration / 1000;
    if (this.timeSec < spawnSec) return false; // obiekt jeszcze nie istnieje

    const inWindow =
      this.timeSec >= object.time - hitWindowSec && this.timeSec <= object.time + hitWindowSec;
    this.results.set(objectId, {
      outcome: inWindow ? 'hit' : 'miss',
      atSec: this.timeSec,
    });
    return inWindow;
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
    };
  }

  /** Widoczne tylko dla testow/diagnostyki. */
  getOutcome(objectId: string): Result | undefined {
    return this.results.get(objectId);
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
      if (object.time >= targetSec) {
        this.results.delete(object.id);
      } else if (
        !this.results.has(object.id) &&
        object.time + object.hitWindowMs / 1000 < targetSec
      ) {
        this.results.set(object.id, { outcome: 'skipped', atSec: targetSec });
      }
    }
    this.timeSec = targetSec;
  }

  /** Obiekt bez wyniku, ktoremu minelo okno trafienia, to pudlo. */
  private sweepMisses(): void {
    for (const object of this.beatmap.objects) {
      if (this.results.has(object.id)) continue;
      if (this.timeSec > object.time + object.hitWindowMs / 1000) {
        this.results.set(object.id, {
          outcome: 'miss',
          atSec: object.time + object.hitWindowMs / 1000,
        });
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
        visible.push({ object, approach: 0, outcome: result.outcome });
        continue;
      }

      const durationSec = object.duration / 1000;
      const remainingSec = object.time - this.timeSec;
      if (remainingSec > durationSec) continue; // jeszcze nie spawnowany
      visible.push({ object, approach: clamp(remainingSec / durationSec, 0, 1) });
    }
    return visible;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
