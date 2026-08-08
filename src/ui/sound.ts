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

export function createHitSound(
  src: string,
  size = 4,
  make: (src: string) => HTMLAudioElement = (s) => new Audio(s),
): HitSound {
  const pool: HTMLAudioElement[] = [];
  for (let i = 0; i < size; i++) {
    const el = make(src);
    el.preload = 'auto';
    pool.push(el);
  }

  let next = 0;

  return {
    unlock(): void {
      for (const el of pool) {
        el.muted = true;
        try {
          el.play()?.catch(() => {});
        } catch {
          // Srodowiska bez pelnej implementacji HTMLMediaElement (np. testy) nie maja play().
        }
        el.pause();
        el.currentTime = 0;
        el.muted = false;
      }
    },
    play(): void {
      const el = pool[next]!;
      next = (next + 1) % pool.length;
      el.currentTime = 0;
      try {
        el.play()?.catch(() => {});
      } catch {
        // j.w. — brak dzwieku nie moze wywrocic rozgrywki.
      }
    },
  };
}
