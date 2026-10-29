#!/usr/bin/env node
/**
 * Generate the original SVG artwork for Perpetual Bloom and her Frozen Witness.
 *
 * Outputs:
 *   assets/art/cover.svg
 *   assets/art/chapters/chapter-01.svg ... chapter-21.svg
 *   assets/art/gallery/chapter-01-bloom.svg ... chapter-21-bloom.svg
 *   assets/art/gallery/chapter-01-relic.svg ... chapter-21-relic.svg
 *
 * Everything is hand-built SVG: no external assets, no scripts, no network.
 * A seeded PRNG makes the variation deterministic from run to run.
 *
 * No dependencies. Run with: node scripts/build-art.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_FILE = path.join(ROOT, 'data', 'story.config.json');
const BOOK_FILE = path.join(ROOT, 'content', 'book.json');
const ART_DIR = path.join(ROOT, 'assets', 'art');
const CHAPTER_DIR = path.join(ART_DIR, 'chapters');
const GALLERY_DIR = path.join(ART_DIR, 'gallery');

const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
const book = JSON.parse(fs.readFileSync(BOOK_FILE, 'utf8'));

const FONT = "Georgia, 'Times New Roman', serif";
const INK = '#3B2B40';
const PLUM = '#5B3F62';
const CREAM = '#FFFDFB';
const PINK = '#F3C9DB';
const LILAC = '#DCCBEF';
const WHITE = '#FFFFFF';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const n = (value) => Number(value.toFixed(2));
const o = (value) => Number(value.toFixed(3));
const esc = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}

function tint(hex, amount) {
  const { r, g, b } = hexToRgb(hex);
  const mix = (channel) => Math.round(channel + (255 - channel) * amount);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

function shade(hex, amount) {
  const { r, g, b } = hexToRgb(hex);
  const mix = (channel) => Math.round(channel * (1 - amount));
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

function petalPath(rx, ry) {
  return [
    `M0 0`,
    `C ${n(-rx * 0.86)} ${n(-ry * 0.26)} ${n(-rx * 0.58)} ${n(-ry * 0.94)} 0 ${n(-ry)}`,
    `C ${n(rx * 0.58)} ${n(-ry * 0.94)} ${n(rx * 0.86)} ${n(-ry * 0.26)} 0 0`,
    'Z',
  ].join(' ');
}

function petal(cx, cy, rx, ry, rotation, fill, opacity = 1, stroke = 'none') {
  const strokeAttr = stroke === 'none' ? '' : ` stroke="${stroke}" stroke-width="1.2"`;
  return `<path d="${petalPath(rx, ry)}" transform="translate(${n(cx)} ${n(cy)}) rotate(${n(rotation)})" fill="${fill}" opacity="${o(opacity)}"${strokeAttr}/>`;
}

function leaf(cx, cy, rx, ry, rotation, fill, opacity = 1) {
  return `<path d="M0 0 C ${n(-rx)} ${n(-ry * 0.55)} ${n(-rx * 0.85)} ${n(-ry)} 0 ${n(-ry)} C ${n(rx * 0.45)} ${n(-ry * 0.7)} ${n(rx * 0.7)} ${n(-ry * 0.25)} 0 0 Z" transform="translate(${n(cx)} ${n(cy)}) rotate(${n(rotation)})" fill="${fill}" opacity="${o(opacity)}"/>`;
}

function flower(cx, cy, radius, count, rotation, fill, opacity, rng) {
  const petals = [];
  for (let i = 0; i < count; i += 1) {
    petals.push(
      petal(
        cx,
        cy,
        radius * (0.72 + rng() * 0.18),
        radius * (1.25 + rng() * 0.3),
        rotation + (360 / count) * i,
        fill,
        opacity * (0.55 + rng() * 0.35),
      ),
    );
  }
  return `<g>${petals.join('')}<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(radius * 0.19)}" fill="${INK}" opacity="${o(opacity * 0.5)}"/></g>`;
}

function frost(cx, cy, size, color, opacity, rng, width = 1.6) {
  const parts = [];
  for (let i = 0; i < 6; i += 1) {
    const angle = (i * 60) + (rng() * 10 - 5);
    const rad = (angle * Math.PI) / 180;
    const x1 = cx + Math.cos(rad) * size * 0.24;
    const y1 = cy + Math.sin(rad) * size * 0.24;
    const x2 = cx + Math.cos(rad) * size;
    const y2 = cy + Math.sin(rad) * size;
    parts.push(`<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}"/>`);
    const branchAt = 0.55 + rng() * 0.24;
    const bx = cx + Math.cos(rad) * size * branchAt;
    const by = cy + Math.sin(rad) * size * branchAt;
    const spread = 0.55;
    for (const direction of [-1, 1]) {
      const a2 = rad + direction * spread;
      parts.push(
        `<line x1="${n(bx)}" y1="${n(by)}" x2="${n(bx + Math.cos(a2) * size * 0.26)}" y2="${n(by + Math.sin(a2) * size * 0.26)}"/>`,
      );
    }
  }
  return `<g stroke="${color}" stroke-width="${width}" opacity="${o(opacity)}" stroke-linecap="round">${parts.join('')}</g>`;
}

function star(cx, cy, size, color, opacity) {
  return `<path d="M ${n(cx)} ${n(cy - size)} Q ${n(cx + size * 0.16)} ${n(cy - size * 0.16)} ${n(cx + size)} ${n(cy)} Q ${n(cx + size * 0.16)} ${n(cy + size * 0.16)} ${n(cx)} ${n(cy + size)} Q ${n(cx - size * 0.16)} ${n(cy + size * 0.16)} ${n(cx - size)} ${n(cy)} Q ${n(cx - size * 0.16)} ${n(cy - size * 0.16)} ${n(cx)} ${n(cy - size)} Z" fill="${color}" opacity="${o(opacity)}"/>`;
}

function ring(cx, cy, radius, color, opacity, width = 1.4, dash = '') {
  return `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(radius)}" fill="none" stroke="${color}" stroke-width="${width}" opacity="${o(opacity)}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
}

function spray(x, y, scale, rotation, color, rng, opacity = 0.9) {
  const parts = [];
  const stem = [
    `M 0 0`,
    `C ${n(35 * scale)} ${n(-80 * scale)} ${n(20 * scale)} ${n(-160 * scale)} ${n(-15 * scale)} ${n(-245 * scale)}`,
  ].join(' ');
  parts.push(`<path d="${stem}" fill="none" stroke="${color}" stroke-width="${n(2.4 * scale)}" opacity="${o(opacity)}" stroke-linecap="round"/>`);
  for (let i = 0; i < 7; i += 1) {
    const t = 0.12 + i * 0.115;
    const lx = 35 * scale * Math.sin(t * Math.PI) * (1 - t * 0.25);
    const ly = -245 * scale * t;
    const side = i % 2 === 0 ? -1 : 1;
    parts.push(
      leaf(
        lx,
        ly,
        22 * scale,
        48 * scale,
        side * (35 + rng() * 25),
        color,
        opacity * (0.45 + rng() * 0.3),
      ),
    );
    if (i === 3) {
      parts.push(
        flower(
          lx,
          ly,
          20 * scale,
          6,
          rng() * 360,
          tint(color, 0.35),
          0.5,
          rng,
        ),
      );
    }
  }
  return `<g transform="translate(${n(x)} ${n(y)}) rotate(${n(rotation)})">${parts.join('')}</g>`;
}

function cluster(cx, cy, scale, rotation, accent, rng, opacity = 0.8) {
  const parts = [];
  const count = 7 + Math.floor(rng() * 4);
  for (let i = 0; i < count; i += 1) {
    const angle = rotation + (360 / count) * i + (rng() * 14 - 7);
    const distance = (14 + rng() * 38) * scale;
    const rad = (angle * Math.PI) / 180;
    const px = cx + Math.cos(rad) * distance;
    const py = cy + Math.sin(rad) * distance;
    const fill = i % 3 === 0 ? tint(accent, 0.55) : i % 3 === 1 ? accent : tint(accent, 0.25);
    parts.push(
      petal(
        px,
        py,
        (18 + rng() * 22) * scale,
        (42 + rng() * 30) * scale,
        angle + 90,
        fill,
        opacity * (0.35 + rng() * 0.4),
      ),
    );
  }
  parts.push(frost(cx, cy, 92 * scale, tint(accent, 0.7), opacity * 0.55, rng, 1.2));
  parts.push(ring(cx, cy, 66 * scale, accent, opacity * 0.35, 1.1, '2 8'));
  return `<g>${parts.join('')}</g>`;
}

function defs(accent, id = 'art') {
  const soft = tint(accent, 0.5);
  return `<defs>
    <linearGradient id="${id}-bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#FFFDFB"/>
      <stop offset="0.48" stop-color="${tint(accent, 0.9)}"/>
      <stop offset="1" stop-color="${tint(accent, 0.72)}"/>
    </linearGradient>
    <radialGradient id="${id}-halo" cx="50%" cy="42%" r="62%">
      <stop offset="0" stop-color="${soft}" stop-opacity="0.7"/>
      <stop offset="0.55" stop-color="${tint(accent, 0.8)}" stop-opacity="0.24"/>
      <stop offset="1" stop-color="${tint(accent, 0.9)}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="${id}-accent" x1="0" y1="0" x2="0.9" y2="1">
      <stop offset="0" stop-color="${tint(accent, 0.2)}"/>
      <stop offset="0.55" stop-color="${accent}"/>
      <stop offset="1" stop-color="${shade(accent, 0.18)}"/>
    </linearGradient>
    <linearGradient id="${id}-veil" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${WHITE}" stop-opacity="0.88"/>
      <stop offset="0.55" stop-color="${WHITE}" stop-opacity="0.4"/>
      <stop offset="1" stop-color="${WHITE}" stop-opacity="0.08"/>
    </linearGradient>
    <radialGradient id="${id}-spot" cx="50%" cy="46%" r="52%">
      <stop offset="0" stop-color="${tint(accent, 0.72)}" stop-opacity="0.58"/>
      <stop offset="0.55" stop-color="${tint(accent, 0.86)}" stop-opacity="0.16"/>
      <stop offset="1" stop-color="${shade(accent, 0.5)}" stop-opacity="0.24"/>
    </radialGradient>
    <radialGradient id="${id}-vignette" cx="50%" cy="48%" r="72%">
      <stop offset="0" stop-color="${shade(accent, 0.5)}" stop-opacity="0"/>
      <stop offset="0.66" stop-color="${shade(accent, 0.5)}" stop-opacity="0"/>
      <stop offset="1" stop-color="${shade(accent, 0.5)}" stop-opacity="0.32"/>
    </radialGradient>
    <filter id="${id}-blur" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="26"/>
    </filter>
    <filter id="${id}-soft" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="4"/>
    </filter>
    <filter id="${id}-shadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="${shade(accent, 0.55)}" flood-opacity="0.22"/>
    </filter>
  </defs>`;
}

function baseBackground(w, h, accent, id = 'art') {
  return `<rect width="${w}" height="${h}" fill="url(#${id}-bg)"/>
  <rect width="${w}" height="${h}" fill="url(#${id}-halo)"/>
  <rect width="${w}" height="${h}" fill="url(#${id}-veil)" opacity="0.5"/>`;
}

const LAYOUTS = [
  { family: 'arch', numeral: [628, 856, 540, -3], motif: [470, 770, 1.18], bloom: [[240, 520, 1.18], [812, 420, 0.8]] },
  { family: 'diagonal', numeral: [252, 872, 470, -7], motif: [684, 730, 1.05], bloom: [[860, 320, 0.95], [390, 850, 0.76]] },
  { family: 'wreath', numeral: [500, 804, 520, 0], motif: [500, 662, 0.95], bloom: [[500, 430, 1.05], [782, 660, 0.55]] },
  { family: 'column', numeral: [548, 890, 500, 2], motif: [480, 704, 1.02], bloom: [[286, 720, 1.08], [760, 860, 0.62]] },
  { family: 'horizon', numeral: [500, 764, 550, 0], motif: [500, 690, 1.1], bloom: [[302, 560, 0.85], [730, 500, 0.94]] },
  { family: 'constellation', numeral: [724, 858, 470, 5], motif: [420, 708, 1.0], bloom: [[230, 380, 0.82], [846, 610, 0.7]] },
  { family: 'frame', numeral: [500, 828, 510, 0], motif: [500, 688, 1.0], bloom: [[224, 300, 0.7], [790, 1010, 0.74]] },
  { family: 'canopy', numeral: [312, 842, 510, -4], motif: [640, 752, 1.08], bloom: [[700, 300, 1.0], [290, 1030, 0.64]] },
  { family: 'spiral', numeral: [694, 846, 490, 3], motif: [410, 740, 1.06], bloom: [[810, 410, 0.84], [330, 360, 0.72]] },
  { family: 'tide', numeral: [500, 842, 530, 0], motif: [500, 690, 1.08], bloom: [[300, 560, 0.98], [780, 540, 0.72]] },
  { family: 'arch', numeral: [296, 846, 520, 4], motif: [650, 748, 1.05], bloom: [[772, 450, 1.02], [248, 930, 0.62]] },
  { family: 'diagonal', numeral: [748, 856, 470, 6], motif: [352, 726, 1.0], bloom: [[240, 360, 0.9], [830, 980, 0.68]] },
  { family: 'wreath', numeral: [500, 812, 520, 0], motif: [500, 670, 1.0], bloom: [[500, 430, 1.08], [270, 680, 0.56]] },
  { family: 'column', numeral: [452, 888, 510, -2], motif: [560, 706, 0.96], bloom: [[760, 520, 0.95], [270, 900, 0.7]] },
  { family: 'horizon', numeral: [500, 758, 550, 0], motif: [500, 684, 1.1], bloom: [[326, 500, 0.86], [764, 570, 0.82]] },
  { family: 'constellation', numeral: [276, 862, 480, -5], motif: [626, 716, 1.02], bloom: [[820, 340, 0.88], [288, 1030, 0.6]] },
  { family: 'frame', numeral: [500, 832, 510, 0], motif: [500, 685, 1.28], bloom: [[220, 990, 0.68], [790, 296, 0.78]] },
  { family: 'canopy', numeral: [688, 846, 500, 4], motif: [352, 748, 1.04], bloom: [[300, 340, 1.02], [750, 1020, 0.62]] },
  { family: 'spiral', numeral: [312, 850, 500, -4], motif: [634, 738, 1.04], bloom: [[790, 410, 0.9], [300, 360, 0.68]] },
  { family: 'tide', numeral: [500, 836, 540, 0], motif: [500, 686, 1.08], bloom: [[282, 570, 0.9], [800, 520, 0.78]] },
  { family: 'arch', numeral: [500, 816, 530, 0], motif: [500, 664, 1.12], bloom: [[260, 470, 1.04], [760, 480, 0.98]] },
];

function familyBackground(family, w, h, accent, rng, id = 'art') {
  const soft = tint(accent, 0.65);
  const pale = tint(accent, 0.85);
  const parts = [];

  if (family === 'arch') {
    parts.push(`<path d="M ${w * 0.13} ${h * 0.94} L ${w * 0.13} ${h * 0.42} A ${w * 0.37} ${w * 0.37} 0 0 1 ${w * 0.87} ${h * 0.42} L ${w * 0.87} ${h * 0.94} Z" fill="${pale}" opacity="0.3"/>`);
    parts.push(`<path d="M ${w * 0.2} ${h * 0.94} L ${w * 0.2} ${h * 0.45} A ${w * 0.3} ${w * 0.3} 0 0 1 ${w * 0.8} ${h * 0.45} L ${w * 0.8} ${h * 0.94}" fill="none" stroke="${accent}" stroke-width="1.6" opacity="0.35"/>`);
    parts.push(`<circle cx="${w * 0.5}" cy="${h * 0.38}" r="${w * 0.19}" fill="${soft}" opacity="0.24" filter="url(#${id}-blur)"/>`);
  } else if (family === 'diagonal') {
    parts.push(`<path d="M ${-w * 0.1} ${h * 0.7} L ${w * 0.7} ${-h * 0.08} L ${w * 1.1} ${h * 0.2} L ${w * 0.26} ${h * 1.02} Z" fill="${pale}" opacity="0.44"/>`);
    parts.push(`<path d="M ${-w * 0.02} ${h * 0.78} L ${w * 0.78} ${h * 0.0}" stroke="${accent}" stroke-width="1.4" opacity="0.3"/>`);
    parts.push(`<circle cx="${w * 0.82}" cy="${h * 0.18}" r="${w * 0.2}" fill="${soft}" opacity="0.3" filter="url(#${id}-blur)"/>`);
  } else if (family === 'wreath') {
    for (let i = 0; i < 4; i += 1) {
      parts.push(ring(w * 0.5, h * 0.44, w * (0.16 + i * 0.075), accent, 0.18 - i * 0.02, 1.2, i % 2 ? '2 10' : ''));
    }
    parts.push(`<circle cx="${w * 0.5}" cy="${h * 0.44}" r="${w * 0.2}" fill="${soft}" opacity="0.35" filter="url(#${id}-blur)"/>`);
  } else if (family === 'column') {
    parts.push(`<rect x="${w * 0.56}" y="${-h * 0.05}" width="${w * 0.3}" height="${h * 1.1}" fill="${pale}" opacity="0.38"/>`);
    parts.push(`<line x1="${w * 0.57}" y1="0" x2="${w * 0.57}" y2="${h}" stroke="${accent}" stroke-width="1.3" opacity="0.3"/>`);
    parts.push(`<line x1="${w * 0.85}" y1="0" x2="${w * 0.85}" y2="${h}" stroke="${accent}" stroke-width="1.3" opacity="0.3"/>`);
    parts.push(`<circle cx="${w * 0.71}" cy="${h * 0.34}" r="${w * 0.17}" fill="${soft}" opacity="0.28" filter="url(#${id}-blur)"/>`);
  } else if (family === 'horizon') {
    parts.push(`<circle cx="${w * 0.5}" cy="${h * 0.34}" r="${w * 0.15}" fill="${soft}" opacity="0.55"/>`);
    parts.push(`<circle cx="${w * 0.5}" cy="${h * 0.34}" r="${w * 0.19}" fill="none" stroke="${accent}" stroke-width="1.2" opacity="0.26"/>`);
    parts.push(`<path d="M 0 ${h * 0.77} C ${w * 0.22} ${h * 0.69} ${w * 0.36} ${h * 0.82} ${w * 0.55} ${h * 0.75} C ${w * 0.76} ${h * 0.68} ${w * 0.9} ${h * 0.76} ${w} ${h * 0.7} L ${w} ${h} L 0 ${h} Z" fill="${pale}" opacity="0.5"/>`);
    parts.push(`<path d="M 0 ${h * 0.84} C ${w * 0.3} ${h * 0.76} ${w * 0.6} ${h * 0.9} ${w} ${h * 0.8}" fill="none" stroke="${accent}" stroke-width="1.4" opacity="0.26"/>`);
  } else if (family === 'constellation') {
    const points = [];
    for (let i = 0; i < 16; i += 1) {
      points.push([w * (0.08 + rng() * 0.84), h * (0.1 + rng() * 0.62)]);
    }
    for (let i = 0; i < points.length - 1; i += 1) {
      if (i % 3 !== 2) {
        parts.push(`<line x1="${n(points[i][0])}" y1="${n(points[i][1])}" x2="${n(points[i + 1][0])}" y2="${n(points[i + 1][1])}" stroke="${accent}" stroke-width="0.8" opacity="0.22"/>`);
      }
    }
    for (let i = 0; i < points.length; i += 1) {
      parts.push(star(points[i][0], points[i][1], 3 + rng() * 5, accent, 0.25 + rng() * 0.4));
    }
    parts.push(`<circle cx="${w * 0.72}" cy="${h * 0.3}" r="${w * 0.16}" fill="${soft}" opacity="0.22" filter="url(#${id}-blur)"/>`);
  } else if (family === 'frame') {
    parts.push(`<rect x="${w * 0.055}" y="${h * 0.045}" width="${w * 0.89}" height="${h * 0.91}" fill="none" stroke="${accent}" stroke-width="1.4" opacity="0.32"/>`);
    parts.push(`<rect x="${w * 0.075}" y="${h * 0.062}" width="${w * 0.85}" height="${h * 0.876}" fill="none" stroke="${accent}" stroke-width="0.7" opacity="0.22"/>`);
    parts.push(`<circle cx="${w * 0.5}" cy="${h * 0.43}" r="${w * 0.22}" fill="${soft}" opacity="0.24" filter="url(#${id}-blur)"/>`);
  } else if (family === 'canopy') {
    parts.push(`<path d="M 0 0 L ${w} 0 L ${w} ${h * 0.18} C ${w * 0.76} ${h * 0.28} ${w * 0.64} ${h * 0.12} ${w * 0.48} ${h * 0.2} C ${w * 0.3} ${h * 0.29} ${w * 0.16} ${h * 0.13} 0 ${h * 0.22} Z" fill="${pale}" opacity="0.5"/>`);
    for (let i = 0; i < 3; i += 1) {
      const x = w * (0.18 + i * 0.29);
      parts.push(`<path d="M ${n(x)} 0 C ${n(x + 26)} ${h * 0.12} ${n(x - 20)} ${h * 0.19} ${n(x + 8)} ${h * 0.28}" fill="none" stroke="${accent}" stroke-width="1.2" opacity="0.3"/>`);
    }
    parts.push(`<circle cx="${w * 0.7}" cy="${h * 0.16}" r="${w * 0.14}" fill="${soft}" opacity="0.25" filter="url(#${id}-blur)"/>`);
  } else if (family === 'spiral') {
    for (let i = 0; i < 6; i += 1) {
      const r = w * (0.1 + i * 0.055);
      const start = -40 + i * 38;
      parts.push(`<path d="M ${n(w * 0.5 + r * Math.cos((start * Math.PI) / 180))} ${n(h * 0.46 + r * Math.sin((start * Math.PI) / 180))} A ${n(r)} ${n(r)} 0 0 1 ${n(w * 0.5 + r * Math.cos(((start + 220) * Math.PI) / 180))} ${n(h * 0.46 + r * Math.sin(((start + 220) * Math.PI) / 180))}" fill="none" stroke="${accent}" stroke-width="1.2" opacity="${o(0.3 - i * 0.025)}"/>`);
    }
    parts.push(`<circle cx="${w * 0.42}" cy="${h * 0.4}" r="${w * 0.17}" fill="${soft}" opacity="0.3" filter="url(#${id}-blur)"/>`);
  } else {
    for (let i = 0; i < 4; i += 1) {
      const y = h * (0.62 + i * 0.09);
      parts.push(`<path d="M 0 ${n(y)} C ${w * 0.24} ${n(y - 40)} ${w * 0.44} ${n(y + 44)} ${w * 0.68} ${n(y - 16)} C ${w * 0.84} ${n(y - 54)} ${w * 0.94} ${n(y - 20)} ${w} ${n(y - 34)}" fill="none" stroke="${accent}" stroke-width="1.3" opacity="${o(0.28 - i * 0.04)}"/>`);
    }
    parts.push(`<circle cx="${w * 0.62}" cy="${h * 0.3}" r="${w * 0.18}" fill="${soft}" opacity="0.28" filter="url(#${id}-blur)"/>`);
  }

  return parts.join('\n');
}

function wrapTitle(title, maxChars = 26) {
  const words = title.split(/\s+/);
  const lines = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function textBlock(lines, x, y, size, fill, options = {}) {
  const {
    anchor = 'start',
    lineHeight = size * 1.18,
    weight = '400',
    italic = false,
    spacing = 0,
  } = options;
  if (lines.length === 1) {
    return `<text x="${n(x)}" y="${n(y)}" font-family="${FONT}" font-size="${n(size)}" font-weight="${weight}"${italic ? ' font-style="italic"' : ''} fill="${fill}" text-anchor="${anchor}"${spacing ? ` letter-spacing="${spacing}"` : ''}>${esc(lines[0])}</text>`;
  }
  const tspans = lines
    .map((line, index) => `<tspan x="${n(x)}" dy="${index === 0 ? 0 : n(lineHeight)}">${esc(line)}</tspan>`)
    .join('');
  return `<text x="${n(x)}" y="${n(y)}" font-family="${FONT}" font-size="${n(size)}" font-weight="${weight}"${italic ? ' font-style="italic"' : ''} fill="${fill}" text-anchor="${anchor}"${spacing ? ` letter-spacing="${spacing}"` : ''}>${tspans}</text>`;
}

/* ------------------------------------------------------------------ motifs */

function motifCrane(accent, ink, opac = 1, final = false) {
  return `<g opacity="${opac}" stroke="${ink}" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round">
    <polygon points="0,-58 58,-16 20,6 50,50 -6,38 -18,10 -66,34 -34,-4 -54,-30" fill="${tint(accent, 0.35)}" fill-opacity="0.48"/>
    <path d="M 0,-58 L 18,-28 L -6,-14 Z" fill="${tint(accent, 0.55)}" fill-opacity="0.5"/>
    <path d="M 58,-16 L 18,-28" fill="none"/>
    <path d="M -34,-4 L -6,-14" fill="none"/>
    <path d="M -54,-30 L -34,-4 L -66,34" fill="none"/>
    <path d="M -18,10 L -6,38 L 50,50" fill="none"/>
    <path d="M 0,-58 C -4,-42 -12,-34 -6,-24" fill="none" stroke="${accent}" stroke-width="1.4" stroke-dasharray="2 5"/>
    <path d="M 50,50 C 60,44 62,34 58,24" fill="none"/>
    ${final ? `<path d="M 24,-14 C 12,-4 10,8 18,18" fill="none" stroke="${tint(accent, 0.6)}" stroke-width="1.4" stroke-dasharray="2 5"/><circle cx="0" cy="-61" r="2.2" fill="${accent}" stroke="none"/>` : `<path d="M -14,-6 C -22,2 -22,10 -14,18" fill="none" stroke="${tint(accent, 0.6)}" stroke-width="1.2"/>`}
  </g>`;
}

function motifArrow(accent, ink) {
  return `<g stroke="${ink}" stroke-width="2.6" stroke-linecap="round" fill="none">
    <path d="M -88,70 C -40,28 -8,-4 44,-52"/>
    <path d="M -88,70 L -70,64 M -88,70 L -80,52"/>
    <path d="M 44,-52 l 22,4 l -8,20"/>
    <path d="M 66,-72 C 40,-96 12,-88 19,-66 C 24,-50 52,-48 66,-72 Z" fill="${tint(accent, 0.35)}" fill-opacity="0.65" stroke="${accent}" stroke-width="2"/>
    <path d="M 66,-72 C 74,-92 100,-90 98,-70 C 97,-52 76,-52 66,-72 Z" fill="${tint(accent, 0.55)}" fill-opacity="0.55" stroke="${accent}" stroke-width="2"/>
    <path d="M -66,46 C 0,18 34,36 82,8" stroke="${accent}" stroke-width="1.2" stroke-dasharray="2 8" opacity="0.7"/>
  </g>`;
}

function motifClover(accent, ink) {
  const leaves = [0, 90, 180, 270]
    .map(
      (angle) =>
        `<path d="M0,-18 C -36,-26 -44,-70 0,-82 C 44,-70 36,-26 0,-18 Z" transform="rotate(${angle})" fill="${tint(accent, 0.25)}" fill-opacity="0.55" stroke="${accent}" stroke-width="2"/>`,
    )
    .join('');
  return `<g stroke="${ink}" stroke-width="2.2" fill="none">
    <g transform="translate(0 -18)">${leaves}</g>
    <path d="M 0,-18 C 4,14 -2,38 10,62"/>
    <path d="M 10,62 C 28,54 36,42 38,28" stroke="${accent}" stroke-width="1.4"/>
    <ellipse cx="0" cy="28" rx="86" ry="56" stroke="${accent}" stroke-width="1.6" stroke-dasharray="3 9" transform="rotate(-18)"/>
    <circle cx="-66" cy="46" r="5" fill="${accent}" stroke="none"/>
    <circle cx="62" cy="8" r="4" fill="${tint(accent, 0.5)}" stroke="none"/>
  </g>`;
}

function motifEarbuds(accent, ink) {
  return `<g stroke="${ink}" stroke-width="2.2" stroke-linecap="round" fill="none">
    <path d="M -76,12 C -98,54 -54,82 -14,58 C 24,36 8,-10 34,-28 C 58,-44 82,-28 78,0"/>
    <path d="M -46,-52 C -66,-72 -40,-94 -16,-84 C 8,-74 4,-40 -18,-34 C -34,-30 -52,-40 -46,-52 Z" fill="${tint(accent, 0.45)}" fill-opacity="0.5"/>
    <path d="M 48,-48 C 30,-68 54,-90 78,-80 C 100,-70 96,-38 74,-32 C 60,-28 42,-38 48,-48 Z" fill="${tint(accent, 0.6)}" fill-opacity="0.5"/>
    <path d="M -18,-34 L -6,-8 M 74,-32 L 62,-6"/>
    <rect x="-48" y="52" width="34" height="18" rx="4" transform="rotate(-14 -31 61)" stroke="${accent}"/>
    <path d="M -68,52 l -16,-10 l 16,-10 Z" fill="${tint(accent, 0.4)}" stroke="${accent}"/>
    <path d="M 78,52 l 16,-10 l -16,-10 Z" fill="${tint(accent, 0.4)}" stroke="${accent}"/>
  </g>`;
}

function motifClip(accent, ink) {
  return `<g stroke="${ink}" stroke-width="2.2" fill="none" stroke-linecap="round">
    <g transform="rotate(-16)">
      <rect x="-62" y="-16" width="124" height="32" rx="16" fill="${tint(accent, 0.4)}" fill-opacity="0.5"/>
      <path d="M -40,-16 L -34,12 M -18,-16 L -12,12 M 4,-16 L 10,12 M 26,-16 L 32,12 M 48,-16 L 54,12" stroke="${accent}" stroke-width="1.4"/>
      <circle cx="-62" cy="0" r="12" fill="${tint(accent, 0.65)}" fill-opacity="0.7"/>
    </g>
    <circle cx="48" cy="62" r="46" fill="${tint(accent, 0.72)}" fill-opacity="0.48"/>
    <circle cx="48" cy="62" r="38" stroke="${accent}" stroke-width="1.4"/>
    <path d="M 48,62 L 30,38 M 48,62 L 66,48" stroke="${accent}" stroke-width="2.4"/>
    <circle cx="48" cy="62" r="3" fill="${ink}" stroke="none"/>
    <text x="48" y="34" font-family="${FONT}" font-size="10" fill="${ink}" text-anchor="middle" stroke="none">12</text>
    <text x="48" y="94" font-family="${FONT}" font-size="10" fill="${ink}" text-anchor="middle" stroke="none">6</text>
    <text x="20" y="66" font-family="${FONT}" font-size="10" fill="${ink}" text-anchor="middle" stroke="none">9</text>
    <text x="78" y="66" font-family="${FONT}" font-size="10" fill="${ink}" text-anchor="middle" stroke="none">3</text>
  </g>`;
}

function motifCup(accent, ink) {
  return `<g stroke="${ink}" stroke-width="2.2" stroke-linecap="round" fill="none">
    <path d="M -58,-34 L -44,54 L 42,54 L 54,-34 Z" fill="${tint(accent, 0.55)}" fill-opacity="0.45"/>
    <path d="M -62,-42 L 58,-42 L 52,-28 L -54,-28 Z" fill="${tint(accent, 0.3)}" fill-opacity="0.6"/>
    <path d="M -22,-42 L 20,-96"/>
    <path d="M 12,-84 l 18,10" stroke="${accent}" stroke-width="1.6"/>
    <path d="M 16,-70 l 16,8" stroke="${accent}" stroke-width="1.2" opacity="0.7"/>
    <circle cx="-20" cy="10" r="4" fill="${accent}" stroke="none"/>
    <circle cx="2" cy="28" r="3" fill="${tint(accent, 0.4)}" stroke="none"/>
    <circle cx="22" cy="2" r="5" fill="${tint(accent, 0.6)}" stroke="none"/>
    <rect x="-78" y="62" width="58" height="20" rx="3" transform="rotate(-8 -49 72)" fill="${tint(accent, 0.4)}" stroke="${accent}"/>
  </g>`;
}

function motifSparrow(accent, ink) {
  return `<g stroke="${ink}" stroke-width="2.2" stroke-linecap="round" fill="none">
    <path d="M -76,22 C -44,8 -22,-2 0,-8 C 14,-12 30,-10 38,-2 C 28,10 6,16 -16,20 C 6,18 24,26 34,40 C 8,34 -16,36 -42,46 C -28,32 -42,22 -58,26 C -50,18 -62,10 -76,22 Z" fill="${tint(accent, 0.45)}" fill-opacity="0.45"/>
    <path d="M 38,-2 L 66,-14 L 52,4 Z" fill="${tint(accent, 0.6)}"/>
    <circle cx="36" cy="-8" r="2.4" fill="${ink}" stroke="none"/>
    <path d="M 58,58 C 82,40 100,32 118,30 C 100,44 92,58 78,74 C 92,62 106,58 122,60 C 104,70 90,84 72,88" stroke="${accent}" stroke-width="1.8"/>
    <path d="M -110,-52 C -84,-66 -58,-68 -32,-60 C -58,-52 -80,-38 -98,-22 C -86,-42 -96,-52 -110,-52 Z" fill="${tint(accent, 0.3)}" fill-opacity="0.45" stroke="${accent}" stroke-width="1.4"/>
  </g>`;
}

function motifBox(accent, ink) {
  return `<g stroke="${ink}" stroke-width="2.2" fill="none" stroke-linejoin="round">
    <path d="M -80,4 L -64,64 L 62,64 L 78,4 Z" fill="${tint(accent, 0.35)}" fill-opacity="0.55"/>
    <path d="M -80,4 L -68,-10 L 70,-10 L 78,4 Z" fill="${tint(accent, 0.55)}" fill-opacity="0.6"/>
    <path d="M -54,-10 L -42,-58 L 58,-58 L 70,-10" fill="${tint(accent, 0.7)}" fill-opacity="0.3"/>
    <path d="M -42,-58 L 58,-58 L 50,-44 L -48,-44 Z" fill="${tint(accent, 0.45)}" fill-opacity="0.5"/>
    <path d="M -24,-44 L -18,-84 L 18,-80 L 14,-44" fill="${WHITE}" fill-opacity="0.7"/>
    <path d="M 8,-44 L 18,-76 L 40,-68 L 30,-44" fill="${WHITE}" fill-opacity="0.6"/>
    <path d="M -12,-70 L 2,-68 M -10,-60 L 4,-58 M 16,-64 L 32,-60" stroke="${accent}" stroke-width="1.1"/>
    <path d="M -70,20 L 68,20 M -66,38 L 64,38" stroke="${accent}" stroke-width="1" opacity="0.6"/>
    <circle cx="0" cy="4" r="5" fill="${accent}" stroke="none"/>
  </g>`;
}

function motifPhone(accent, ink) {
  return `<g stroke="${ink}" stroke-width="2.2" fill="none" stroke-linejoin="round">
    <rect x="-46" y="-84" width="92" height="168" rx="16" fill="${tint(accent, 0.72)}" fill-opacity="0.55"/>
    <rect x="-36" y="-68" width="72" height="134" rx="8" fill="${WHITE}" fill-opacity="0.65" stroke="${accent}"/>
    <path d="M -18,-84 L 18,-84" stroke="${accent}" stroke-width="2"/>
    <path d="M 0,22 C -22,4 -34,-14 -22,-28 C -12,-38 0,-28 0,-18 C 0,-28 12,-38 22,-28 C 34,-14 22,4 0,22 Z" fill="${accent}" fill-opacity="0.75" stroke="${accent}"/>
    <path d="M -24,-54 l 8,0 M -24,-44 l 8,0 M -24,-34 l 8,0" stroke="${accent}" stroke-width="2"/>
    <path d="M 16,-54 l 4,0 M 24,-54 l 4,0" stroke="${accent}" stroke-width="2"/>
    <path d="M -60,80 C -42,64 -20,66 -8,52 M 42,80 C 58,62 76,66 88,48" stroke="${accent}" stroke-width="1.4" opacity="0.7"/>
  </g>`;
}

function motifBook(accent, ink) {
  return `<g stroke="${ink}" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="M -86,42 Q -44,18 0,34 Q 44,18 86,42 L 86,58 Q 44,36 0,52 Q -44,36 -86,58 Z" fill="${tint(accent, 0.4)}" fill-opacity="0.5"/>
    <path d="M 0,34 L 0,52"/>
    <path d="M -74,32 Q -40,14 -6,26 M -74,44 Q -40,26 -6,38 M 8,26 Q 40,14 74,32 M 8,38 Q 40,26 74,44" stroke="${accent}" stroke-width="1"/>
    <path d="M 24,-74 C 6,-94 -18,-86 -12,-64 C -8,-48 12,-46 24,-74 Z" fill="${accent}" fill-opacity="0.55" stroke="${accent}"/>
    <path d="M 24,-74 C 38,-94 62,-86 56,-64 C 52,-48 32,-46 24,-74 Z" fill="${accent}" fill-opacity="0.38" stroke="${accent}"/>
    <path d="M -42,-50 l 20,-4 M -42,-38 l 16,-3" stroke="${accent}" stroke-width="1.2"/>
    <path d="M 62,30 l 14,-28 l 10,18" stroke="${accent}" stroke-width="1.2" opacity="0.7"/>
  </g>`;
}

function motifFigurine(accent, ink) {
  return `<g stroke="${ink}" stroke-width="2.2" fill="none" stroke-linejoin="round" stroke-linecap="round">
    <rect x="-76" y="54" width="152" height="20" rx="3" fill="${tint(accent, 0.45)}" fill-opacity="0.6"/>
    <path d="M -28,54 L -22,20 L -30,-4 L 24,-4 L 16,20 L 24,54" fill="${tint(accent, 0.55)}" fill-opacity="0.4"/>
    <circle cx="-2" cy="-34" r="26" fill="${tint(accent, 0.4)}" fill-opacity="0.55"/>
    <path d="M -28,-42 L -42,-62 L -26,-54 L -20,-72 L -10,-56 L 0,-76 L 6,-56 L 20,-70 L 20,-52 L 36,-58 L 24,-40" fill="${tint(accent, 0.35)}" fill-opacity="0.6" stroke="${accent}" stroke-width="1.6"/>
    <path d="M -22,-8 L -54,-26 M 16,-8 L 48,-30" stroke="${accent}" stroke-width="2.2"/>
    <circle cx="-52" cy="-28" r="5" fill="${accent}" stroke="none"/>
    <circle cx="48" cy="-32" r="5" fill="${accent}" stroke="none"/>
    <path d="M -10,-38 l 6,0 M 12,-38 l 6,0 M -4,-26 q 6,6 12,0" stroke="${ink}" stroke-width="1.6"/>
    <path d="M -8,20 l -4,24 M 12,20 l 4,24" stroke="${accent}" stroke-width="1.8"/>
  </g>`;
}

function motifNote(accent, ink) {
  return `<g stroke="${ink}" stroke-width="2.2" fill="none" stroke-linejoin="round">
    <path d="M -66,-64 L 44,-64 L 68,-40 L 68,66 L -66,66 Z" fill="${tint(accent, 0.25)}" fill-opacity="0.72" stroke="${accent}"/>
    <path d="M 44,-64 L 44,-40 L 68,-40" fill="${tint(accent, 0.55)}" stroke="${accent}"/>
    <path d="M -48,-30 L 28,-30 M -48,-14 L 42,-14 M -48,2 L 16,2" stroke="${accent}" stroke-width="1.4"/>
    <path d="M -30,34 C -44,22 -52,8 -40,-2 C -32,-8 -24,-2 -24,6 C -24,-2 -16,-8 -8,-2 C 4,8 -4,22 -30,34 Z" fill="${accent}" fill-opacity="0.6" stroke="${accent}"/>
    <rect x="30" y="26" width="54" height="32" rx="3" transform="rotate(-8 57 42)" fill="${tint(accent, 0.45)}" stroke="${ink}"/>
    <path d="M 44,32 l 0,20 M 58,30 l 0,20 M 72,28 l 0,20" stroke="${accent}" stroke-width="1.4"/>
  </g>`;
}

function motifBracelet(accent, ink) {
  return `<g stroke="${ink}" stroke-width="2.2" fill="none" stroke-linecap="round">
    <ellipse cx="0" cy="20" rx="72" ry="48" stroke="${accent}" stroke-width="4" stroke-dasharray="2 8"/>
    <ellipse cx="0" cy="20" rx="72" ry="48" stroke="${accent}" stroke-width="1.2" opacity="0.5"/>
    <circle cx="-64" cy="-2" r="9" fill="${tint(accent, 0.5)}" stroke="${accent}"/>
    <circle cx="-24" cy="66" r="7" fill="${accent}" stroke="${accent}"/>
    <circle cx="44" cy="52" r="8" fill="${tint(accent, 0.3)}" stroke="${accent}"/>
    <path d="M -18,4 C -28,-28 -2,-52 18,-34 C 32,-22 20,0 4,8 C -8,14 -18,12 -18,4 Z" fill="${tint(accent, 0.6)}" fill-opacity="0.6" stroke="${accent}"/>
    <path d="M 30,-12 C 20,-40 44,-58 58,-42 C 68,-30 58,-12 42,-8 C 32,-6 28,-8 30,-12 Z" fill="${tint(accent, 0.4)}" fill-opacity="0.6" stroke="${accent}"/>
    <path d="M -70,-36 C -38,-48 -4,-50 28,-42" stroke="${accent}" stroke-width="1.2" stroke-dasharray="2 7"/>
    <path d="M -46,11 l 8,5 M 52,24 l 9,5" stroke="${accent}" stroke-width="1.2"/>
  </g>`;
}

function motifPetal(accent, ink) {
  return `<g stroke="${ink}" stroke-width="2.2" fill="none" stroke-linecap="round">
    <path d="M 0,-78 C 54,-64 68,-14 38,34 C 18,66 -18,66 -38,34 C -68,-14 -54,-64 0,-78 Z" fill="${tint(accent, 0.25)}" fill-opacity="0.62" stroke="${accent}"/>
    <path d="M 0,-66 C 8,-24 8,22 0,52" stroke="${accent}" stroke-width="1.4"/>
    <path d="M 0,-30 C 18,-24 28,-8 30,10 M 0,-10 C -16,-2 -24,14 -26,30 M 0,12 C 12,18 18,30 18,42" stroke="${accent}" stroke-width="1" opacity="0.7"/>
    <path d="M -22,34 C -6,44 12,44 28,34" stroke="${accent}" stroke-width="1" opacity="0.6"/>
    <path d="M 64,-62 l 8,16 l 16,8 l -16,8 l -8,16 l -8,-16 l -16,-8 l 16,-8 Z" fill="${accent}" fill-opacity="0.3" stroke="${accent}" stroke-width="1"/>
  </g>`;
}

function motifMetro(accent, ink) {
  return `<g stroke="${ink}" stroke-width="2.2" fill="none" stroke-linejoin="round" stroke-linecap="round">
    <rect x="-58" y="-72" width="116" height="130" rx="18" fill="${tint(accent, 0.35)}" fill-opacity="0.6"/>
    <rect x="-42" y="-48" width="84" height="48" rx="6" fill="${WHITE}" fill-opacity="0.7" stroke="${accent}"/>
    <path d="M -42,-24 L 42,-24" stroke="${accent}" stroke-width="1"/>
    <rect x="-24" y="18" width="48" height="22" rx="3" stroke="${accent}"/>
    <path d="M -44,28 l 10,0 M 34,28 l 10,0" stroke="${accent}" stroke-width="4"/>
    <path d="M -58,58 L -70,86 M 58,58 L 70,86" stroke="${ink}" stroke-width="3"/>
    <path d="M -86,92 L 86,92 M -94,102 L 94,102" stroke="${accent}" stroke-width="1.2" opacity="0.6"/>
    <path d="M -78,-24 l 14,0 M -78,-14 l 14,0 M 64,-24 l 14,0 M 64,-14 l 14,0" stroke="${accent}" stroke-width="1.4" opacity="0.7"/>
    <text x="0" y="36" font-family="${FONT}" font-size="11" fill="${ink}" text-anchor="middle" stroke="none">M</text>
  </g>`;
}

function motifPenguin(accent, ink) {
  return `<g stroke="${ink}" stroke-width="2.2" fill="none" stroke-linecap="round">
    <ellipse cx="0" cy="4" rx="50" ry="72" fill="${tint(accent, 0.5)}" fill-opacity="0.66"/>
    <ellipse cx="0" cy="14" rx="30" ry="50" fill="${WHITE}" fill-opacity="0.78" stroke="${accent}"/>
    <path d="M -50,-22 C -76,-8 -82,26 -64,44 C -54,54 -44,42 -46,26" fill="${tint(accent, 0.3)}" fill-opacity="0.6"/>
    <path d="M 50,-22 C 76,-8 82,26 64,44 C 54,54 44,42 46,26" fill="${tint(accent, 0.3)}" fill-opacity="0.6"/>
    <circle cx="-14" cy="-30" r="4" fill="${ink}" stroke="none"/>
    <circle cx="14" cy="-30" r="4" fill="${ink}" stroke="none"/>
    <path d="M -6,-18 L 0,-10 L 6,-18 Z" fill="${accent}" stroke="${accent}"/>
    <path d="M -18,4 l 36,0" stroke="${accent}" stroke-width="1.2" opacity="0.7"/>
    <path d="M -16,54 l 6,14 M 16,54 l -6,14" stroke="${accent}" stroke-width="2"/>
    <path d="M -30,-58 l 8,-14 l 8,10 l 8,-14 l 8,12 l 8,-10 l 6,16" stroke="${accent}" stroke-width="1.4" opacity="0.7"/>
  </g>`;
}

function motifRose(accent, ink) {
  return `<g stroke="${ink}" stroke-width="2.2" fill="none" stroke-linecap="round">
    <path d="M 0,30 C -4,62 -12,88 -6,118" stroke="${ink}" stroke-width="2.6"/>
    <path d="M -6,74 C -32,62 -48,40 -44,26 C -22,30 -8,48 -6,74 Z" fill="${tint(accent, 0.3)}" fill-opacity="0.55" stroke="${accent}"/>
    <path d="M -8,96 C 18,84 36,62 34,46 C 12,50 -2,68 -8,96 Z" fill="${tint(accent, 0.45)}" fill-opacity="0.5" stroke="${accent}"/>
    <path d="M 0,24 C -48,18 -58,-30 -30,-54 C 0,-80 48,-60 46,-22 C 44,4 22,18 0,24 Z" fill="${tint(accent, 0.35)}" fill-opacity="0.55"/>
    <path d="M 0,10 C -24,4 -30,-24 -14,-38 C 4,-52 32,-38 30,-16 C 28,-2 16,6 0,10 Z" stroke="${accent}" stroke-width="1.6"/>
    <path d="M 0,-4 C -12,-8 -14,-24 -4,-28 C 8,-32 18,-22 16,-10 C 14,-2 8,0 0,-4 Z" stroke="${accent}" stroke-width="1.4"/>
    <path d="M -6,52 l -18,8 M -8,82 l 20,8" stroke="${accent}" stroke-width="1"/>
  </g>`;
}

function motifHoodie(accent, ink) {
  return `<g stroke="${ink}" stroke-width="2.2" fill="none" stroke-linejoin="round" stroke-linecap="round">
    <path d="M -50,-58 C -28,-82 28,-82 50,-58 L 66,-30 L 74,50 L 48,58 L 42,4 L 44,76 L -44,76 L -42,4 L -48,58 L -74,50 L -66,-30 Z" fill="${tint(accent, 0.45)}" fill-opacity="0.5"/>
    <path d="M -50,-58 C -24,-36 24,-36 50,-58 C 32,-72 -32,-72 -50,-58 Z" fill="${tint(accent, 0.3)}" fill-opacity="0.6"/>
    <path d="M -24,-42 L -26,22 M 24,-42 L 26,22" stroke="${accent}" stroke-width="1.4"/>
    <path d="M -24,-42 l 0,9 M 24,-42 l 0,9" stroke="${accent}" stroke-width="3"/>
    <path d="M -26,34 L 26,34 L 30,58 L -30,58 Z" stroke="${accent}" stroke-width="1.4"/>
    <path d="M 58,20 C 82,0 94,-28 86,-52 M 78,-32 C 90,-42 102,-44 112,-40 M 84,-46 C 74,-58 72,-70 76,-82" stroke="${accent}" stroke-width="1.5"/>
    <circle cx="108" cy="-38" r="7" fill="${tint(accent, 0.4)}" stroke="${accent}"/>
    <circle cx="76" cy="-84" r="6" fill="${tint(accent, 0.6)}" stroke="${accent}"/>
  </g>`;
}

function motifClock(accent, ink) {
  return `<g stroke="${ink}" stroke-width="2.2" fill="none" stroke-linecap="round">
    <rect x="-72" y="-36" width="144" height="92" rx="18" fill="${tint(accent, 0.35)}" fill-opacity="0.55"/>
    <circle cx="0" cy="10" r="34" fill="${WHITE}" fill-opacity="0.78" stroke="${accent}"/>
    <path d="M 0,10 L -15,-7 M 0,10 L 21,1" stroke="${ink}" stroke-width="2.6"/>
    <path d="M 0,10 L 18,16" stroke="${accent}" stroke-width="1.6" stroke-dasharray="2 4"/>
    <circle cx="0" cy="10" r="3" fill="${accent}" stroke="none"/>
    <path d="M -28,-30 l 0,8 M -14,-30 l 0,6 M 0,-30 l 0,8 M 14,-30 l 0,6 M 28,-30 l 0,8" stroke="${accent}" stroke-width="1.2"/>
    <path d="M -77,16 l -12,0 M 65,16 l 12,0" stroke="${accent}" stroke-width="3"/>
    <path d="M -48,56 C -30,44 -10,46 2,56 C 18,44 38,44 54,56" stroke="${accent}" stroke-width="1.2" opacity="0.7"/>
  </g>`;
}

function motifLetter(accent, ink) {
  return `<g stroke="${ink}" stroke-width="2.2" fill="none" stroke-linejoin="round" stroke-linecap="round">
    <rect x="-76" y="-22" width="152" height="92" rx="4" fill="${tint(accent, 0.3)}" fill-opacity="0.65" stroke="${accent}"/>
    <path d="M -76,-22 L 0,38 L 76,-22" stroke="${accent}" stroke-width="1.6"/>
    <path d="M -58,-22 L -58,-74 L 58,-74 L 58,-22" fill="${WHITE}" fill-opacity="0.7"/>
    <path d="M -42,-56 L 30,-56 M -42,-44 L 38,-44 M -42,-32 L 12,-32" stroke="${accent}" stroke-width="1.1"/>
    <path d="M 84,-92 L 138,-56 L 84,-20 L 74,-56 Z" fill="${tint(accent, 0.55)}" fill-opacity="0.5" stroke="${accent}"/>
    <path d="M 84,-92 L 74,-56 L 84,-20 M 84,-92 L 108,-58 L 74,-56" stroke="${accent}" stroke-width="1"/>
    <path d="M -58,-98 C -20,-110 22,-108 56,-94" stroke="${accent}" stroke-width="1.2" stroke-dasharray="2 8" opacity="0.7"/>
    <path d="M 66,-98 C 76,-106 86,-108 96,-102" stroke="${accent}" stroke-width="1.2" stroke-dasharray="2 8" opacity="0.5"/>
  </g>`;
}

function motifCraneFinal(accent, ink) {
  return `<g stroke="${ink}" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round">
    <polygon points="0,-60 60,-18 22,4 52,52 -6,40 -18,12 -68,36 -36,-2 -56,-32" fill="${tint(accent, 0.3)}" fill-opacity="0.5"/>
    <path d="M 0,-60 L 20,-30 L -6,-16 Z" fill="${tint(accent, 0.55)}" fill-opacity="0.55"/>
    <path d="M 60,-18 L 20,-30 M -36,-2 L -6,-16 M -56,-32 L -36,-2 L -68,36 M -18,12 L -6,40 L 52,52" fill="none"/>
    <path d="M 0,-60 C -6,-44 -14,-36 -6,-24" fill="none" stroke="${accent}" stroke-width="1.4" stroke-dasharray="2 5"/>
    <path d="M 38,10 C 18,18 8,32 12,48" fill="none" stroke="${accent}" stroke-width="1.5" stroke-dasharray="2 6"/>
    <circle cx="0" cy="-63" r="2.6" fill="${accent}" stroke="none"/>
    <path d="M -80,-52 l 8,12 l 12,8 l -12,8 l -8,12 l -8,-12 l -12,-8 l 12,-8 Z" fill="${tint(accent, 0.4)}" stroke="${accent}" stroke-width="1"/>
    <path d="M 76,4 l 5,8 l 8,5 l -8,5 l -5,8 l -5,-8 l -8,-5 l 8,-5 Z" fill="${tint(accent, 0.4)}" stroke="${accent}" stroke-width="1"/>
  </g>`;
}

function motif(kind, accent) {
  const ink = INK;
  switch (kind) {
    case 'crane': return motifCrane(accent, ink);
    case 'arrow': return motifArrow(accent, ink);
    case 'clover': return motifClover(accent, ink);
    case 'earbuds': return motifEarbuds(accent, ink);
    case 'clip': return motifClip(accent, ink);
    case 'cup': return motifCup(accent, ink);
    case 'sparrow': return motifSparrow(accent, ink);
    case 'box': return motifBox(accent, ink);
    case 'phone': return motifPhone(accent, ink);
    case 'book': return motifBook(accent, ink);
    case 'figurine': return motifFigurine(accent, ink);
    case 'note': return motifNote(accent, ink);
    case 'bracelet': return motifBracelet(accent, ink);
    case 'petal': return motifPetal(accent, ink);
    case 'metro': return motifMetro(accent, ink);
    case 'penguin': return motifPenguin(accent, ink);
    case 'rose': return motifRose(accent, ink);
    case 'hoodie': return motifHoodie(accent, ink);
    case 'clock': return motifClock(accent, ink);
    case 'letter': return motifLetter(accent, ink);
    case 'final-crane': return motifCraneFinal(accent, ink);
    default: throw new Error(`Unknown motif: ${kind}`);
  }
}

const MOTIFS = [
  'crane', 'arrow', 'clover', 'earbuds', 'clip', 'cup', 'sparrow', 'box',
  'phone', 'book', 'figurine', 'note', 'bracelet', 'petal', 'metro',
  'penguin', 'rose', 'hoodie', 'clock', 'letter', 'final-crane',
];

/* --------------------------------------------------------------- chapter art */

function chapterCover(chapter) {
  const index = chapter.number - 1;
  const layout = LAYOUTS[index];
  const accent = chapter.accent;
  const id = `c${chapter.number}`;
  const rng = mulberry32(1000 + chapter.number * 7919);
  const alcove = familyBackground(layout.family, 1000, 1400, accent, rng, id);
  const act = config.acts.find((item) => item.id === chapter.actId);
  const actLabel = act.id === 'prologue' ? 'PROLOGUE' : `ACT ${act.roman} · ${act.title.toUpperCase()}`;
  const [nx, ny, ns, nrot] = layout.numeral;
  const [mx, my, ms] = layout.motif;
  const petals = [];

  for (const [bx, by, bs] of layout.bloom) {
    petals.push(cluster(bx, by, bs, rng() * 360, accent, rng, 0.82));
  }
  for (let i = 0; i < 8; i += 1) {
    const x = 60 + rng() * 880;
    const y = 180 + rng() * 900;
    petals.push(petal(x, y, 10 + rng() * 24, 24 + rng() * 46, rng() * 360, i % 2 ? tint(accent, 0.55) : accent, 0.2 + rng() * 0.25));
  }
  for (let i = 0; i < 4; i += 1) {
    petals.push(frost(100 + rng() * 800, 180 + rng() * 780, 22 + rng() * 38, tint(accent, 0.55), 0.3, rng, 1));
  }
  petals.push(spray(88 + rng() * 40, 1300, 1.35, -8 + rng() * 16, accent, rng, 0.55));
  petals.push(spray(930 - rng() * 40, 1320, 1.2, 188 + rng() * 14, accent, rng, 0.45));

  const title = `Chapter ${chapter.number} — ${chapter.title}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1400" width="1000" height="1400" role="img" aria-labelledby="${id}-title ${id}-desc">
<title id="${id}-title">${esc(title)}</title>
<desc id="${id}-desc">Chapter cover artwork: ${esc(actLabel)}${chapter.part ? `, ${esc(chapter.part)}` : ''}. ${esc(chapter.galleryPrompt)}</desc>
${defs(accent, id)}
${baseBackground(1000, 1400, accent, id)}
${alcove}
<g>${petals.join('\n')}</g>
<text x="${nx}" y="${ny}" font-family="${FONT}" font-size="${ns}" font-weight="700" fill="${accent}" fill-opacity="0.12" text-anchor="middle" transform="rotate(${nrot} ${nx} ${ny})">${chapter.number}</text>
<g transform="translate(${mx} ${my}) scale(${ms})">${motif(MOTIFS[index], accent)}</g>
</svg>
`;
}

/* ---------------------------------------------------------------- bloom art */

function bloomPlate(chapter) {
  const index = chapter.number - 1;
  const layout = LAYOUTS[index];
  const accent = chapter.accent;
  const id = `b${chapter.number}`;
  const rng = mulberry32(5000 + chapter.number * 6151);
  const backdrop = familyBackground(layout.family, 1200, 900, accent, rng, id);
  const parts = [];

  // Three oversized, translucent petals give the landscape plate a focal
  // gesture that is deliberately different from the portrait chapter cover.
  for (let i = 0; i < 3; i += 1) {
    parts.push(
      petal(
        230 + rng() * 740,
        230 + rng() * 420,
        72 + rng() * 62,
        166 + rng() * 94,
        -40 + rng() * 80,
        i === 1 ? tint(accent, 0.45) : accent,
        0.16 + rng() * 0.1,
      ),
    );
  }

  for (let i = 0; i < 6; i += 1) {
    const cx = 90 + rng() * 1020;
    const cy = 90 + rng() * 690;
    parts.push(cluster(cx, cy, 0.55 + rng() * 0.9, rng() * 360, accent, rng, 0.48 + rng() * 0.34));
  }
  for (let i = 0; i < 14; i += 1) {
    parts.push(
      petal(
        40 + rng() * 1120,
        70 + rng() * 770,
        12 + rng() * 38,
        30 + rng() * 70,
        rng() * 360,
        i % 3 === 0 ? tint(accent, 0.6) : i % 3 === 1 ? accent : LILAC,
        0.14 + rng() * 0.3,
      ),
    );
  }
  for (let i = 0; i < 7; i += 1) {
    parts.push(frost(60 + rng() * 1080, 70 + rng() * 720, 18 + rng() * 54, tint(accent, 0.6), 0.24 + rng() * 0.2, rng, 1));
  }
  for (let i = 0; i < 12; i += 1) {
    parts.push(star(40 + rng() * 1120, 50 + rng() * 730, 1.5 + rng() * 3.5, WHITE, 0.3 + rng() * 0.5));
  }
  parts.push(spray(70 + rng() * 90, 880, 1.25, -12 + rng() * 20, accent, rng, 0.5));
  parts.push(spray(1120 - rng() * 80, 900, 1.1, 176 + rng() * 18, accent, rng, 0.42));

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 900" width="1200" height="900" role="img" aria-labelledby="${id}-title ${id}-desc">
<title id="${id}-title">${esc(chapter.title)} — bloom plate</title>
<desc id="${id}-desc">Abstract botanical and frost artwork for chapter ${chapter.number}, ${esc(chapter.title)}. ${esc(chapter.galleryPrompt)}</desc>
${defs(accent, id)}
${baseBackground(1200, 900, accent, id)}
${backdrop}
${parts.join('\n')}
<rect x="28" y="28" width="1144" height="844" fill="none" stroke="${accent}" stroke-width="1" opacity="0.18"/>
<g transform="translate(1114 146) scale(0.5)" opacity="0.3">${motif(MOTIFS[index], accent)}</g>
<g>
  <text x="70" y="78" font-family="${FONT}" font-size="15" letter-spacing="5" fill="${accent}">CHAPTER ${String(chapter.number).padStart(2, '0')}</text>
  <line x1="70" y1="94" x2="170" y2="94" stroke="${accent}" stroke-width="1.2" opacity="0.7"/>
  ${textBlock(wrapTitle(chapter.title, 42), 70, 826, 27, INK, { weight: '400', lineHeight: 32 })}
  <text x="1130" y="826" font-family="${FONT}" font-size="11" letter-spacing="3" fill="${PLUM}" fill-opacity="0.6" text-anchor="end">BLOOM PLATE</text>
</g>
</svg>
`;
}

/* ---------------------------------------------------------------- relic art */

function shortRelic(chapter) {
  const meta = book.chapters.find((item) => item.number === chapter.number);
  const relic = meta && meta.relic ? meta.relic : '';
  return relic.split(' · Supporting:')[0].replace(/^the /i, 'The ').trim();
}

function relicPlate(chapter) {
  const index = chapter.number - 1;
  const accent = chapter.accent;
  const id = `r${chapter.number}`;
  const rng = mulberry32(9000 + chapter.number * 4513);
  const label = shortRelic(chapter);
  const parts = [];
  const spotX = 420 + rng() * 160;
  const spotY = 390 + rng() * 120;

  for (let i = 0; i < 7; i += 1) {
    parts.push(
      petal(
        150 + rng() * 700,
        170 + rng() * 560,
        16 + rng() * 34,
        34 + rng() * 60,
        rng() * 360,
        i % 2 ? tint(accent, 0.6) : accent,
        0.16 + rng() * 0.24,
      ),
    );
  }
  for (let i = 0; i < 3; i += 1) {
    parts.push(frost(180 + rng() * 640, 180 + rng() * 500, 26 + rng() * 40, tint(accent, 0.62), 0.28, rng, 1));
  }
  for (let i = 0; i < 9; i += 1) {
    parts.push(star(180 + rng() * 640, 160 + rng() * 520, 1.6 + rng() * 3, WHITE, 0.35 + rng() * 0.4));
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" width="1000" height="1000" role="img" aria-labelledby="${id}-title ${id}-desc">
<title id="${id}-title">${esc(chapter.title)} — relic plate</title>
<desc id="${id}-desc">Still-life relic artwork for chapter ${chapter.number}: ${esc(label)}. ${esc(chapter.galleryPrompt)}</desc>
${defs(accent, id)}
${baseBackground(1000, 1000, accent, id)}
<circle cx="${n(spotX)}" cy="${n(spotY)}" r="340" fill="url(#${id}-spot)" opacity="0.78"/>
<circle cx="${n(spotX)}" cy="${n(spotY)}" r="270" fill="none" stroke="${accent}" stroke-width="1" opacity="0.22" stroke-dasharray="2 12"/>
<circle cx="${n(spotX)}" cy="${n(spotY)}" r="318" fill="none" stroke="${accent}" stroke-width="0.8" opacity="0.14"/>
<rect width="1000" height="1000" fill="url(#${id}-vignette)"/>
${parts.join('\n')}
<ellipse cx="500" cy="776" rx="320" ry="34" fill="${shade(accent, 0.42)}" opacity="0.16"/>
<g transform="translate(500 492) scale(2.05)">${motif(MOTIFS[index], accent)}</g>
<g>
  <text x="60" y="72" font-family="${FONT}" font-size="14" letter-spacing="5" fill="${accent}">CHAPTER ${String(chapter.number).padStart(2, '0')} · RELIC</text>
  <line x1="60" y1="88" x2="182" y2="88" stroke="${accent}" stroke-width="1.2" opacity="0.7"/>
  ${textBlock(wrapTitle(chapter.title, 34), 60, 900, 30, INK, { weight: '400', lineHeight: 36 })}
  <text x="60" y="954" font-family="${FONT}" font-size="13" letter-spacing="2.5" fill="${PLUM}" fill-opacity="0.7">${esc(label.toUpperCase())}</text>
  <text x="940" y="954" font-family="${FONT}" font-size="11" letter-spacing="3" fill="${PLUM}" fill-opacity="0.55" text-anchor="end">${String(chapter.number).padStart(2, '0')} / 21</text>
</g>
</svg>
`;
}

/* -------------------------------------------------------------------- cover */

function coverArt() {
  const accent = '#D879A8';
  const id = 'cover';
  const rng = mulberry32(20261111);
  const parts = [];

  for (let i = 0; i < 9; i += 1) {
    const cx = 100 + rng() * 1000;
    const cy = 160 + rng() * 1300;
    parts.push(cluster(cx, cy, 0.48 + rng() * 0.8, rng() * 360, accent, rng, 0.3 + rng() * 0.32));
  }
  for (let i = 0; i < 16; i += 1) {
    parts.push(
      petal(
        40 + rng() * 1120,
        90 + rng() * 1420,
        13 + rng() * 40,
        38 + rng() * 86,
        rng() * 360,
        i % 3 === 0 ? tint(accent, 0.55) : i % 3 === 1 ? accent : LILAC,
        0.12 + rng() * 0.24,
      ),
    );
  }
  for (let i = 0; i < 8; i += 1) {
    parts.push(frost(70 + rng() * 1060, 100 + rng() * 1360, 20 + rng() * 46, tint(accent, 0.55), 0.25, rng, 1));
  }
  for (let i = 0; i < 18; i += 1) {
    parts.push(star(40 + rng() * 1120, 60 + rng() * 1440, 1.4 + rng() * 3, WHITE, 0.3 + rng() * 0.5));
  }

  const arcs = [];
  for (let i = 0; i < 4; i += 1) {
    arcs.push(ring(600, 810, 260 + i * 76, accent, 0.2 - i * 0.03, 1.2, i % 2 ? '2 12' : ''));
  }

  // The cover crane is a single, large focal drawing, so its line weight is
  // reduced relative to the smaller chapter motifs.
  const coverCrane = motifCraneFinal(accent, INK)
    .replaceAll('stroke-width="2.6"', 'stroke-width="1.7"')
    .replaceAll('stroke-width="1.5"', 'stroke-width="1.2"')
    .replaceAll('stroke-width="1.4"', 'stroke-width="1.1"');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1600" width="1200" height="1600" role="img" aria-labelledby="${id}-title ${id}-desc">
<title id="${id}-title">Perpetual Bloom and her Frozen Witness — cover</title>
<desc id="${id}-desc">Book cover: layered pink, white and purple botanical frost, a paper crane, and the title “Perpetual Bloom and her Frozen Witness”, a novel in twenty-one chapters by Me &amp; Sravz.</desc>
${defs(accent, id)}
${baseBackground(1200, 1600, accent, id)}
<path d="M 118 1500 L 118 640 A 482 482 0 0 1 1082 640 L 1082 1500 Z" fill="${tint(accent, 0.86)}" opacity="0.5"/>
<path d="M 174 1500 L 174 660 A 426 426 0 0 1 1026 660 L 1026 1500" fill="none" stroke="${accent}" stroke-width="1.4" opacity="0.34"/>
${arcs.join('')}
${parts.join('\n')}
<g transform="translate(600 810) scale(3.1)">${coverCrane}</g>
<g>
  <text x="600" y="188" font-family="${FONT}" font-size="18" letter-spacing="8" fill="${accent}" text-anchor="middle">A NOVEL IN TWENTY-ONE CHAPTERS</text>
  <line x1="440" y1="216" x2="760" y2="216" stroke="${accent}" stroke-width="1.2" opacity="0.6"/>
  <text x="600" y="300" font-family="${FONT}" font-size="96" font-weight="400" fill="${INK}" text-anchor="middle" letter-spacing="-1">Perpetual Bloom</text>
  <text x="600" y="386" font-family="${FONT}" font-size="58" font-style="italic" fill="${PLUM}" text-anchor="middle">and her</text>
  <text x="600" y="482" font-family="${FONT}" font-size="82" fill="${INK}" text-anchor="middle">Frozen Witness</text>
  <line x1="500" y1="522" x2="700" y2="522" stroke="${accent}" stroke-width="1.2" opacity="0.6"/>
  <text x="600" y="1234" font-family="${FONT}" font-size="25" font-style="italic" fill="${PLUM}" fill-opacity="0.82" text-anchor="middle">Some love stories are kept in objects;</text>
  <text x="600" y="1272" font-family="${FONT}" font-size="25" font-style="italic" fill="${PLUM}" fill-opacity="0.82" text-anchor="middle">this one is kept in frost and bloom.</text>
  <line x1="520" y1="1322" x2="680" y2="1322" stroke="${accent}" stroke-width="1" opacity="0.5"/>
  <text x="600" y="1438" font-family="${FONT}" font-size="22" letter-spacing="4" fill="${PLUM}" text-anchor="middle">ME &amp; SRAVZ</text>
</g>
</svg>
`;
}

/* ---------------------------------------------------------------------- run */

function build() {
  const files = [];

  const write = (file, contents) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (!contents.includes('<svg')) throw new Error(`Not SVG: ${file}`);
    if (!contents.trimEnd().endsWith('</svg>')) throw new Error(`Unclosed SVG: ${file}`);
    const bytes = Buffer.byteLength(contents, 'utf8');
    if (bytes > 80 * 1024) throw new Error(`SVG too large (${bytes} bytes): ${file}`);
    fs.writeFileSync(file, contents, 'utf8');
    files.push({ file, bytes });
  };

  write(path.join(ART_DIR, 'cover.svg'), coverArt());
  for (const chapter of config.chapters) {
    const padded = String(chapter.number).padStart(2, '0');
    write(path.join(CHAPTER_DIR, `chapter-${padded}.svg`), chapterCover(chapter));
    write(path.join(GALLERY_DIR, `chapter-${padded}-bloom.svg`), bloomPlate(chapter));
    write(path.join(GALLERY_DIR, `chapter-${padded}-relic.svg`), relicPlate(chapter));
  }

  const total = files.reduce((sum, item) => sum + item.bytes, 0);
  console.log(`Wrote ${files.length} SVG files (${(total / 1024).toFixed(1)} KiB total).`);
  for (const item of files) {
    console.log(`${String(item.bytes).padStart(6)} bytes  ${path.relative(ROOT, item.file)}`);
  }
}

build();
