import { describe, expect, it } from 'vitest';
import { resultImageAlt, resultImageSrc, resultPercent } from '../src/ui/result-image.js';
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
    expect(file(resultImageSrc(0))).toBe('score0.gif');
    expect(file(resultImageSrc(100))).toBe('score5.gif');
  });

  it('granice kubelkow trafiaja we wlasciwe pliki', () => {
    const buckets: Array<[number, string]> = [
      [1, 'score1.gif'],
      [25, 'score1.gif'],
      [26, 'score2.gif'],
      [50, 'score2.gif'],
      [51, 'score3.gif'],
      [75, 'score3.gif'],
      [76, 'score4.gif'],
      [99, 'score4.gif'],
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
    expect(file(resultImageSrc(-5))).toBe('score0.gif');
    expect(file(resultImageSrc(140))).toBe('score5.gif');
  });
});

describe('resultImageAlt', () => {
  it('kazdy kubelek ma wlasny, niepusty opis', () => {
    const alts = [0, 10, 40, 60, 90, 100].map(resultImageAlt);
    for (const alt of alts) expect(alt.length).toBeGreaterThan(10);
    expect(new Set(alts).size).toBe(6);
  });

  it('granice kubelkow sa te same co w resultImageSrc (alt nie moze rozjechac sie z grafika)', () => {
    // Kazda para (percent, percent+1) na granicy: gdy zmienia sie grafika, musi
    // zmienic sie tez opis — i odwrotnie.
    for (let percent = 0; percent < 100; percent += 1) {
      const srcChanged = resultImageSrc(percent) !== resultImageSrc(percent + 1);
      const altChanged = resultImageAlt(percent) !== resultImageAlt(percent + 1);
      expect(altChanged).toBe(srcChanged);
    }
  });

  it('nazwa utworu pada wylacznie przy komplecie trafien (bez keyword stuffingu)', () => {
    expect(resultImageAlt(100)).toContain('Mood Brazil');
    for (const percent of [0, 1, 25, 26, 50, 51, 75, 76, 99]) {
      expect(resultImageAlt(percent)).not.toContain('Mood Brazil');
    }
  });
});
