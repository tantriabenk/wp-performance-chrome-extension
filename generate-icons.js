#!/usr/bin/env node
// Run: node generate-icons.js
// Generates PNG icons using pure Node.js (no canvas dependency)

const fs = require('fs');
const path = require('path');

// Minimal PNG encoder (no dependencies)
function createPNG(size, drawFn) {
  const width = size;
  const height = size;

  // RGBA pixel array
  const pixels = new Uint8Array(width * height * 4);

  const setPixel = (x, y, r, g, b, a = 255) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = (y * width + x) * 4;
    pixels[i] = r; pixels[i+1] = g; pixels[i+2] = b; pixels[i+3] = a;
  };

  const fillRect = (x1, y1, x2, y2, r, g, b, a = 255) => {
    for (let y = y1; y < y2; y++)
      for (let x = x1; x < x2; x++)
        setPixel(x, y, r, g, b, a);
  };

  const fillCircle = (cx, cy, radius, r, g, b, a = 255) => {
    for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++) {
      for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++) {
        const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
        if (dist <= radius) setPixel(x, y, r, g, b, a);
      }
    }
  };

  drawFn(setPixel, fillRect, fillCircle, width, height);

  return encodePNG(pixels, width, height);
}

function encodePNG(pixels, width, height) {
  // Build raw scanlines
  const scanlines = [];
  for (let y = 0; y < height; y++) {
    const line = Buffer.alloc(width * 4 + 1);
    line[0] = 0; // filter type: None
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 4;
      line[1 + x * 4] = pixels[src];
      line[2 + x * 4] = pixels[src + 1];
      line[3 + x * 4] = pixels[src + 2];
      line[4 + x * 4] = pixels[src + 3];
    }
    scanlines.push(line);
  }
  const raw = Buffer.concat(scanlines);
  const compressed = zlib_deflate(raw);

  const chunks = [];

  // PNG signature
  chunks.push(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  chunks.push(makeChunk('IHDR', ihdr));

  // IDAT
  chunks.push(makeChunk('IDAT', compressed));

  // IEND
  chunks.push(makeChunk('IEND', Buffer.alloc(0)));

  return Buffer.concat(chunks);
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeB = Buffer.from(type, 'ascii');
  const crcData = Buffer.concat([typeB, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcData), 0);
  return Buffer.concat([len, typeB, data, crc]);
}

function zlib_deflate(data) {
  // Use Node's built-in zlib
  return require('zlib').deflateSync(data);
}

// CRC32 table
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ── Draw the icon ─────────────────────────────────────────
function drawIcon(setPixel, fillRect, fillCircle, w, h) {
  // Background: dark rounded rect (simulate with circle corners)
  const bg = [15, 17, 23]; // #0f1117

  // Fill entire image transparent first
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      setPixel(x, y, 0, 0, 0, 0);

  const r = Math.round(w * 0.2); // corner radius
  // Fill background with rounded corners
  fillRect(r, 0, w - r, h, ...bg);
  fillRect(0, r, w, h - r, ...bg);
  fillCircle(r, r, r, ...bg);
  fillCircle(w - r, r, r, ...bg);
  fillCircle(r, h - r, r, ...bg);
  fillCircle(w - r, h - r, r, ...bg);

  // ⚡ Lightning bolt — accent blue #4f8ef7 → [79, 142, 247]
  const ac = [79, 142, 247];
  const cx = w / 2;
  const cy = h / 2;
  const sc = w / 16;

  // Bolt shape: upper triangle + lower triangle
  // Upper part: top-right to middle-left
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = (x - cx) / sc;
      const ny = (y - cy) / sc;

      // Simple lightning bolt polygon approximation
      if (
        (nx >= -1 && nx <= 2 && ny >= -5 && ny <= 0 && nx >= (ny + 5) * 0.3 - 1) ||
        (nx >= -2 && nx <= 1 && ny >= 0 && ny <= 5 && nx <= (5 - ny) * 0.3 + 1)
      ) {
        setPixel(x, y, ...ac);
      }
    }
  }

  // Small dot bottom-right: performance indicator (green)
  if (w >= 32) {
    fillCircle(w - Math.round(w * 0.22), h - Math.round(h * 0.22), Math.round(w * 0.12), 34, 197, 94);
  }
}

// ── Generate ──────────────────────────────────────────────
const sizes = [16, 32, 48, 128];
const iconsDir = path.join(__dirname, 'icons');
if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir);

for (const size of sizes) {
  const png = createPNG(size, drawIcon);
  const outPath = path.join(iconsDir, `icon${size}.png`);
  fs.writeFileSync(outPath, png);
  console.log(`✓ icon${size}.png generated (${png.length} bytes)`);
}

console.log('\nAll icons generated in /icons/');
