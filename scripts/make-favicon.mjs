// Generator favikony z istniejacego sprite'a reki (public/sprites/hand-hit.gif) —
// wlasny dekoder GIF (LZW) + enkoder PNG na node:zlib, bez nowych zaleznosci i bez
// pobierania czegokolwiek z internetu (zasada "assety: nie pobieramy").
// Dekoder i enkoder siedza w scripts/lib/gif-png.mjs — dzieli je z make-og-image.mjs.
// Uruchomienie: node scripts/make-favicon.mjs  -> public/favicon.png

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeGif, downscale, encodePngRgba, toRgba } from './lib/gif-png.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'public', 'sprites', 'hand-hit.gif');
const OUT = join(root, 'public', 'favicon.png');
const SIZE = 64; // rozmiar favikony w px

const frame = decodeGif(readFileSync(SRC));
const scaled = downscale(toRgba(frame), SIZE);
writeFileSync(OUT, encodePngRgba(SIZE, SIZE, scaled));
console.log(`zapisano ${OUT}`);
