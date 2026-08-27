// Generator obrazka podgladu linku (Open Graph / Twitter card, ADR-0027):
// sprite reki po trafieniu na tle sceny, 1200x630 — rozmiar, ktory Facebook,
// LinkedIn i X pokazuja jako duza karte. Proceduralnie, z assetow ktore juz sa
// w repo: zero zaleznosci i zero pobierania z internetu (ADR-0005).
// Skrypt jest jednorazowy — public/og-image.png jest w repo; uruchamiaj go
// ponownie tylko po zmianie hand-hit.gif albo rozmiaru karty.
// Uruchomienie: node scripts/make-og-image.mjs  -> public/og-image.png

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeGif, downscale, encodePngRgba, toRgba } from './lib/gif-png.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'public', 'sprites', 'hand-hit.gif');
const OUT = join(root, 'public', 'og-image.png');

const WIDTH = 1200;
const HEIGHT = 630;
const BG = [0x10, 0x10, 0x14]; // --background sceny (styles.css)
/** Ile karty zajmuje dlon — mniejszy z obu wspolczynnikow rzadzi, wiec proporcje
    sprite'a zostaja zachowane, a reszta to oddech wokol niego. */
const HAND_HEIGHT_RATIO = 0.78;
const HAND_WIDTH_RATIO = 0.62;

/**
 * Przyciecie do zawartosci: hand-hit.gif ma szeroki przezroczysty margines, wiec
 * bez tego dlon ladowalaby na karcie mala i przesunieta wzgledem srodka.
 */
function cropToContent(image) {
  const { width, height, rgba } = image;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (rgba[(y * width + x) * 4 + 3] === 0) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return image; // caly obrazek przezroczysty — nic do przyciecia
  const cropWidth = maxX - minX + 1;
  const cropHeight = maxY - minY + 1;
  const out = new Uint8ClampedArray(cropWidth * cropHeight * 4);
  for (let y = 0; y < cropHeight; y++) {
    const from = ((y + minY) * width + minX) * 4;
    out.set(rgba.subarray(from, from + cropWidth * 4), y * cropWidth * 4);
  }
  return { width: cropWidth, height: cropHeight, rgba: out };
}

const hand = cropToContent(toRgba(decodeGif(readFileSync(SRC))));
const scale = Math.min(
  (HEIGHT * HAND_HEIGHT_RATIO) / hand.height,
  (WIDTH * HAND_WIDTH_RATIO) / hand.width,
);
const handHeight = Math.max(1, Math.round(hand.height * scale));
const handWidth = Math.max(1, Math.round(hand.width * scale));
const scaled = downscale(hand, handWidth, handHeight);

const offsetX = Math.round((WIDTH - handWidth) / 2);
const offsetY = Math.round((HEIGHT - handHeight) / 2);

// Tlo jest nieprzezroczyste, wiec dlon wchodzi zwyklym alpha-blendem — podglady
// w social mediach i tak nie honoruja przezroczystosci.
const out = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
for (let i = 0; i < WIDTH * HEIGHT; i++) {
  const o = i * 4;
  out[o] = BG[0];
  out[o + 1] = BG[1];
  out[o + 2] = BG[2];
  out[o + 3] = 255;
}
for (let y = 0; y < handHeight; y++) {
  for (let x = 0; x < handWidth; x++) {
    const src = (y * handWidth + x) * 4;
    const alpha = scaled[src + 3] / 255;
    if (alpha === 0) continue;
    const dst = ((y + offsetY) * WIDTH + (x + offsetX)) * 4;
    for (let c = 0; c < 3; c++) {
      out[dst + c] = scaled[src + c] * alpha + out[dst + c] * (1 - alpha);
    }
  }
}

writeFileSync(OUT, encodePngRgba(WIDTH, HEIGHT, out));
console.log(`zapisano ${OUT} (${WIDTH}x${HEIGHT})`);
