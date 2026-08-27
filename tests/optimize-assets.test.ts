import { describe, expect, it } from 'vitest';
import { inflateSync } from 'node:zlib';

import { encodeIndexedPng, indexImage, quantize, resizeBox } from '../scripts/optimize-assets.mjs';

/** Obraz RGBA z listy pikseli `[r, g, b, a]`. Bez `Buffer` — projekt nie ma
    `@types/node`, a `Uint8Array` wystarcza (deklaracje w tests/node-shims.d.ts). */
function image(pixels: number[][]): Uint8Array {
  return Uint8Array.from(pixels.flat());
}

/** Liczba 32-bitowa big-endian — zamiast `Buffer.readUInt32BE`. */
function readU32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0
  );
}

/** Cztery bajty typu chunka jako tekst — zamiast `Buffer.toString('ascii')`. */
function chunkType(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + 4));
}

describe('resizeBox', () => {
  it('usrednia blok pikseli', () => {
    const source = image([
      [0, 0, 0, 255],
      [100, 100, 100, 255],
      [200, 200, 200, 255],
      [0, 0, 0, 255],
    ]);

    const out = resizeBox(2, 2, source, 1, 1);

    expect([...out]).toEqual([75, 75, 75, 255]);
  });

  it('nie wciaga koloru pikseli w pelni przezroczystych (premultiplikacja)', () => {
    // Czarny piksel z alfa 0 obok bialego nieprzezroczystego. Bez premultiplikacji
    // srednia byla by szara — czyli sprite dostawalby ciemna obwodke.
    const source = image([
      [255, 255, 255, 255],
      [0, 0, 0, 0],
    ]);

    const out = resizeBox(2, 1, source, 1, 1);

    expect([out[0], out[1], out[2]]).toEqual([255, 255, 255]);
    expect(out[3]).toBe(128); // polowa powierzchni jest przezroczysta
  });
});

describe('quantize', () => {
  it('zwraca wszystkie kolory, gdy miesci sie w limicie', () => {
    const source = image([
      [10, 20, 30, 255],
      [40, 50, 60, 255],
    ]);

    expect(quantize(source, 256)).toHaveLength(2);
  });

  it('nie przekracza zadanej liczby kolorow', () => {
    const pixels = Array.from({ length: 400 }, (_, i) => [i % 256, (i * 7) % 256, (i * 13) % 256, 255]);

    expect(quantize(image(pixels), 16).length).toBeLessThanOrEqual(16);
  });

  it('trzyma w palecie kolor w pelni przezroczysty', () => {
    const pixels = Array.from({ length: 200 }, (_, i) =>
      i === 0 ? [0, 0, 0, 0] : [i % 256, 200, 100, 255],
    );

    const palette = quantize(image(pixels), 8);

    expect(palette.some((entry: { a: number }) => entry.a === 0)).toBe(true);
  });
});

describe('indexImage', () => {
  it('mapuje piksele na najblizszy wpis palety i raportuje blad', () => {
    const source = image([
      [0, 0, 0, 255],
      [255, 255, 255, 255],
    ]);
    const palette = [
      { r: 0, g: 0, b: 0, a: 255 },
      { r: 255, g: 255, b: 255, a: 255 },
    ];

    const { indices, meanError, maxError } = indexImage(source, palette);

    expect([...indices]).toEqual([0, 1]);
    expect(meanError).toBe(0);
    expect(maxError).toBe(0);
  });
});

describe('encodeIndexedPng', () => {
  const palette = [
    { r: 0, g: 0, b: 0, a: 0 },
    { r: 12, g: 34, b: 56, a: 128 },
    { r: 255, g: 255, b: 255, a: 255 },
  ];
  const indices = Uint8Array.from([0, 1, 2, 1]);

  /** Rozklada PNG na mape `typ -> dane` — bez zaleznosci, sam format. */
  function chunks(png: Uint8Array): Map<string, Uint8Array> {
    const found = new Map<string, Uint8Array>();
    for (let offset = 8; offset < png.length; ) {
      const length = readU32(png, offset);
      const type = chunkType(png, offset + 4);
      found.set(type, png.subarray(offset + 8, offset + 8 + length));
      offset += 12 + length;
      if (type === 'IEND') break;
    }
    return found;
  }

  it('zapisuje naglowek obrazu indeksowanego 8-bitowego', () => {
    const png = encodeIndexedPng(2, 2, indices, palette);

    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const ihdr = chunks(png).get('IHDR')!;
    expect(readU32(ihdr, 0)).toBe(2);
    expect(readU32(ihdr, 4)).toBe(2);
    expect(ihdr[8]).toBe(8); // glebia
    expect(ihdr[9]).toBe(3); // typ: paleta
  });

  it('zapisuje palete i tRNS przycieta do ostatniego wpisu z alfa < 255', () => {
    const found = chunks(encodeIndexedPng(2, 2, indices, palette));

    expect([...found.get('PLTE')!]).toEqual([0, 0, 0, 12, 34, 56, 255, 255, 255]);
    // Trzeci wpis jest nieprzezroczysty, wiec tRNS konczy sie na drugim.
    expect([...found.get('tRNS')!]).toEqual([0, 128]);
  });

  it('IDAT rozpakowuje sie do scanline z filtrem 0 i tych samych indeksow', () => {
    const raw = inflateSync(chunks(encodeIndexedPng(2, 2, indices, palette)).get('IDAT')!);

    expect([...raw]).toEqual([0, 0, 1, 0, 2, 1]);
  });

  it('odrzuca palete wieksza niz 256 kolorow', () => {
    const tooMany = Array.from({ length: 257 }, () => ({ r: 0, g: 0, b: 0, a: 255 }));

    expect(() => encodeIndexedPng(1, 1, Uint8Array.from([0]), tooMany)).toThrow(/256/);
  });
});
