// Generator ikon PWA — proceduralny, bez zaleznosci i bez pobierania czegokolwiek
// z internetu (ADR-0005: placeholdery proceduralne; zasada "assety: nie pobieramy").
// Uruchomienie: node scripts/make-icons.mjs  -> public/icons/*.png
//
// Wlasny enkoder PNG na `node:zlib` — jedyne, czego potrzeba, to nieskompresowany
// RGB w formacie scanline z filtrem 0. Zaden pakiet graficzny nie jest instalowany.

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BG = [0x10, 0x10, 0x14]; // --background sceny (styles.css)
const FG = [0x6e, 0xf5, 0x8f]; // akcent gry (styles.css)

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, pixelAt) {
  // Scanline: 1 bajt filtra (0 = None) + size * 3 bajty RGB.
  const raw = Buffer.alloc(size * (1 + size * 3));
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixelAt(x, y);
      raw[o++] = r;
      raw[o++] = g;
      raw[o++] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Cel: dwa pierscienie + wypelniony srodek. Cala grafika miesci sie w 40% promienia
// od srodka, wiec przetrwa przyciecie maski Androida ("maskable", bezpieczna
// strefa to okrag o promieniu 40% krawedzi) i zaokraglenie rogow na iOS.
function target(size) {
  const c = (size - 1) / 2;
  const unit = size / 100; // 1 = 1% krawedzi
  // [wewnetrzny promien, zewnetrzny promien] kazdego pierscienia, w procentach.
  const bands = [
    [0, 8],
    [15, 21],
    [28, 34],
  ];
  return (x, y) => {
    const d = Math.hypot(x - c, y - c) / unit;
    // Antyaliasing: udzial akcentu liczony z odleglosci do krawedzi pasma,
    // wygladzony na szerokosci jednego piksela.
    let a = 0;
    for (const [inner, outer] of bands) {
      const edge = Math.min(d - inner, outer - d) * unit;
      a = Math.max(a, Math.min(1, Math.max(0, edge + 0.5)));
    }
    return FG.map((f, i) => Math.round(BG[i] + (f - BG[i]) * a));
  };
}

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(outDir, { recursive: true });

// 180 — apple-touch-icon (iOS nie skaluje w dol ladnie, chce dokladny rozmiar).
// 192/512 — kanoniczne rozmiary manifestu.
for (const size of [180, 192, 512]) {
  const file = join(outDir, `icon-${size}.png`);
  writeFileSync(file, png(size, target(size)));
  console.log(`zapisano ${file}`);
}
