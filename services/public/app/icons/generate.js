/**
 * Genererar PWA-ikoner (192x192 och 512x512) som PNG-filer.
 * Kör: node services/public/app/icons/generate.js
 *
 * Skapar enkla ikoner med mörk bakgrund och en grön check-ikon.
 * Använder bara Node.js inbyggda moduler (zlib för PNG-komprimering).
 */

import { writeFileSync } from 'fs';
import { deflateSync } from 'zlib';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function createPng(size) {
  const bg = [30, 41, 59];       // #1e293b
  const green = [5, 150, 105];   // #059669
  const blue = [37, 99, 235];    // #2563eb
  const gray = [51, 65, 85];     // #334155

  // Skapa pixel-data (RGBA)
  const pixels = new Uint8Array(size * size * 4);

  function setPixel(x, y, r, g, b, a = 255) {
    if (x < 0 || x >= size || y < 0 || y >= size) return;
    const i = (y * size + x) * 4;
    // Alpha blending
    const srcA = a / 255;
    const dstA = 1 - srcA;
    pixels[i]     = Math.round(r * srcA + pixels[i] * dstA);
    pixels[i + 1] = Math.round(g * srcA + pixels[i + 1] * dstA);
    pixels[i + 2] = Math.round(b * srcA + pixels[i + 2] * dstA);
    pixels[i + 3] = Math.min(255, pixels[i + 3] + a);
  }

  function fillRect(x1, y1, x2, y2, r, g, b) {
    for (let y = y1; y < y2; y++) {
      for (let x = x1; x < x2; x++) {
        setPixel(x, y, r, g, b);
      }
    }
  }

  function fillCircle(cx, cy, radius, r, g, b) {
    const r2 = radius * radius;
    for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++) {
      for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++) {
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy <= r2) {
          setPixel(x, y, r, g, b);
        }
      }
    }
  }

  function drawLine(x1, y1, x2, y2, width, r, g, b) {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.ceil(len * 2);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const cx = x1 + dx * t;
      const cy = y1 + dy * t;
      fillCircle(cx, cy, width / 2, r, g, b);
    }
  }

  // Fyll bakgrund
  fillRect(0, 0, size, size, ...bg);

  // Rundade hörn (maskera hörnen till transparent)
  const cornerR = Math.round(size * 0.18);
  for (let y = 0; y < cornerR; y++) {
    for (let x = 0; x < cornerR; x++) {
      const dx = cornerR - x, dy = cornerR - y;
      if (dx * dx + dy * dy > cornerR * cornerR) {
        const i = (y * size + x) * 4;
        pixels[i] = pixels[i + 1] = pixels[i + 2] = pixels[i + 3] = 0;
      }
    }
    for (let x = size - cornerR; x < size; x++) {
      const dx = x - (size - cornerR), dy = cornerR - y;
      if (dx * dx + dy * dy > cornerR * cornerR) {
        const i = (y * size + x) * 4;
        pixels[i] = pixels[i + 1] = pixels[i + 2] = pixels[i + 3] = 0;
      }
    }
  }
  for (let y = size - cornerR; y < size; y++) {
    for (let x = 0; x < cornerR; x++) {
      const dx = cornerR - x, dy = y - (size - cornerR);
      if (dx * dx + dy * dy > cornerR * cornerR) {
        const i = (y * size + x) * 4;
        pixels[i] = pixels[i + 1] = pixels[i + 2] = pixels[i + 3] = 0;
      }
    }
    for (let x = size - cornerR; x < size; x++) {
      const dx = x - (size - cornerR), dy = y - (size - cornerR);
      if (dx * dx + dy * dy > cornerR * cornerR) {
        const i = (y * size + x) * 4;
        pixels[i] = pixels[i + 1] = pixels[i + 2] = pixels[i + 3] = 0;
      }
    }
  }

  // Cirkel (kontur)
  const cx = size / 2, cy = size * 0.45;
  const outerR = size * 0.28;
  const ringW = size * 0.02;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx, dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist >= outerR - ringW && dist <= outerR + ringW) {
        setPixel(x, y, ...gray);
      }
    }
  }

  // Check-markering
  const lineW = size * 0.045;
  drawLine(size * 0.35, cy, size * 0.46, size * 0.55, lineW, ...green);
  drawLine(size * 0.46, size * 0.55, size * 0.65, size * 0.35, lineW, ...green);

  // Puls-linje
  const pulseY = size * 0.75;
  const pulseW = size * 0.018;
  drawLine(size * 0.2, pulseY, size * 0.35, pulseY, pulseW, ...blue);
  drawLine(size * 0.35, pulseY, size * 0.4, size * 0.68, pulseW, ...blue);
  drawLine(size * 0.4, size * 0.68, size * 0.45, size * 0.82, pulseW, ...blue);
  drawLine(size * 0.45, size * 0.82, size * 0.5, size * 0.72, pulseW, ...blue);
  drawLine(size * 0.5, size * 0.72, size * 0.55, size * 0.78, pulseW, ...blue);
  drawLine(size * 0.55, size * 0.78, size * 0.6, pulseY, pulseW, ...blue);
  drawLine(size * 0.6, pulseY, size * 0.8, pulseY, pulseW, ...blue);

  // Bygg PNG
  return encodePng(size, size, pixels);
}

function encodePng(width, height, pixels) {
  // PNG-signatur
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // IDAT: filter-bytes + pixel-data
  const rawData = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    rawData[y * (1 + width * 4)] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * 4;
      const dstIdx = y * (1 + width * 4) + 1 + x * 4;
      rawData[dstIdx] = pixels[srcIdx];
      rawData[dstIdx + 1] = pixels[srcIdx + 1];
      rawData[dstIdx + 2] = pixels[srcIdx + 2];
      rawData[dstIdx + 3] = pixels[srcIdx + 3];
    }
  }
  const compressed = deflateSync(rawData, { level: 9 });

  // IEND
  const iend = Buffer.alloc(0);

  // Bygg chunks
  function makeChunk(type, data) {
    const typeBuffer = Buffer.from(type);
    const lengthBuffer = Buffer.alloc(4);
    lengthBuffer.writeUInt32BE(data.length);
    const crcInput = Buffer.concat([typeBuffer, data]);
    const crc = crc32(crcInput);
    const crcBuffer = Buffer.alloc(4);
    crcBuffer.writeUInt32BE(crc >>> 0);
    return Buffer.concat([lengthBuffer, typeBuffer, data, crcBuffer]);
  }

  return Buffer.concat([
    signature,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', iend),
  ]);
}

// CRC32 (PNG-standard)
function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[n] = c;
    }
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// Generera och spara
const icon192 = createPng(192);
const icon512 = createPng(512);

writeFileSync(join(__dirname, 'icon-192.png'), icon192);
writeFileSync(join(__dirname, 'icon-512.png'), icon512);

console.log('Ikoner genererade:');
console.log(`  icon-192.png (${icon192.length} bytes)`);
console.log(`  icon-512.png (${icon512.length} bytes)`);
