import { describe, expect, it } from 'vitest';
import { resultImageSrc, resultPercent, shouldPrefetchResult } from '../src/ui/result-image.js';
import { RESULT_IMAGES } from '../src/sprites.js';

/** Nazwa pliku bez sciezki — testy nie zaleza od BASE_URL. */
const file = (src: string): string => src.slice(src.lastIndexOf('/') + 1);

describe('resultPercent', () => {
  it('pusta beatmapa daje 0, bez dzielenia przez zero', () => {
    expect(resultPercent(0, 0)).toBe(0);
    expect(resultPercent(3, 0)).toBe(0);
  });

  it('brak trafien daje 0', () => {
    expect(resultPercent(0, 10)).toBe(0);
  });

  it('komplet trafien daje 100', () => {
    expect(resultPercent(10, 10)).toBe(100);
  });

  it('pojedyncze trafienie nie zaokragla sie do 0', () => {
    expect(resultPercent(1, 1000)).toBe(1);
  });

  it('niepelny komplet nie zaokragla sie do 100', () => {
    expect(resultPercent(999, 1000)).toBe(99);
  });

  it('zwykle wyniki zaokragla do najblizszej calosci', () => {
    expect(resultPercent(1, 8)).toBe(13);
    expect(resultPercent(5, 10)).toBe(50);
  });

  it('mianownikiem sa WSZYSTKIE cele, nie tylko ocenione (ADR-0025)', () => {
    // 1 trafienie w 73-elementowej beatmapie to 1%, nawet gdy reszta zostala
    // przewinieta (dla `accuracy` bylby to komplet).
    expect(resultPercent(1, 73)).toBe(1);
  });
});

describe('resultImageSrc', () => {
  it('0% i 100% maja wlasne, zarezerwowane grafiki', () => {
    expect(file(resultImageSrc(0))).toBe('score0.png');
    expect(file(resultImageSrc(100))).toBe('score5.png');
  });

  it('granice kubelkow trafiaja we wlasciwe pliki', () => {
    const buckets: Array<[number, string]> = [
      [1, 'score1.png'],
      [25, 'score1.png'],
      [26, 'score2.png'],
      [50, 'score2.png'],
      [51, 'score3.png'],
      [75, 'score3.png'],
      [76, 'score4.png'],
      [99, 'score4.png'],
    ];
    for (const [percent, expected] of buckets) {
      expect(file(resultImageSrc(percent))).toBe(expected);
    }
  });

  it('kazdy plik rejestru jest osiagalny', () => {
    const reachable = new Set(
      Array.from({ length: 101 }, (_, percent) => resultImageSrc(percent)),
    );
    expect(reachable.size).toBe(RESULT_IMAGES.length);
    for (const src of RESULT_IMAGES) expect(reachable.has(src)).toBe(true);
  });

  it('procent poza zakresem nie wychodzi poza rejestr', () => {
    expect(file(resultImageSrc(-5))).toBe('score0.png');
    expect(file(resultImageSrc(140))).toBe('score5.png');
  });
});

describe('shouldPrefetchResult', () => {
  it('milczy przez wiekszosc klipu', () => {
    expect(shouldPrefetchResult(0, 150, 15)).toBe(false);
    expect(shouldPrefetchResult(134.99, 150, 15)).toBe(false);
  });

  it('wlacza sie dokladnie na progu `endScreenAtSec - leadSec`', () => {
    expect(shouldPrefetchResult(135, 150, 15)).toBe(true);
  });

  it('zostaje wlaczone po progu, takze po ekranie wyniku', () => {
    expect(shouldPrefetchResult(149, 150, 15)).toBe(true);
    expect(shouldPrefetchResult(200, 150, 15)).toBe(true);
  });

  it('dla krotkiej beatmapy prog wypada przed zerem, wiec pobiera od razu', () => {
    expect(shouldPrefetchResult(0, 10, 15)).toBe(true);
  });
});
