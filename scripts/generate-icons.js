#!/usr/bin/env node
'use strict';
/**
 * Renders the app icons as PNGs with a tiny software rasterizer, so the project
 * has no native image dependencies. Run with: npm run icons
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/* ------------------------------------------------------------ PNG encoding */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
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

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* -------------------------------------------------------------- rasterizer */
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (edge, dist) => clamp01(0.5 - dist / edge);

function roundedBoxSdf(px, py, halfW, halfH, radius) {
  const qx = Math.abs(px) - halfW + radius;
  const qy = Math.abs(py) - halfH + radius;
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  return outside + Math.min(Math.max(qx, qy), 0) - radius;
}

function segmentSdf(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = clamp01(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

/**
 * Draws the mark: a rounded tile with a soft diagonal gradient, a subtle
 * clipboard outline and a bold checkmark.
 */
function renderIcon(size, { maskable = false } = {}) {
  const rgba = Buffer.alloc(size * size * 4);
  const aa = 1.6 / size;                       // antialias width in unit space
  const inset = maskable ? 0.0 : 0.045;        // maskable icons bleed to the edge
  const half = 0.5 - inset;
  const radius = maskable ? 0.5 : 0.22;
  const scale = maskable ? 0.62 : 0.8;         // keep art inside the safe zone

  const top = [37, 99, 235];    // #2563eb
  const bottom = [14, 165, 233]; // #0ea5e9

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const ux = (x + 0.5) / size - 0.5;
      const uy = (y + 0.5) / size - 0.5;
      const i = (y * size + x) * 4;

      const tile = smooth(aa, roundedBoxSdf(ux, uy, half, half, radius));
      if (tile <= 0) continue;

      const t = clamp01((ux + uy + 0.7) / 1.4);
      let r = mix(top[0], bottom[0], t);
      let g = mix(top[1], bottom[1], t);
      let b = mix(top[2], bottom[2], t);

      // clipboard body (translucent white card)
      const card = smooth(aa, roundedBoxSdf(ux, uy + 0.04 * scale, 0.3 * scale, 0.34 * scale, 0.07 * scale));
      const clip = smooth(aa, roundedBoxSdf(ux, uy + 0.3 * scale, 0.13 * scale, 0.055 * scale, 0.05 * scale));
      const cardAlpha = Math.max(card * 0.18, clip * 0.55);
      r = mix(r, 255, cardAlpha);
      g = mix(g, 255, cardAlpha);
      b = mix(b, 255, cardAlpha);

      // checkmark
      const stroke = 0.062 * scale;
      const d = Math.min(
        segmentSdf(ux, uy, -0.16 * scale, 0.05 * scale, -0.03 * scale, 0.18 * scale),
        segmentSdf(ux, uy, -0.03 * scale, 0.18 * scale, 0.2 * scale, -0.16 * scale)
      ) - stroke;
      const check = smooth(aa, d);
      r = mix(r, 255, check);
      g = mix(g, 255, check);
      b = mix(b, 255, check);

      rgba[i] = Math.round(r);
      rgba[i + 1] = Math.round(g);
      rgba[i + 2] = Math.round(b);
      rgba[i + 3] = Math.round(tile * 255);
    }
  }
  return encodePng(size, size, rgba);
}

const outDir = path.join(__dirname, '..', 'src', 'icons');
fs.mkdirSync(outDir, { recursive: true });

const targets = [
  ['icon-32.png', 32, {}],
  ['icon-96.png', 96, {}],
  ['icon-180.png', 180, {}],   // apple-touch-icon
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['maskable-192.png', 192, { maskable: true }],
  ['maskable-512.png', 512, { maskable: true }],
];

for (const [name, size, opts] of targets) {
  fs.writeFileSync(path.join(outDir, name), renderIcon(size, opts));
  console.log(`  wrote src/icons/${name} (${size}x${size})`);
}
