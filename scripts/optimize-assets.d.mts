/** Deklaracje typow generatora assetow (ADR-0027). Sam generator jest czystym
    JS-em — projekt celowo nie ma `@types/node`, a skrypty buildowe (jak
    `make-icons.mjs`) nie przechodza przez `tsc`. Ten plik istnieje wylacznie po
    to, zeby test `tests/optimize-assets.test.ts` mial typy funkcji, ktore wola;
    `Uint8Array` zamiast `Buffer` z tego samego powodu. */

export interface PaletteEntry {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface DecodedImage {
  width: number;
  height: number;
  rgba: Uint8Array;
}

export function decodeGif(buffer: Uint8Array): DecodedImage;
export function decodePng(buffer: Uint8Array): DecodedImage;
export function decodeImage(buffer: Uint8Array): DecodedImage;

export function resizeBox(
  sourceWidth: number,
  sourceHeight: number,
  rgba: Uint8Array,
  targetWidth: number,
  targetHeight: number,
): Uint8Array;

export function quantize(rgba: Uint8Array, maxColors: number): PaletteEntry[];

export function indexImage(
  rgba: Uint8Array,
  palette: PaletteEntry[],
): { indices: Uint8Array; meanError: number; maxError: number };

export function encodeIndexedPng(
  width: number,
  height: number,
  indices: Uint8Array,
  palette: PaletteEntry[],
): Uint8Array;

export function convert(
  source: Uint8Array,
  options: { width?: number; colors: number },
): {
  png: Uint8Array;
  width: number;
  height: number;
  colors: number;
  meanError: number;
  maxError: number;
};
