#!/usr/bin/env node
/**
 * Validate the generated story data, soundtrack config and chapter artwork.
 *
 * Run after `node scripts/build-content.mjs` and `node scripts/build-art.mjs`:
 *   node scripts/validate-content.mjs
 *
 * The validator uses only Node built-ins. It has a small XML well-formedness
 * checker so the SVGs can be verified without adding dependencies.
 */

import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/* content/book.json is the plaintext source of truth. It is validated here
   but never served (see server.mjs + .vercelignore). */
const BOOK_FILE = path.join(ROOT, 'content', 'book.json');
const ENC_FILE = path.join(ROOT, 'data', 'book.enc.json');
const LEGACY_PLAINTEXT_FILE = path.join(ROOT, 'data', 'book.json');
const CONFIG_FILE = path.join(ROOT, 'data', 'story.config.json');
const ART_DIR = path.join(ROOT, 'assets', 'art');

const EXPECTED_WORDS = {
  1: 4633,
  2: 4535,
  3: 3843,
  4: 4502,
  5: 4322,
  6: 4417,
  7: 5080,
  8: 3381,
  9: 2735,
  10: 3944,
  11: 3047,
  12: 2673,
  13: 3620,
  14: 3188,
  15: 2602,
  16: 4212,
  17: 5423,
  18: 7049,
  19: 4059,
  20: 4185,
  21: 4396,
};
const EXPECTED_TOTAL = 85846;
const EXPECTED_TITLES = [
  'The Book That Introduced Her to Him',
  'The Arrow That Became a Heart',
  'The Clover and the Home',
  'The Things She Could Not Replace',
  'The Hair Clip at 7:02',
  'The First Sip',
  'The Sparrows That Kept Getting Up',
  'The Memory Box',
  'The Sentence "I Noticed"',
  '4:11',
  'The Goku Figurine',
  'The Hot Pink Note',
  'The Bracelet and the Dried Petals',
  'The Dried Petal Returns',
  'The First Metro',
  'The Penguin in the Pocket',
  'The Rose That Knows It Will Wilt',
  'The Hoodie, the Straw, and the Bouquet',
  '7:02 / 7:03',
  'The Letter That Crosses Distance',
  'The Folding of the Final Crane',
];
const MODES = new Set([
  'majorPentatonic',
  'minorPentatonic',
  'ionian',
  'dorian',
  'aeolian',
  'lydian',
  'phrygian',
  'mixolydian',
]);
const PAD_WAVES = new Set(['sine', 'triangle', 'sawtooth']);
const CHIME_WAVES = new Set(['sine', 'triangle']);
const STRUCTURAL = [
  { pattern: /END OF CHAPTER/i, label: 'END marker' },
  { pattern: /Object anchor:/i, label: 'object-anchor metadata' },
  { pattern: /\bSupporting:\s/, label: 'supporting metadata' },
  { pattern: /^ACT (?:I|II|III|IV):/, label: 'act label' },
  { pattern: /^THE WITNESS AND THE BLOOM$/, label: 'part label' },
  { pattern: /^Chapter \d+$/, label: 'chapter heading' },
];

const failures = [];
const notes = [];

function fail(message) {
  failures.push(message);
}

function check(condition, message) {
  if (!condition) fail(message);
  return condition;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    fail(`Cannot parse ${path.relative(ROOT, file)}: ${error.message}`);
    return null;
  }
}

function exists(relativePath) {
  return fs.existsSync(path.join(ROOT, relativePath));
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Minimal XML well-formedness check: one root, balanced tags, no raw '<' in
 * text, no unescaped ampersands, and quoted attributes. It is deliberately
 * conservative; all generated SVG should satisfy it.
 */
function checkXml(text, label) {
  const badAmpersand = /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/;
  if (badAmpersand.test(text)) fail(`${label}: unescaped ampersand`);
  if (!/\bsvg\b/.test(text.slice(0, 400))) fail(`${label}: missing svg root`);
  if (!/<title[\s>]/.test(text)) fail(`${label}: missing <title>`);

  const stack = [];
  let roots = 0;
  let cursor = 0;
  let matches = 0;
  const tag = /<\/?([A-Za-z_][\w:.-]*)(?:\s[^<>]*?)?\/?>/g;
  let match;
  while ((match = tag.exec(text)) !== null) {
    const between = text.slice(cursor, match.index);
    if (between.includes('<')) fail(`${label}: raw '<' in text`);
    const raw = match[0];
    const name = match[1];
    const closing = raw.startsWith('</');
    const selfClosing = /\/>$/.test(raw);
    if (closing) {
      if (stack.length === 0) {
        fail(`${label}: closing </${name}> with no open tag`);
      } else {
        const open = stack.pop();
        if (open !== name) fail(`${label}: </${name}> closes <${open}>`);
      }
    } else if (!selfClosing) {
      if (stack.length === 0) roots += 1;
      stack.push(name);
    }
    cursor = tag.lastIndex;
    matches += 1;
  }
  const tail = text.slice(cursor);
  if (tail.includes('<')) fail(`${label}: raw '<' after final tag`);
  if (matches === 0) fail(`${label}: no XML tags`);
  if (stack.length) fail(`${label}: unclosed <${stack[stack.length - 1]}>`);
  if (roots !== 1) fail(`${label}: expected one root element, found ${roots}`);
  if (!text.trimEnd().endsWith('</svg>')) fail(`${label}: does not end with </svg>`);
}

/* The served envelope must be ciphertext only and must match the current
   plaintext source. Decryption itself is exercised at runtime (and by the
   browser QA); here we verify the envelope shape, KDF strength, freshness
   against content/book.json, and that no title or marker leaks in. */
function checkSealedEnvelope() {
  let envelope;
  try {
    envelope = JSON.parse(fs.readFileSync(ENC_FILE, 'utf8'));
  } catch (error) {
    fail(`Cannot parse data/book.enc.json: ${error.message}. Regenerate with PB_PASSCODE='<edition-passcode>' node scripts/encrypt-book.mjs`);
    return;
  }

  check(envelope.version === 1, 'book.enc.json: version must be 1');
  check(envelope.algorithm === 'AES-256-GCM', 'book.enc.json: algorithm must be AES-256-GCM');
  check(envelope.kdf === 'PBKDF2-SHA256', 'book.enc.json: kdf must be PBKDF2-SHA256');
  check(
    Number.isInteger(envelope.iterations) && envelope.iterations >= 210000,
    `book.enc.json: iterations must be >= 210000 (found ${envelope.iterations})`
  );

  const salt = Buffer.from(envelope.salt || '', 'base64');
  const iv = Buffer.from(envelope.iv || '', 'base64');
  const sealed = Buffer.from(envelope.ciphertext || '', 'base64');
  check(salt.length === 16, `book.enc.json: salt must be 16 bytes (found ${salt.length})`);
  check(iv.length === 12, `book.enc.json: iv must be 12 bytes (found ${iv.length})`);
  check(sealed.length > 100000, `book.enc.json: ciphertext is suspiciously small (${sealed.length} bytes)`);

  const raw = fs.readFileSync(ENC_FILE, 'utf8');
  for (const title of EXPECTED_TITLES) {
    check(!raw.includes(title), `book.enc.json leaks chapter title "${title}"`);
  }
  check(!/END OF CHAPTER/i.test(raw), 'book.enc.json leaks structural markers');

  let plaintextBytes = null;
  try {
    plaintextBytes = fs.readFileSync(BOOK_FILE);
  } catch (error) {
    fail(`Cannot read content/book.json: ${error.message}`);
    return;
  }
  const sha = createHash('sha256').update(plaintextBytes).digest('hex');
  check(
    Boolean(envelope.plaintext) && envelope.plaintext.sha256 === sha,
    'book.enc.json is stale: sha256 does not match content/book.json — re-run PB_PASSCODE=\'<edition-passcode>\' node scripts/encrypt-book.mjs'
  );
  check(
    Boolean(envelope.plaintext) && envelope.plaintext.bytes === plaintextBytes.length,
    'book.enc.json plaintext byte count does not match content/book.json'
  );
}

function main() {
  /* The plaintext novel must never ship in the served data/ tree. */
  check(!fs.existsSync(LEGACY_PLAINTEXT_FILE), 'data/book.json must not exist: plaintext is never served (see content/book.json + data/book.enc.json)');

  const book = readJson(BOOK_FILE);
  const config = readJson(CONFIG_FILE);
  if (!book || !config) return;

  checkSealedEnvelope();

  /* ------------------------------------------------------------- metadata */

  check(book.meta && book.meta.title === 'Perpetual Bloom and her Frozen Witness', 'book.meta.title is wrong');
  check(book.meta && book.meta.source === 'Novel Draft(Me and Sravz).pdf', 'book.meta.source is wrong');
  check(book.meta && book.meta.chapterCount === 21, 'book.meta.chapterCount must be 21');
  check(book.meta && book.meta.wordCount === EXPECTED_TOTAL, `book.meta.wordCount must be ${EXPECTED_TOTAL}`);
  check(book.meta && !Number.isNaN(Date.parse(book.meta.generatedAt)), 'book.meta.generatedAt is not a date');

  const meta = config.meta || {};
  check(meta.title === 'Perpetual Bloom and her Frozen Witness', 'config.meta.title is wrong');
  check(meta.subtitle === 'A novel in twenty-one chapters', 'config.meta.subtitle is wrong');
  check(meta.authors === 'Me and Sravz', 'config.meta.authors is wrong');
  check(meta.wordCount === EXPECTED_TOTAL, `config.meta.wordCount must be ${EXPECTED_TOTAL}`);
  check(meta.chapterCount === 21, 'config.meta.chapterCount must be 21');
  check(meta.openingQuote === 'You came, you saw, and somehow you conquered the part of me that had forgotten how to be gentle.', 'config.meta.openingQuote must match Chapter 1');
  check(typeof meta.tagline === 'string' && meta.tagline.length > 10, 'config.meta.tagline is missing');
  check(typeof meta.description === 'string' && meta.description.length > 40, 'config.meta.description is missing');
  check(meta.coverArt === 'assets/art/cover.svg', 'config.meta.coverArt must be assets/art/cover.svg');
  check(meta.credits && typeof meta.credits === 'object', 'config.meta.credits is missing');
  check(Array.isArray(meta.notes) && meta.notes.length > 0, 'config.meta.notes is missing');

  /* -------------------------------------------------------------- chapters */

  check(Array.isArray(book.chapters) && book.chapters.length === 21, 'book.json must contain 21 chapters');
  check(Array.isArray(config.chapters) && config.chapters.length === 21, 'config must contain 21 chapters');
  if (!Array.isArray(book.chapters) || !Array.isArray(config.chapters)) return;

  const wordRows = [];
  let total = 0;
  for (let index = 0; index < 21; index += 1) {
    const number = index + 1;
    const chapter = book.chapters[index] || {};
    const chapterConfig = config.chapters[index] || {};
    const expected = EXPECTED_WORDS[number];

    check(chapter.number === number, `book chapter ${number}: number is ${chapter.number}`);
    check(chapterConfig.number === number, `config chapter ${number}: number is ${chapterConfig.number}`);
    check(chapter.title === EXPECTED_TITLES[index], `book chapter ${number}: title "${chapter.title}" does not match the printed heading`);
    check(chapterConfig.title === EXPECTED_TITLES[index], `config chapter ${number}: title "${chapterConfig.title}" does not match the printed heading`);
    check(chapter.title === chapterConfig.title, `chapter ${number}: book/config titles differ`);

    const words = Array.isArray(chapter.paragraphs)
      ? chapter.paragraphs.reduce((sum, paragraph) => sum + (paragraph.trim() ? paragraph.trim().split(/\s+/).length : 0), 0)
      : -1;
    check(words === expected, `chapter ${number}: body words ${words} != ${expected}`);
    check(chapter.wordCount === expected, `chapter ${number}: stored wordCount ${chapter.wordCount} != ${expected}`);
    check(chapterConfig.wordCount === expected, `config chapter ${number}: wordCount ${chapterConfig.wordCount} != ${expected}`);
    total += words;
    wordRows.push({ number, words, expected, ok: words === expected });

    check(Array.isArray(chapter.paragraphs) && chapter.paragraphs.length > 0, `chapter ${number}: no paragraphs`);
    if (Array.isArray(chapter.paragraphs)) {
      for (const paragraph of chapter.paragraphs) {
        check(typeof paragraph === 'string' && paragraph.trim().length > 0, `chapter ${number}: empty/non-string paragraph`);
        for (const rule of STRUCTURAL) {
          check(!rule.pattern.test(paragraph), `chapter ${number}: ${rule.label} leaked into prose`);
        }
      }
    }

    if (number <= 2) {
      check(chapter.date === null, `chapter ${number}: date must be null`);
      check(chapter.relic === null, `chapter ${number}: relic must be null`);
    } else {
      check(typeof chapter.date === 'string' && chapter.date.length > 5, `chapter ${number}: missing date`);
      check(typeof chapter.relic === 'string' && chapter.relic.length > 5, `chapter ${number}: missing relic`);
    }
    check(chapterConfig.date === chapter.date, `chapter ${number}: config date differs from book`);
    check(chapterConfig.relic === chapter.relic, `chapter ${number}: config relic differs from book`);

    const expectedPart = number === 17 || number === 21 ? 'The Witness and the Bloom' : null;
    check(chapter.part === expectedPart, `chapter ${number}: book part must be ${JSON.stringify(expectedPart)}`);
    check(chapterConfig.part === expectedPart, `chapter ${number}: config part must be ${JSON.stringify(expectedPart)}`);

    const padded = String(number).padStart(2, '0');
    check(chapterConfig.coverArt === `assets/art/chapters/chapter-${padded}.svg`, `chapter ${number}: coverArt path is wrong`);
    check(
      Array.isArray(chapterConfig.galleryPlates) &&
        chapterConfig.galleryPlates.length === 2 &&
        chapterConfig.galleryPlates[0] === `assets/art/gallery/chapter-${padded}-bloom.svg` &&
        chapterConfig.galleryPlates[1] === `assets/art/gallery/chapter-${padded}-relic.svg`,
      `chapter ${number}: galleryPlates paths are wrong`,
    );
    check(typeof chapterConfig.galleryPrompt === 'string' && chapterConfig.galleryPrompt.length > 20, `chapter ${number}: galleryPrompt is missing`);
    check(/^#[0-9A-Fa-f]{6}$/.test(chapterConfig.accent || ''), `chapter ${number}: accent is not a hex colour`);
  }

  check(total === EXPECTED_TOTAL, `total body words ${total} != ${EXPECTED_TOTAL}`);
  check(new Set(config.chapters.map((chapter) => chapter.accent)).size === 21, 'chapter accents are not unique');

  /* ------------------------------------------------------------------ acts */

  const acts = Array.isArray(config.acts) ? config.acts : [];
  check(acts.length === 5, `config must have 5 acts, found ${acts.length}`);
  const actIds = ['prologue', 'act-1', 'act-2', 'act-3', 'act-4'];
  check(acts.map((act) => act.id).join(',') === actIds.join(','), 'act ids/order are wrong');
  const covered = acts.flatMap((act) => (Array.isArray(act.chapterNumbers) ? act.chapterNumbers : []));
  check(covered.length === 21, `acts cover ${covered.length} chapters, expected 21`);
  check(new Set(covered).size === 21, 'acts contain duplicate chapter numbers');
  for (let number = 1; number <= 21; number += 1) {
    check(covered.includes(number), `act chapterNumbers is missing chapter ${number}`);
    const act = acts.find((item) => item.chapterNumbers.includes(number));
    const chapterConfig = config.chapters[number - 1];
    check(act && chapterConfig.actId === act.id, `chapter ${number}: actId does not match its act's chapterNumbers`);
  }
  check(acts[0].roman === '—', 'prologue roman numeral must be —');
  check(acts.slice(1).map((act) => act.roman).join(',') === 'I,II,III,IV', 'act roman numerals must be I–IV');
  for (const act of acts) {
    for (const key of ['id', 'title', 'subtitle', 'blurb']) {
      check(typeof act[key] === 'string' && act[key].length > 0, `act ${act.id}: ${key} is missing`);
    }
  }

  /* ---------------------------------------------------------------- tracks */

  const tracks = Array.isArray(config.tracks) ? config.tracks : [];
  check(tracks.length === 21, `config must have 21 tracks, found ${tracks.length}`);
  const trackIds = new Set();
  const trackTitles = new Set();
  for (const track of tracks) {
    check(typeof track.id === 'string' && /^track-\d{2}$/.test(track.id), `track id ${track.id} is wrong`);
    check(!trackIds.has(track.id), `duplicate track id ${track.id}`);
    trackIds.add(track.id);
    check(Number.isInteger(track.number) && track.number >= 1 && track.number <= 21, `track ${track.id}: bad number`);
    check(track.id === `track-${String(track.number).padStart(2, '0')}`, `track ${track.id}: id does not match number`);
    check(typeof track.title === 'string' && track.title.length > 0, `track ${track.id}: missing title`);
    check(!trackTitles.has(track.title), `duplicate track title ${track.title}`);
    trackTitles.add(track.title);
    check(typeof track.mood === 'string' && track.mood.length > 0, `track ${track.id}: missing mood`);
    check(Number.isInteger(track.root) && track.root >= 24 && track.root <= 84, `track ${track.id}: root out of MIDI range`);
    check(MODES.has(track.mode), `track ${track.id}: mode ${track.mode} is not allowed`);
    check(isFiniteNumber(track.tempo) && track.tempo >= 44 && track.tempo <= 72, `track ${track.id}: tempo must be 44–72`);
    check(
      Array.isArray(track.chordProgression) &&
        track.chordProgression.length === 4 &&
        track.chordProgression.every((degree) => Number.isInteger(degree) && degree >= 0 && degree <= 6),
      `track ${track.id}: chordProgression must be four scale degrees 0–6`,
    );
    check(PAD_WAVES.has(track.padWave), `track ${track.id}: padWave ${track.padWave} is not allowed`);
    check(CHIME_WAVES.has(track.chimeWave), `track ${track.id}: chimeWave ${track.chimeWave} is not allowed`);
    check(isFiniteNumber(track.density) && track.density >= 0.08 && track.density <= 0.55, `track ${track.id}: density must be 0.08–0.55`);
    check(isFiniteNumber(track.brightness) && track.brightness >= 600 && track.brightness <= 2400, `track ${track.id}: brightness must be 600–2400`);
    check(isFiniteNumber(track.air) && track.air >= 0 && track.air <= 0.3, `track ${track.id}: air must be 0–0.3`);
    check(isFiniteNumber(track.bells) && track.bells >= 0 && track.bells <= 1, `track ${track.id}: bells must be 0–1`);
  }
  for (const chapter of config.chapters) {
    check(trackIds.has(chapter.trackId), `chapter ${chapter.number}: trackId ${chapter.trackId} does not resolve`);
    const track = tracks.find((item) => item.id === chapter.trackId);
    check(track && track.number === chapter.number, `chapter ${chapter.number}: track number does not match chapter`);
  }

  /* ------------------------------------------------------------------- art */

  const requiredArt = new Set(['assets/art/cover.svg']);
  for (const chapter of config.chapters) {
    requiredArt.add(chapter.coverArt);
    for (const plate of chapter.galleryPlates || []) requiredArt.add(plate);
  }
  for (const relative of requiredArt) {
    check(exists(relative), `missing artwork: ${relative}`);
  }

  const allSvgFiles = walk(ART_DIR).filter((file) => file.toLowerCase().endsWith('.svg'));
  const relativeSvg = allSvgFiles.map((file) => path.relative(ROOT, file).replaceAll('\\', '/'));
  check(allSvgFiles.length === 64, `expected 64 SVG files (1 cover + 21 chapter covers + 42 gallery plates), found ${allSvgFiles.length}`);
  for (const relative of requiredArt) {
    check(relativeSvg.includes(relative), `artwork not found on disk: ${relative}`);
  }
  for (const relative of relativeSvg) {
    check(requiredArt.has(relative), `unexpected/orphan artwork: ${relative}`);
  }

  for (const file of allSvgFiles) {
    const relative = path.relative(ROOT, file).replaceAll('\\', '/');
    const text = fs.readFileSync(file, 'utf8');
    const bytes = Buffer.byteLength(text, 'utf8');
    check(bytes < 80 * 1024, `${relative}: ${bytes} bytes exceeds the 80 KB budget`);
    check(!/^\uFEFF/.test(text), `${relative}: has a BOM`);
    check(!/<\s*script/i.test(text), `${relative}: contains a script`);
    check(!/<\s*image/i.test(text), `${relative}: contains an external image`);
    check(!/<\s*foreignObject/i.test(text), `${relative}: contains foreignObject`);
    check(!/\bhref\s*=/i.test(text), `${relative}: contains an href reference`);
    check(!/url\(\s*['"]?(?:https?:|data:|file:)/i.test(text), `${relative}: contains an external URL`);
    check(!/https?:\/\//i.test(text.replace('http://www.w3.org/2000/svg', '')), `${relative}: contains an external URL`);
    check(!/Math\.random|onload\s*=/i.test(text), `${relative}: contains executable/random content`);
    checkXml(text, relative);

    if (relative === 'assets/art/cover.svg') {
      check(/viewBox="0 0 1200 1600"/.test(text), 'cover.svg: expected 1200×1600 viewBox');
    } else if (relative.startsWith('assets/art/chapters/')) {
      check(/viewBox="0 0 1000 1400"/.test(text), `${relative}: expected 1000×1400 viewBox`);
    } else if (relative.startsWith('assets/art/gallery/') && relative.endsWith('-bloom.svg')) {
      check(/viewBox="0 0 1200 900"/.test(text), `${relative}: expected 1200×900 viewBox`);
    } else if (relative.startsWith('assets/art/gallery/') && relative.endsWith('-relic.svg')) {
      check(/viewBox="0 0 1000 1000"/.test(text), `${relative}: expected 1000×1000 viewBox`);
    } else {
      fail(`unexpected artwork path: ${relative}`);
    }
  }

  /* --------------------------------------------------------------- report */

  console.log('Word count verification');
  console.log('Ch  Words  Expected  Result');
  for (const row of wordRows) {
    console.log(
      `${String(row.number).padStart(2)}  ${String(row.words).padStart(5)}  ${String(row.expected).padStart(8)}  ${row.ok ? 'PASS' : 'FAIL'}`,
    );
  }
  console.log(`Total body words: ${total} / ${EXPECTED_TOTAL}`);
  console.log('');
  console.log(`Chapters: ${book.chapters.length}  Tracks: ${tracks.length}  Acts: ${acts.length}`);
  if (fs.existsSync(ENC_FILE)) {
    console.log(`Sealed envelope: data/book.enc.json (${(fs.statSync(ENC_FILE).size / 1024).toFixed(1)} KiB ciphertext, plaintext not served)`);
  }
  console.log(`SVG files checked: ${allSvgFiles.length} (1 cover + 21 chapter covers + 21 bloom plates + 21 relic plates)`);
  console.log(`Approx. total SVG size: ${(allSvgFiles.reduce((sum, file) => sum + fs.statSync(file).size, 0) / 1024).toFixed(1)} KiB`);
  if (notes.length) {
    console.log('');
    for (const note of notes) console.log(`NOTE: ${note}`);
  }

  if (failures.length) {
    console.error('');
    console.error(`${failures.length} validation failure(s):`);
    for (const failure of failures) console.error(` - ${failure}`);
    process.exitCode = 1;
  } else {
    console.log('');
    console.log('All checks passed.');
  }
}

main();
