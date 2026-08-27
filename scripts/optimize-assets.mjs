// Generator assetow gry: zrodla z `images/` -> PNG-8 (paleta + tRNS) w `public/`,
// w rozdzielczosci dopasowanej do realnego rozmiaru wyswietlania (ADR-0027).
//
// Uruchomienie: node scripts/optimize-assets.mjs   -> public/sprites/*, public/results/*
//
// Wlasny dekoder GIF/PNG i enkoder PNG na `node:zlib` — dokladnie ta sama zasada
// co w scripts/make-icons.mjs: zero zaleznosci npm, nic nie pobierane z internetu.
// Wynik jest commitowany razem ze skryptem, tak jak ikony PWA.
//
// Dlaczego nie GIF: wszystkie assety projektu sa JEDNOKLATKOWE, wiec argument
// „animowany WebP wymagalby narzedzia konwersji" (ADR-0011) nie ma zastosowania.
// PNG-8 z `tRNS` daje przy tym 8-bitowa alfe zamiast 1-bitowej — znika obwodka
// na krawedziach dloni na tle wideo. Grafiki wyniku ida wprost ze zrodlowych
// PNG-ow RGBA, wiec odpada zarowno posredni GIF, jak i krok w `ffmpeg`.

import { deflateSync, inflateSync } from 'node:zlib';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/* --------------------------------- GIF -> RGBA -------------------------------- */

/**
 * Dekoder jednoklatkowego GIF-a: naglowek, tablica kolorow (globalna lub lokalna),
 * indeks przezroczysty z bloku Graphic Control i dane LZW.
 * Rzuca przy pliku wieloklatkowym — zaden asset projektu taki nie jest, a cicha
 * konwersja pierwszej klatki animacji byla by trudna do zauwazenia.
 */
export function decodeGif(buffer) {
  if (buffer.slice(0, 3).toString('ascii') !== 'GIF') throw new Error('to nie jest GIF');

  const width = buffer.readUInt16LE(6);
  const height = buffer.readUInt16LE(8);
  const packed = buffer[10];

  let offset = 13;
  let globalPalette = null;
  if (packed & 0x80) {
    const size = 1 << ((packed & 7) + 1);
    globalPalette = buffer.subarray(offset, offset + size * 3);
    offset += size * 3;
  }

  let transparentIndex = -1;
  const frames = [];

  while (offset < buffer.length) {
    const block = buffer[offset];

    if (block === 0x21) {
      // Blok rozszerzenia; interesuje nas wylacznie Graphic Control (0xF9)
      // z flaga i indeksem koloru przezroczystego.
      const label = buffer[offset + 1];
      offset += 2;
      if (label === 0xf9 && buffer[offset + 1] & 0x01) transparentIndex = buffer[offset + 4];
      while (buffer[offset] !== 0) offset += buffer[offset] + 1;
      offset += 1;
      continue;
    }

    if (block === 0x2c) {
      const left = buffer.readUInt16LE(offset + 1);
      const top = buffer.readUInt16LE(offset + 3);
      const frameWidth = buffer.readUInt16LE(offset + 5);
      const frameHeight = buffer.readUInt16LE(offset + 7);
      const framePacked = buffer[offset + 9];
      offset += 10;

      let palette = globalPalette;
      if (framePacked & 0x80) {
        const size = 1 << ((framePacked & 7) + 1);
        palette = buffer.subarray(offset, offset + size * 3);
        offset += size * 3;
      }
      if (!palette) throw new Error('klatka bez tablicy kolorow');
      if (framePacked & 0x40) throw new Error('GIF z przeplotem nie jest obslugiwany');

      const minCodeSize = buffer[offset];
      offset += 1;
      const chunks = [];
      while (buffer[offset] !== 0) {
        const size = buffer[offset];
        chunks.push(buffer.subarray(offset + 1, offset + 1 + size));
        offset += size + 1;
      }
      offset += 1;

      frames.push({
        left,
        top,
        width: frameWidth,
        height: frameHeight,
        palette,
        indices: inflateLzw(minCodeSize, Buffer.concat(chunks), frameWidth * frameHeight),
      });
      continue;
    }

    break; // 0x3B (trailer) albo smiec — koniec czytania
  }

  if (frames.length === 0) throw new Error('GIF bez klatek');
  if (frames.length > 1) throw new Error(`GIF ma ${frames.length} klatek — skrypt obsluguje tylko statyczne`);

  const frame = frames[0];
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < frame.height; y++) {
    for (let x = 0; x < frame.width; x++) {
      const index = frame.indices[y * frame.width + x];
      const out = ((frame.top + y) * width + (frame.left + x)) * 4;
      if (index === transparentIndex) continue; // alfa 0, kolor bez znaczenia
      rgba[out] = frame.palette[index * 3];
      rgba[out + 1] = frame.palette[index * 3 + 1];
      rgba[out + 2] = frame.palette[index * 3 + 2];
      rgba[out + 3] = 255;
    }
  }

  return { width, height, rgba };
}

/** Dekompresja LZW wg specyfikacji GIF89a (zmienna dlugosc kodu, kod czyszczacy i EOI). */
function inflateLzw(minCodeSize, data, pixelCount) {
  const MAX_CODES = 4096;
  const prefix = new Int32Array(MAX_CODES);
  const suffix = new Int32Array(MAX_CODES);
  const stack = new Uint8Array(MAX_CODES + 1);
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;

  let codeSize = minCodeSize + 1;
  let codeMask = (1 << codeSize) - 1;
  let next = endCode + 1;
  for (let i = 0; i < clearCode; i++) suffix[i] = i;

  const out = new Uint8Array(pixelCount);
  let bits = 0;
  let bitCount = 0;
  let first = 0;
  let top = 0;
  let written = 0;
  let previous = -1;

  for (let i = 0; i < data.length; i++) {
    bits |= data[i] << bitCount;
    bitCount += 8;
    while (bitCount >= codeSize) {
      let code = bits & codeMask;
      bits >>= codeSize;
      bitCount -= codeSize;

      if (code === clearCode) {
        codeSize = minCodeSize + 1;
        codeMask = (1 << codeSize) - 1;
        next = endCode + 1;
        previous = -1;
        continue;
      }
      if (code === endCode) return out;

      if (previous === -1) {
        out[written++] = suffix[code];
        previous = code;
        first = code;
        continue;
      }

      const current = code;
      if (code >= next) {
        stack[top++] = first;
        code = previous;
      }
      while (code >= clearCode) {
        stack[top++] = suffix[code];
        code = prefix[code];
      }
      first = suffix[code] & 0xff;
      out[written++] = first;
      while (top > 0) out[written++] = stack[--top];

      if (next < MAX_CODES) {
        prefix[next] = previous;
        suffix[next] = first;
        next++;
        if ((next & codeMask) === 0 && next < MAX_CODES) {
          codeSize++;
          codeMask += next;
        }
      }
      previous = current;
    }
  }

  return out;
}

/* --------------------------------- PNG -> RGBA -------------------------------- */

/**
 * Dekoder PNG w zakresie, ktorego uzywaja zrodla projektu: 8 bitow na kanal,
 * truecolor z alfa (typ 6) lub bez (typ 2), bez przeplotu. Kazdy inny wariant
 * konczy sie bledem zamiast cicho zlym obrazem.
 */
export function decodePng(buffer) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!signature.every((byte, i) => buffer[i] === byte)) throw new Error('to nie jest PNG');

  let width = 0;
  let height = 0;
  let colorType = -1;
  const data = [];

  for (let offset = 8; offset < buffer.length; ) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const body = buffer.subarray(offset + 8, offset + 8 + length);

    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      if (body[8] !== 8) throw new Error(`PNG o glebi ${body[8]} bitow nie jest obslugiwany`);
      colorType = body[9];
      if (colorType !== 6 && colorType !== 2) throw new Error(`PNG typu ${colorType} nie jest obslugiwany`);
      if (body[12] !== 0) throw new Error('PNG z przeplotem nie jest obslugiwany');
    } else if (type === 'IDAT') {
      data.push(body);
    } else if (type === 'IEND') {
      break;
    }

    offset += 12 + length;
  }

  const channels = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * channels;
  const rgba = Buffer.alloc(width * height * 4);
  const line = Buffer.alloc(stride);
  let previous = Buffer.alloc(stride);

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (1 + stride)];
    raw.copy(line, 0, y * (1 + stride) + 1, (y + 1) * (1 + stride));

    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0;
      const b = previous[i];
      const c = i >= channels ? previous[i - channels] : 0;
      if (filter === 1) line[i] = (line[i] + a) & 0xff;
      else if (filter === 2) line[i] = (line[i] + b) & 0xff;
      else if (filter === 3) line[i] = (line[i] + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) line[i] = (line[i] + paeth(a, b, c)) & 0xff;
      else if (filter !== 0) throw new Error(`nieznany filtr scanline: ${filter}`);
    }

    for (let x = 0; x < width; x++) {
      const from = x * channels;
      const to = (y * width + x) * 4;
      rgba[to] = line[from];
      rgba[to + 1] = line[from + 1];
      rgba[to + 2] = line[from + 2];
      rgba[to + 3] = channels === 4 ? line[from + 3] : 255;
    }

    previous = Buffer.from(line);
  }

  return { width, height, rgba };
}

/** Predyktor Paeth wg specyfikacji PNG — uzywany przy odfiltrowywaniu scanline. */
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** Rozpoznaje format po sygnaturze — zrodla w `images/` to i GIF-y, i PNG-i. */
export function decodeImage(buffer) {
  return buffer.slice(0, 3).toString('ascii') === 'GIF' ? decodeGif(buffer) : decodePng(buffer);
}

/* ------------------------------- skalowanie -------------------------------- */

/**
 * Box filter na PREMULTIPLIKOWANEJ alfie. Bez premultiplikacji piksele w pelni
 * przezroczyste (o dowolnym, czesto czarnym kolorze) wchodza do sredniej i robia
 * ciemna obwodke na krawedziach sprite'a.
 */
export function resizeBox(sourceWidth, sourceHeight, rgba, targetWidth, targetHeight) {
  const out = Buffer.alloc(targetWidth * targetHeight * 4);

  for (let y = 0; y < targetHeight; y++) {
    const y0 = Math.floor((y * sourceHeight) / targetHeight);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * sourceHeight) / targetHeight));

    for (let x = 0; x < targetWidth; x++) {
      const x0 = Math.floor((x * sourceWidth) / targetWidth);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * sourceWidth) / targetWidth));

      let r = 0;
      let g = 0;
      let b = 0;
      let alphaSum = 0;
      let samples = 0;

      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * sourceWidth + sx) * 4;
          const a = rgba[i + 3] / 255;
          r += rgba[i] * a;
          g += rgba[i + 1] * a;
          b += rgba[i + 2] * a;
          alphaSum += a;
          samples++;
        }
      }

      const o = (y * targetWidth + x) * 4;
      if (alphaSum > 0) {
        out[o] = Math.round(r / alphaSum);
        out[o + 1] = Math.round(g / alphaSum);
        out[o + 2] = Math.round(b / alphaSum);
        out[o + 3] = Math.round((255 * alphaSum) / samples);
      }
    }
  }

  return out;
}

/* ------------------------------- kwantyzacja -------------------------------- */

/** Klucz koloru: piksele w pelni przezroczyste sa jednym kolorem, niezaleznie od RGB. */
function colorKey(rgba, i) {
  const a = rgba[i + 3];
  if (a === 0) return 0;
  return ((rgba[i] << 24) | (rgba[i + 1] << 16) | (rgba[i + 2] << 8) | a) >>> 0;
}

/**
 * Median cut w przestrzeni RGBA. Alfa wazona x2 przy wyborze osi podzialu:
 * blad na krawedzi (polprzezroczystosc) widac bardziej niz blad koloru w srodku
 * ksztaltu. Zwraca liste `{ r, g, b, a }` — najwyzej `maxColors` pozycji.
 */
export function quantize(rgba, maxColors) {
  const counts = new Map();
  for (let i = 0; i < rgba.length; i += 4) {
    const key = colorKey(rgba, i);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const toPoint = ([key, count]) =>
    key === 0
      ? { r: 0, g: 0, b: 0, a: 0, count }
      : { r: (key >>> 24) & 255, g: (key >>> 16) & 255, b: (key >>> 8) & 255, a: key & 255, count };

  const points = [...counts].map(toPoint);
  if (points.length <= maxColors) return points.map(({ count, ...color }) => color);

  const axes = ['r', 'g', 'b', 'a'];
  const weight = (axis) => (axis === 'a' ? 2 : 1);
  const spread = (box) => {
    const min = { r: 255, g: 255, b: 255, a: 255 };
    const max = { r: 0, g: 0, b: 0, a: 0 };
    for (const point of box) {
      for (const axis of axes) {
        if (point[axis] < min[axis]) min[axis] = point[axis];
        if (point[axis] > max[axis]) max[axis] = point[axis];
      }
    }
    let best = axes[0];
    for (const axis of axes) {
      if ((max[axis] - min[axis]) * weight(axis) > (max[best] - min[best]) * weight(best)) best = axis;
    }
    return { axis: best, range: (max[best] - min[best]) * weight(best) };
  };

  let boxes = [points];
  while (boxes.length < maxColors) {
    let target = -1;
    let bestScore = 0;
    boxes.forEach((box, index) => {
      if (box.length < 2) return;
      const { range } = spread(box);
      let population = 0;
      for (const point of box) population += point.count;
      // Dzielimy najpierw boks szeroki I liczny — sam zasieg wybiralby garstke
      // odstajacych pikseli, sama licznosc gubilaby akcenty kolorystyczne.
      const score = range * Math.log(population + 1);
      if (score > bestScore) {
        bestScore = score;
        target = index;
      }
    });
    if (target < 0) break;

    const box = boxes[target];
    const { axis } = spread(box);
    box.sort((a, b) => a[axis] - b[axis]);
    let population = 0;
    for (const point of box) population += point.count;
    let accumulated = 0;
    let cut = 1;
    for (let i = 0; i < box.length; i++) {
      accumulated += box[i].count;
      if (accumulated >= population / 2) {
        cut = Math.min(Math.max(i, 1), box.length - 1);
        break;
      }
    }
    boxes.splice(target, 1, box.slice(0, cut), box.slice(cut));
  }

  return boxes
    .filter((box) => box.length > 0)
    .map((box) => {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let population = 0;
      for (const point of box) {
        r += point.r * point.count;
        g += point.g * point.count;
        b += point.b * point.count;
        a += point.a * point.count;
        population += point.count;
      }
      return {
        r: Math.round(r / population),
        g: Math.round(g / population),
        b: Math.round(b / population),
        a: Math.round(a / population),
      };
    });
}

/** Kwadrat odleglosci koloru od wpisu palety; alfa wazona, przezroczystosc traktowana osobno. */
function distance(rgba, i, entry) {
  const a = rgba[i + 3];
  if (a === 0) return entry.a * entry.a * 8; // liczy sie wylacznie to, czy wpis tez jest przezroczysty
  const da = a - entry.a;
  return (
    (rgba[i] - entry.r) ** 2 + (rgba[i + 1] - entry.g) ** 2 + (rgba[i + 2] - entry.b) ** 2 + da * da * 3
  );
}

/**
 * Mapuje obraz na indeksy palety (najblizszy wpis, bez ditheringu — ten psuje
 * kompresje, a przy tak malym bledzie kwantyzacji nic nie wnosi).
 * Zwraca rowniez blad: sredni i maksymalny dystans w przestrzeni RGBA.
 */
export function indexImage(rgba, palette) {
  const pixels = rgba.length / 4;
  const indices = Buffer.alloc(pixels);
  const cache = new Map();
  let errorSum = 0;
  let errorMax = 0;

  for (let i = 0, p = 0; i < rgba.length; i += 4, p++) {
    const key = colorKey(rgba, i);
    let hit = cache.get(key);
    if (hit === undefined) {
      let best = 0;
      let bestDistance = Infinity;
      for (let c = 0; c < palette.length; c++) {
        const d = distance(rgba, i, palette[c]);
        if (d < bestDistance) {
          bestDistance = d;
          best = c;
        }
      }
      hit = { index: best, error: Math.sqrt(bestDistance) };
      cache.set(key, hit);
    }
    indices[p] = hit.index;
    errorSum += hit.error;
    if (hit.error > errorMax) errorMax = hit.error;
  }

  return { indices, meanError: errorSum / pixels, maxError: errorMax };
}

/* ---------------------------------- PNG ------------------------------------ */

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/**
 * PNG w wariancie indeksowanym (colour type 3): PLTE + tRNS z alfa kazdego wpisu.
 * Paleta jest posortowana rosnaco po alfie, wiec tRNS konczy sie na ostatnim
 * wpisie z alfa < 255 — reszta jest domyslnie nieprzezroczysta.
 * Filtr scanline: 0 (None). Przy danych indeksowanych roznicowanie sasiednich
 * bajtow miesza numery kolorow, a nie ich wartosci — deflate radzi sobie lepiej
 * na surowych indeksach.
 */
export function encodeIndexedPng(width, height, indices, palette) {
  if (palette.length > 256) throw new Error('paleta PNG-8 to najwyzej 256 kolorow');

  const raw = Buffer.alloc(height * (1 + width));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width)] = 0;
    // `set`/`subarray`, nie `Buffer.copy` — dziala tak samo dla zwyklego
    // `Uint8Array`, wiec funkcja da sie wolac z testu bez `Buffer`.
    raw.set(indices.subarray(y * width, (y + 1) * width), y * (1 + width) + 1);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 3; // colour type: indexed

  const plte = Buffer.alloc(palette.length * 3);
  palette.forEach((entry, i) => {
    plte[i * 3] = entry.r;
    plte[i * 3 + 1] = entry.g;
    plte[i * 3 + 2] = entry.b;
  });

  let translucent = palette.length;
  while (translucent > 0 && palette[translucent - 1].a === 255) translucent--;
  const trns = Buffer.alloc(translucent);
  for (let i = 0; i < translucent; i++) trns[i] = palette[i].a;

  const parts = [
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('PLTE', plte),
  ];
  if (translucent > 0) parts.push(chunk('tRNS', trns));
  parts.push(chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)));

  return Buffer.concat(parts);
}

/** Cala droga: zrodlo (GIF/PNG) -> (opcjonalne skalowanie) -> paleta -> PNG-8. */
export function convert(source, { width: targetWidth, colors }) {
  const { width, height, rgba } = decodeImage(source);
  const outWidth = targetWidth ?? width;
  const outHeight = Math.max(1, Math.round((height * outWidth) / width));
  const scaled = outWidth === width ? rgba : resizeBox(width, height, rgba, outWidth, outHeight);

  // Kolor w pelni przezroczysty na poczatek palety: tRNS jest wtedy najkrotszy.
  const palette = quantize(scaled, colors).sort((a, b) => a.a - b.a);
  const { indices, meanError, maxError } = indexImage(scaled, palette);

  return {
    png: encodeIndexedPng(outWidth, outHeight, indices, palette),
    width: outWidth,
    height: outHeight,
    colors: palette.length,
    meanError,
    maxError,
  };
}

/* ------------------------------- uruchomienie ------------------------------- */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Zrodlem sa pliki z `images/` (oryginaly), nie to, co lezy juz w `public/` —
 * inaczej kazde uruchomienie kwantyzowaloby wynik poprzedniego.
 *
 * Rozdzielczosci sa dobrane do realnego rozmiaru wyswietlania, nie do zrodla:
 * - dlonie: mediana `size` w beatmapie to 94, czyli ~200 px CSS przy scenie
 *   1280 px — 512 px pokrywa ja z zapasem takze przy DPR 2 (ADR-0027);
 * - bramka startowa: grafika na niemal cala scene, 836 px to polowa zrodla;
 * - ekran wyniku: 512x768, czyli tyle co dotad — pokazywany jest statycznie na
 *   pelna wysokosc sceny, a oszczednosc bierze sie z pobierania jednego pliku
 *   zamiast szesciu (ADR-0027), nie ze zmniejszania.
 */
const TASKS = [
  {
    from: 'images/unicolor-hand-no-sound-no-bg.gif',
    to: 'public/sprites/hand-idle.png',
    width: 512,
    colors: 128,
  },
  {
    from: 'images/unicolor-hand-with-sound-no-bg.gif',
    to: 'public/sprites/hand-hit.png',
    width: 512,
    colors: 128,
  },
  { from: 'images/manual-green.gif', to: 'public/sprites/start-manual.png', width: 836, colors: 128 },
  ...[0, 1, 2, 3, 4, 5].map((i) => ({
    from: `images/score${i}.png`,
    to: `public/results/score${i}.png`,
    width: 512,
    colors: 128,
  })),
];

function main() {
  let before = 0;
  let after = 0;

  for (const task of TASKS) {
    const source = readFileSync(join(root, task.from));
    const result = convert(source, task);
    writeFileSync(join(root, task.to), result.png);
    before += source.length;
    after += result.png.length;

    const kb = (bytes) => `${(bytes / 1024).toFixed(0)} kB`;
    console.log(
      `${relative(root, task.to).padEnd(32)} ${String(result.width).padStart(4)}x${String(result.height).padEnd(4)} ` +
        `${result.colors.toString().padStart(3)} kol.  ${kb(source.length).padStart(7)} -> ${kb(result.png.length).padStart(7)}  ` +
        `blad sr. ${result.meanError.toFixed(2)}, maks. ${result.maxError.toFixed(0)}`,
    );
  }

  console.log(
    `\nRAZEM ${(before / 1024).toFixed(0)} kB -> ${(after / 1024).toFixed(0)} kB ` +
      `(-${Math.round((1 - after / before) * 100)}%)`,
  );
}

// Import w tescie nie moze niczego zapisywac — uruchamiamy wylacznie z CLI.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
