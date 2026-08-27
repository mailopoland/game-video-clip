// Generator favikony z tego samego zrodla co sprite dloni po trafieniu
// (images/unicolor-hand-with-sound-no-bg.gif).
// Uruchomienie: node scripts/make-favicon.mjs  -> public/favicon.png
//
// Dekoder zrodla, skalowanie, paleta i enkoder PNG sa wspolne z generatorem
// assetow (scripts/optimize-assets.mjs, ADR-0027) — wczesniej ten plik mial
// wlasna, rownolegla kopie calego dekodera GIF i enkodera PNG.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { convert } from './optimize-assets.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'images', 'unicolor-hand-with-sound-no-bg.gif');
const OUT = join(root, 'public', 'favicon.png');

// 64 px: favikona jest skalowana w dol przez przegladarke, wiekszy plik nic nie
// wnosi. 64 kolory wystarcza — grafika jest jednokolorowa z cieniem.
const { png, colors } = convert(readFileSync(SRC), { width: 64, colors: 64 });

writeFileSync(OUT, png);
console.log(`zapisano ${OUT} (${(png.length / 1024).toFixed(1)} kB, ${colors} kolorow)`);
