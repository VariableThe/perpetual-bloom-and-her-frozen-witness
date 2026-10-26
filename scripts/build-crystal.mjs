#!/usr/bin/env node
/**
 * Build the crystallized low-poly backdrop for the edition.
 *
 * Generates two seeded triangulated SVGs (light + dark theme) in purple
 * hues — pink → orchid → violet → deep purple dissolving into white (or
 * deep plum for dark mode), echoing a faceted-glass reference plate.
 *
 * Run with: npm run build:crystal
 * Output: assets/images/crystal-bg.svg, assets/images/crystal-bg-dark.svg
 *
 * The layout is deterministic (fixed seed), so re-running produces the
 * same files. Tweak PALETTES below to re-skin; no UI code changes needed.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'assets/images');

const WIDTH = 1600;
const HEIGHT = 900;
const COLS = 28;
const ROWS = 16;
const JITTER = 0.34;
const SEED = 111105;

const PALETTES = {
  light: {
    file: 'crystal-bg.svg',
    title: 'Crystallized pink to purple backdrop',
    stops: [
      [0.0, [247, 168, 221]], // pink
      [0.36, [211, 155, 242]], // orchid
      [0.66, [139, 92, 246]], // violet
      [1.0, [109, 63, 212]] // deep purple
    ],
    floor: [255, 255, 255], // dissolves into white
    floorStart: 0.52,
    seam: 'rgba(255,255,255,0.4)',
    vary: 5
  },
  dark: {
    file: 'crystal-bg-dark.svg',
    title: 'Crystallized deep purple backdrop',
    stops: [
      [0.0, [146, 74, 130]], // muted magenta
      [0.36, [110, 62, 168]], // purple
      [0.66, [82, 44, 138]], // deep violet
      [1.0, [46, 24, 82]] // plum-black
    ],
    floor: [20, 14, 30], // dissolves into near-black plum
    floorStart: 0.55,
    seam: 'rgba(255,255,255,0.16)',
    vary: 6
  }
};

function mulberry32(seed) {
  let state = seed | 0;
  return function () {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function sampleStops(stops, t) {
  if (t <= stops[0][0]) return stops[0][1].slice();
  for (let i = 1; i < stops.length; i += 1) {
    if (t <= stops[i][0]) {
      const [p0, c0] = stops[i - 1];
      const [p1, c1] = stops[i];
      const k = (t - p0) / (p1 - p0);
      return [lerp(c0[0], c1[0], k), lerp(c0[1], c1[1], k), lerp(c0[2], c1[2], k)];
    }
  }
  return stops[stops.length - 1][1].slice();
}

function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function toHex(channel) {
  return Math.round(Math.min(255, Math.max(0, channel)))
    .toString(16)
    .padStart(2, '0');
}

function buildPolys(palette, rng) {
  const cellW = WIDTH / COLS;
  const cellH = HEIGHT / ROWS;
  const pts = [];
  for (let j = 0; j <= ROWS; j += 1) {
    const row = [];
    for (let i = 0; i <= COLS; i += 1) {
      const edgeX = i === 0 || i === COLS;
      const edgeY = j === 0 || j === ROWS;
      const jx = edgeX ? 0 : (rng() * 2 - 1) * JITTER * cellW;
      const jy = edgeY ? 0 : (rng() * 2 - 1) * JITTER * cellH;
      row.push([i * cellW + jx, j * cellH + jy]);
    }
    pts.push(row);
  }

  const polys = [];
  for (let j = 0; j < ROWS; j += 1) {
    for (let i = 0; i < COLS; i += 1) {
      const a = pts[j][i];
      const b = pts[j][i + 1];
      const c = pts[j + 1][i];
      const d = pts[j + 1][i + 1];
      if ((i + j) % 2 === 0) polys.push([a, b, d], [a, d, c]);
      else polys.push([a, b, c], [b, d, c]);
    }
  }
  return polys;
}

function paint(palette, rng) {
  const polys = buildPolys(palette, rng);
  return polys.map((tri) => {
    const cx = (tri[0][0] + tri[1][0] + tri[2][0]) / 3 / WIDTH;
    const cy = (tri[0][1] + tri[1][1] + tri[2][1]) / 3 / HEIGHT;
    const base = sampleStops(palette.stops, cx);
    const floorMix = Math.pow(smoothstep(palette.floorStart, 1, cy), 1.15) * 0.96;
    const v = (rng() * 2 - 1) * palette.vary;
    const mixed = [
      lerp(base[0], palette.floor[0], floorMix) + v,
      lerp(base[1], palette.floor[1], floorMix) + v,
      lerp(base[2], palette.floor[2], floorMix) + v
    ];
    const fill = `#${toHex(mixed[0])}${toHex(mixed[1])}${toHex(mixed[2])}`;
    const points = tri.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    return `<polygon points="${points}" fill="${fill}"/>`;
  });
}

function buildSvg(palette) {
  const rng = mulberry32(SEED);
  const polys = paint(palette, rng).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}" role="img" aria-label="${palette.title}"><title>${palette.title}</title><rect width="${WIDTH}" height="${HEIGHT}" fill="#ffffff"/><g stroke="${palette.seam}" stroke-width="1">${polys}</g></svg>\n`;
}

for (const palette of Object.values(PALETTES)) {
  const target = path.join(OUT_DIR, palette.file);
  fs.writeFileSync(target, buildSvg(palette));
  const kb = (fs.statSync(target).size / 1024).toFixed(1);
  console.log(`Wrote ${path.relative(ROOT, target)} (${kb} KiB)`);
}
