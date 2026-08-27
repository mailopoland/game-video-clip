import { RESULT_IMAGES } from '../sprites.js';

/**
 * Procent ekranu wyniku (ADR-0025) — liczony z CALEJ beatmapy (`hits / total`),
 * nie z celow ocenionych. `Stats.accuracy` pomija obiekty `skipped`, wiec po
 * przewinieciu w przod pokazywaloby 100% przy jednym trafieniu; tutaj mianownik
 * jest staly, wiec wynik zawsze znaczy to samo.
 *
 * 0% i 100% sa zarezerwowane dla wynikow skrajnych: 1/1000 daje 1 (nie 0),
 * a 999/1000 daje 99 (nie 100) — inaczej grafika `score5` („Perfect") wypadalaby
 * przy niepelnym komplecie.
 */
export function resultPercent(hits: number, total: number): number {
  if (total <= 0) return 0;
  if (hits <= 0) return 0;
  if (hits >= total) return 100;
  return Math.min(99, Math.max(1, Math.round((hits / total) * 100)));
}

/**
 * Kubelek procentowy -> grafika. Wynik MUSI pochodzic z `resultPercent`,
 * inaczej wyswietlona liczba i obrazek moglyby sie rozjechac na granicy
 * zaokraglenia.
 */
export function resultImageSrc(percent: number): string {
  if (percent <= 0) return RESULT_IMAGES[0]!;
  if (percent >= 100) return RESULT_IMAGES[5]!;
  if (percent <= 25) return RESULT_IMAGES[1]!;
  if (percent <= 50) return RESULT_IMAGES[2]!;
  if (percent <= 75) return RESULT_IMAGES[3]!;
  return RESULT_IMAGES[4]!;
}

/**
 * Czy warto sciagnac juz grafike ekranu wyniku (ADR-0027). Do wersji z ADR-0025
 * pobieranych bylo wszystkie szesc plikow naraz w `onStart` (~0,5 MB), mimo ze
 * pokazywany jest dokladnie jeden. Pod koniec klipu wynik jest praktycznie
 * ustalony, wiec kubelek policzony `leadSec` przed ekranem wyniku prawie zawsze
 * jest tym ostatecznym — a jesli gracz jeszcze trafi i przeskoczy prog, drugie
 * pobranie kosztuje jeden plik, nie szesc.
 */
export function shouldPrefetchResult(
  timeSec: number,
  endScreenAtSec: number,
  leadSec: number,
): boolean {
  return timeSec >= endScreenAtSec - leadSec;
}
