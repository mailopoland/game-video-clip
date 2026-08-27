// Wspolne kawalki generatorow grafik: dekoder GIF (LZW, pierwsza klatka) i enkoder
// PNG na node:zlib. Wyciagniete z make-favicon.mjs, gdy make-og-image.mjs potrzebowal
// tego samego — kopiowanie ~200 linii dekodera byloby gorsze niz jeden modul.
// Zero zaleznosci i zero pobierania z internetu, tak jak dotad (ADR-0005).

import { deflateSync } from 'node:zlib';

// --- minimalny dekoder GIF: pierwsza klatka, LZW, opcjonalna przezroczystosc ---

export function decodeGif(buf) {
  let p = 6; // pomijamy "GIF87a"/"GIF89a"
  const width = buf.readUInt16LE(p);
  const height = buf.readUInt16LE(p + 2);
  const packed = buf[p + 4];
  p += 7;
  const hasGct = (packed & 0x80) !== 0;
  const gctSize = hasGct ? 2 << (packed & 0x07) : 0;
  let globalPalette = null;
  if (hasGct) {
    globalPalette = readPalette(buf, p, gctSize);
    p += gctSize * 3;
  }

  let transparentIndex = -1;

  while (p < buf.length) {
    const marker = buf[p++];
    if (marker === 0x21) {
      // Extension
      const label = buf[p++];
      if (label === 0xf9) {
        const blockSize = buf[p++];
        const flags = buf[p];
        if (flags & 0x01) transparentIndex = buf[p + 3];
        p += blockSize;
        p++; // block terminator
      } else {
        p = skipSubBlocks(buf, p);
      }
    } else if (marker === 0x2c) {
      // Image descriptor
      const imgLeft = buf.readUInt16LE(p);
      const imgTop = buf.readUInt16LE(p + 2);
      const imgWidth = buf.readUInt16LE(p + 4);
      const imgHeight = buf.readUInt16LE(p + 6);
      const imgPacked = buf[p + 8];
      p += 9;
      const hasLct = (imgPacked & 0x80) !== 0;
      const interlaced = (imgPacked & 0x40) !== 0;
      const lctSize = hasLct ? 2 << (imgPacked & 0x07) : 0;
      let palette = globalPalette;
      if (hasLct) {
        palette = readPalette(buf, p, lctSize);
        p += lctSize * 3;
      }
      const minCodeSize = buf[p++];
      const { data: compressed, next } = collectSubBlocks(buf, p);
      p = next;
      const indices = lzwDecode(compressed, minCodeSize, imgWidth * imgHeight);
      const ordered = interlaced
        ? deinterlace(indices, imgWidth, imgHeight)
        : indices;
      return {
        width,
        height,
        imgLeft,
        imgTop,
        imgWidth,
        imgHeight,
        palette,
        transparentIndex,
        indices: ordered,
      };
    } else if (marker === 0x3b) {
      break; // trailer
    } else {
      break;
    }
  }
  throw new Error('nie znaleziono klatki obrazu w GIF');
}

function readPalette(buf, offset, count) {
  const palette = new Array(count);
  for (let i = 0; i < count; i++) {
    const o = offset + i * 3;
    palette[i] = [buf[o], buf[o + 1], buf[o + 2]];
  }
  return palette;
}

function skipSubBlocks(buf, p) {
  while (buf[p] !== 0) p += buf[p] + 1;
  return p + 1;
}

function collectSubBlocks(buf, p) {
  const chunks = [];
  let size = buf[p++];
  while (size !== 0) {
    chunks.push(buf.subarray(p, p + size));
    p += size;
    size = buf[p++];
  }
  return { data: Buffer.concat(chunks), next: p };
}

function deinterlace(src, width, height) {
  const out = new Uint8Array(width * height);
  const passes = [
    [0, 8],
    [4, 8],
    [2, 4],
    [1, 2],
  ];
  let row = 0;
  for (const [start, step] of passes) {
    for (let y = start; y < height; y += step) {
      out.set(src.subarray(row * width, (row + 1) * width), y * width);
      row++;
    }
  }
  return out;
}

function lzwDecode(data, minCodeSize, pixelCount) {
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let dict = [];
  const resetDict = () => {
    dict = [];
    for (let i = 0; i < clearCode; i++) dict[i] = [i];
    dict[clearCode] = [];
    dict[endCode] = null;
    codeSize = minCodeSize + 1;
  };
  resetDict();

  const out = new Uint8Array(pixelCount);
  let outPos = 0;
  let bitBuf = 0;
  let bitCount = 0;
  let bytePos = 0;
  let prev = null;

  const readCode = () => {
    while (bitCount < codeSize) {
      bitBuf |= data[bytePos++] << bitCount;
      bitCount += 8;
    }
    const code = bitBuf & ((1 << codeSize) - 1);
    bitBuf >>= codeSize;
    bitCount -= codeSize;
    return code;
  };

  while (bytePos < data.length && outPos < pixelCount) {
    const code = readCode();
    if (code === clearCode) {
      resetDict();
      prev = null;
      continue;
    }
    if (code === endCode) break;

    let entry;
    if (code < dict.length && dict[code]) {
      entry = dict[code];
    } else if (code === dict.length && prev) {
      entry = prev.concat([prev[0]]);
    } else {
      throw new Error('nieprawidlowy kod LZW');
    }

    for (const b of entry) {
      if (outPos < pixelCount) out[outPos++] = b;
    }

    if (prev) {
      dict.push(prev.concat([entry[0]]));
      if (dict.length === 1 << codeSize && codeSize < 12) codeSize++;
    }
    prev = entry;
  }
  return out;
}

// --- downscale (box filter, alpha-aware) + enkoder PNG RGBA ---

export function toRgba(frame) {
  const { imgWidth, imgHeight, palette, transparentIndex, indices } = frame;
  const rgba = new Uint8ClampedArray(imgWidth * imgHeight * 4);
  for (let i = 0; i < indices.length; i++) {
    const idx = indices[i];
    const o = i * 4;
    if (idx === transparentIndex || !palette[idx]) {
      rgba[o + 3] = 0;
      continue;
    }
    const [r, g, b] = palette[idx];
    rgba[o] = r;
    rgba[o + 1] = g;
    rgba[o + 2] = b;
    rgba[o + 3] = 255;
  }
  return { width: imgWidth, height: imgHeight, rgba };
}

export function downscale(src, targetWidth, targetHeight = targetWidth) {
  const { width, height, rgba } = src;
  const out = new Uint8ClampedArray(targetWidth * targetHeight * 4);
  const sx = width / targetWidth;
  const sy = height / targetHeight;
  for (let ty = 0; ty < targetHeight; ty++) {
    const y0 = Math.floor(ty * sy);
    const y1 = Math.max(y0 + 1, Math.floor((ty + 1) * sy));
    for (let tx = 0; tx < targetWidth; tx++) {
      const x0 = Math.floor(tx * sx);
      const x1 = Math.max(x0 + 1, Math.floor((tx + 1) * sx));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let count = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const o = (y * width + x) * 4;
          const alpha = rgba[o + 3];
          r += rgba[o] * alpha;
          g += rgba[o + 1] * alpha;
          b += rgba[o + 2] * alpha;
          a += alpha;
          count++;
        }
      }
      const oo = (ty * targetWidth + tx) * 4;
      if (a > 0) {
        out[oo] = r / a;
        out[oo + 1] = g / a;
        out[oo + 2] = b / a;
      }
      out[oo + 3] = a / count;
    }
  }
  return out;
}

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

export function encodePngRgba(width, height, rgba) {
  const raw = Buffer.alloc(height * (1 + width * 4));
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0; // filtr: brak
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      raw[o++] = rgba[i];
      raw[o++] = rgba[i + 1];
      raw[o++] = rgba[i + 2];
      raw[o++] = rgba[i + 3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: truecolor + alfa
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
