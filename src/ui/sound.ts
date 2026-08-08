/**
 * Dzwiek trafienia jako pula elementow `Audio` (ADR-0011). Pula, a nie jeden
 * element, bo restart przez `currentTime = 0` ucinalby poprzedni klaps przy
 * dwoch szybkich trafieniach — a najmniejszy odstep miedzy celami w beatmapie
 * jest krotszy niz dlugosc klapsu.
 */
export interface HitSound {
  /** Jednorazowe odblokowanie kazdego elementu w obrebie gestu uzytkownika (iOS/WebKit). */
  unlock(): void;
  /** Odtwarza klaps na kolejnym elemencie puli (round-robin). */
  play(): void;
}

/**
 * Wzmocnienie glosnosci wzgledem `getReferenceVolume() === 1` (ADR-0013).
 * `HTMLAudioElement.volume` jest ograniczone do 1.0 — przekroczenie tego pulapu
 * wymaga GainNode z Web Audio API.
 */
const LOUDNESS_BOOST = 2;

export function createHitSound(
  src: string,
  size = 4,
  make: (src: string) => HTMLAudioElement = (s) => new Audio(s),
  getReferenceVolume: () => number = () => 1,
): HitSound {
  const pool: HTMLAudioElement[] = [];
  for (let i = 0; i < size; i++) {
    const el = make(src);
    el.preload = 'auto';
    el.volume = 1;
    pool.push(el);
  }

  let next = 0;
  let gainNode: GainNode | null = null;
  let audioGraphAttempted = false;

  /**
   * Podlacza pule pod Web Audio, zeby GainNode mogl wzmocnic dzwiek ponad 1.0.
   * Wymaga gestu uzytkownika (kontekst startuje `suspended`), wiec wywolywane
   * z `unlock()`. Bez Web Audio (starsze przegladarki, jsdom w testach) pula
   * gra normalnie przez `el.volume`, ograniczone do 1.0.
   */
  function ensureAudioGraph(): void {
    if (audioGraphAttempted) return;
    audioGraphAttempted = true;
    if (typeof AudioContext === 'undefined') return;
    try {
      const context = new AudioContext();
      const gain = context.createGain();
      gain.connect(context.destination);
      for (const el of pool) context.createMediaElementSource(el).connect(gain);
      if (context.state === 'suspended') void context.resume();
      gainNode = gain;
    } catch {
      gainNode = null;
    }
  }

  return {
    unlock(): void {
      ensureAudioGraph();
      for (const el of pool) {
        el.muted = true;
        try {
          // pause()/currentTime dopiero po ustabilizowaniu play() — wywolanie
          // pause() zanim przegladarka zdazyla faktycznie ruszyc odtwarzanie
          // przerywa `play()` bledem, ktory na czesci przegladarek (Safari)
          // liczy sie jako niedokonczone odblokowanie elementu.
          el.play()
            ?.then(() => {
              el.pause();
              el.currentTime = 0;
              el.muted = false;
            })
            .catch(() => {
              el.muted = false;
            });
        } catch {
          // Srodowiska bez pelnej implementacji HTMLMediaElement (np. testy) nie maja play().
          el.muted = false;
        }
      }
    },
    play(): void {
      const el = pool[next]!;
      next = (next + 1) % pool.length;
      el.currentTime = 0;

      const referenceVolume = Math.max(0, getReferenceVolume());
      if (gainNode) {
        gainNode.gain.value = referenceVolume * LOUDNESS_BOOST;
      } else {
        // Bez GainNode nie da sie przekroczyc 1.0 — proporcja wzgledem youtube
        // dziala, ale bez podwojenia glosnosci ponad naturalny poziom pliku.
        el.volume = Math.min(1, referenceVolume);
      }

      try {
        el.play()?.catch((error: unknown) => {
          console.warn('Dzwiek trafienia nie odtworzyl sie.', error);
        });
      } catch (error) {
        console.warn('Dzwiek trafienia nie odtworzyl sie.', error);
      }
    },
  };
}
