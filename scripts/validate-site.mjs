#!/usr/bin/env node
/**
 * Validate the static reader shell: required files, local references,
 * runtime network isolation, module imports and edition assets.
 *
 * Run with: npm run validate:site
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = path.join(ROOT, 'index.html');

const failures = [];
let checks = 0;

function check(condition, message) {
  checks += 1;
  if (!condition) failures.push(message);
  return condition;
}

function relative(file) {
  return path.relative(ROOT, file).replaceAll(path.sep, '/');
}

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function exists(relativePath) {
  return fs.existsSync(path.join(ROOT, relativePath));
}

function checkFile(relativePath, label = relativePath) {
  return check(exists(relativePath), `Missing ${label}: ${relativePath}`);
}

function checkLocalReference(reference, baseFile) {
  const clean = reference.split(/[?#]/, 1)[0];
  if (!clean || clean.startsWith('#') || clean.startsWith('data:')) return true;
  if (/^[a-z][a-z\d+.-]*:/i.test(clean)) return true;
  const target = path.resolve(path.dirname(baseFile), clean);
  return check(fs.existsSync(target), `${relative(baseFile)} references missing ${relative(target)}`);
}

function stripSvgNamespace(text) {
  return text.replace(/https?:\/\/www\.w3\.org\/[^"'\s>]*/g, '');
}

try {
  const html = read(INDEX);
  const required = [
    'index.html',
    'server.mjs',
    'start.bat',
    'assets/css/base.css',
    'assets/css/landing.css',
    'assets/css/reader.css',
    'assets/js/app.js',
    'assets/js/data.js',
    'assets/js/landing.js',
    'assets/js/paginate.js',
    'assets/js/particles.js',
    'assets/js/reader.js',
    'assets/js/router.js',
    'assets/js/theme.js',
    'assets/js/utils.js',
    'assets/fonts/cormorant-garamond-normal.woff2',
    'assets/fonts/cormorant-garamond-italic.woff2',
    'assets/fonts/lora-normal.woff2',
    'assets/fonts/lora-italic.woff2',
    'assets/fonts/manrope-normal.woff2',
    'assets/fonts/OFL-cormorantgaramond.txt',
    'assets/fonts/OFL-lora.txt',
    'assets/fonts/OFL-manrope.txt',
    'data/book.json',
    'data/story.config.json'
  ];
  required.forEach((item) => checkFile(item));

  const keyIds = [
    'landing-view',
    'chapters',
    'loading-screen',
    'error-screen',
    'reader-view',
    'reader-stage',
    'book-stage',
    'spread-underlay',
    'reader-prev',
    'reader-next',
    'reader-error',
    'reader-error-retry',
    'reader-error-back',
    'page-slider',
    'settings-popover',
    'chapter-drawer',
    'ending-toast',
    'petal-canvas',
    'paginate-probe'
  ];
  for (const id of keyIds) {
    check(html.includes(`id="${id}"`), `index.html is missing #${id}`);
  }

  check(html.includes('assets/js/app.js'), 'index.html does not load assets/js/app.js');
  check(/<script type="module" src="assets\/js\/app\.js"><\/script>/.test(html), 'app.js must be loaded as a module');

  const htmlRefs = [...html.matchAll(/\b(?:href|src)="([^"]+)"/g)].map((match) => match[1]);
  htmlRefs.forEach((reference) => checkLocalReference(reference, INDEX));

  const cssFiles = ['assets/css/base.css', 'assets/css/landing.css', 'assets/css/reader.css'];
  for (const cssPath of cssFiles) {
    if (!exists(cssPath)) continue;
    const cssFile = path.join(ROOT, cssPath);
    const css = read(cssFile);
    check(!/@import\b/i.test(css), `${cssPath} uses @import; keep the stylesheet graph explicit`);
    /* Data URIs may contain url(#filter) internally; validate only real file links. */
    const cssForUrls = css
      .replace(/url\(\s*"data:[^"]*"\s*\)/g, 'url()')
      .replace(/url\(\s*'data:[^']*'\s*\)/g, 'url()');
    for (const match of cssForUrls.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) {
      checkLocalReference(match[2], cssFile);
    }
  }

  const jsDir = path.join(ROOT, 'assets/js');
  const jsFiles = fs.readdirSync(jsDir).filter((name) => name.endsWith('.js'));
  for (const name of jsFiles) {
    const jsFile = path.join(jsDir, name);
    const source = read(jsFile);
    for (const match of source.matchAll(/\bfrom\s+['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const target = path.resolve(path.dirname(jsFile), match[1]);
      check(fs.existsSync(target), `${relative(jsFile)} imports missing ${relative(target)}`);
    }
    for (const match of source.matchAll(/\bimport\s+['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const target = path.resolve(path.dirname(jsFile), match[1]);
      check(fs.existsSync(target), `${relative(jsFile)} imports missing ${relative(target)}`);
    }
  }

  const runtimeFiles = [
    ...cssFiles.map((file) => path.join(ROOT, file)),
    ...jsFiles.map((name) => path.join(jsDir, name)),
    path.join(ROOT, 'data/book.json'),
    path.join(ROOT, 'data/story.config.json')
  ];
  for (const file of runtimeFiles) {
    if (!fs.existsSync(file)) continue;
    check(
      !/https?:\/\//.test(stripSvgNamespace(read(file))),
      `${relative(file)} contains an external runtime URL`
    );
  }

  const book = JSON.parse(read(path.join(ROOT, 'data/book.json')));
  const config = JSON.parse(read(path.join(ROOT, 'data/story.config.json')));
  check(book.chapters.length === 21, 'data/book.json must contain 21 chapters');
  check(config.chapters.length === 21, 'story.config.json must contain 21 chapter records');
  check(config.acts.length === 5, 'story.config.json must contain 5 acts');
  check(config.tracks.length === 21, 'story.config.json must contain 21 tracks');
  check(book.meta.wordCount === 85846, 'data/book.json must report 85,846 words');
  check(book.chapters.every((chapter) => Array.isArray(chapter.paragraphs) && chapter.paragraphs.length), 'Every chapter needs prose');
  check(config.chapters.every((chapter) => chapter.coverArt), 'Every chapter needs cover art');

  for (const chapter of config.chapters) {
    checkFile(chapter.coverArt, `Chapter ${chapter.number} cover`);
    check(Array.isArray(chapter.galleryPlates) && chapter.galleryPlates.length === 2, `Chapter ${chapter.number} needs two gallery plates`);
    for (const plate of chapter.galleryPlates || []) checkFile(plate, `Chapter ${chapter.number} gallery plate`);
  }

  for (const name of fs.readdirSync(path.join(ROOT, 'assets/fonts'))) {
    if (!name.endsWith('.woff2')) continue;
    const file = path.join(ROOT, 'assets/fonts', name);
    const magic = fs.readFileSync(file).subarray(0, 4).toString('ascii');
    check(magic === 'wOF2', `${name} is not a WOFF2 font`);
  }

  check(exists('assets/art/cover.svg'), 'Missing edition cover assets/art/cover.svg');
  check(!/<script[^>]+src=["']https?:/i.test(html), 'index.html must not load remote scripts');
  check(!/<link[^>]+href=["']https?:/i.test(html), 'index.html must not load remote styles or fonts');
} catch (error) {
  failures.push(`Site validation crashed: ${error.stack || error.message}`);
}

if (failures.length) {
  console.error(`Site validation failed (${failures.length} of ${checks} checks):`);
  for (const failure of failures) console.error(` - ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Site validation passed (${checks} checks).`);
  console.log('21 chapters · 5 acts · 21 tracks · 85,846 words · local assets only');
}
