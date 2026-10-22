/* Headless gallery smoke test for the end-of-chapter fan-art galleries.
   Uses the installed Microsoft Edge (or Chrome) through the Chrome DevTools
   Protocol. No test-runner dependencies are required.

   Run with: npm run qa:gallery */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..');
const ORIGIN = 'http://127.0.0.1:4173';
const SCREENSHOT_DIR = path.join(ROOT, 'qa', 'gallery');
const DB_NAME = 'perpetual-bloom-gallery';
const CHAPTER = 3;
const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const checks = [];

function pass(name, detail = '') {
  checks.push({ name, detail });
  console.log(`PASS  ${name}${detail ? ` — ${detail}` : ''}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForHttp(url, timeout = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {
      /* The server or browser is still starting. */
    }
    await sleep(120);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function startServer() {
  try {
    const response = await fetch(`${ORIGIN}/index.html`);
    if (response.ok) return { process: null, reused: true };
  } catch {
    /* Start our own server below. */
  }

  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: ROOT,
    env: { ...process.env, PORT: '4173' },
    stdio: 'ignore',
    windowsHide: true
  });
  await waitForHttp(`${ORIGIN}/index.html`);
  return { process: child, reused: false };
}

function findBrowser() {
  return EDGE_CANDIDATES.find((candidate) => fs.existsSync(candidate)) || null;
}

class CDPConnection {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = new Map();
    this.ws = null;
    this.opened = null;
  }

  connect() {
    this.ws = new WebSocket(this.url);
    this.opened = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', () => reject(new Error(`Could not connect to ${this.url}`)), {
        once: true
      });
    });
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
        else pending.resolve(message.result);
        return;
      }
      for (const handler of this.handlers.get(message.method) || []) {
        handler(message.params);
      }
    });
    return this.opened;
  }

  async send(method, params = {}, timeout = 12000) {
    await this.opened;
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, timeout);
      this.pending.set(id, {
        method,
        resolve(value) {
          clearTimeout(timer);
          resolve(value);
        },
        reject(error) {
          clearTimeout(timer);
          reject(error);
        }
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, handler) {
    if (!this.handlers.has(method)) this.handlers.set(method, new Set());
    this.handlers.get(method).add(handler);
    return () => this.handlers.get(method)?.delete(handler);
  }

  close() {
    try {
      this.ws?.close();
    } catch {
      /* Already closed. */
    }
  }
}

async function pageTarget(debugPort) {
  const start = Date.now();
  while (Date.now() - start < 12000) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      const targets = await response.json();
      const page = targets.find((target) => target.type === 'page' && target.url.startsWith(ORIGIN));
      if (page?.webSocketDebuggerUrl) return page;
    } catch {
      /* Browser is still starting. */
    }
    await sleep(150);
  }
  throw new Error('Could not find the browser page target');
}

class Page {
  constructor(cdp) {
    this.cdp = cdp;
    this.consoleErrors = [];
    this.pageErrors = [];
    this.externalRequests = [];
    this.failedRequests = [];
  }

  async attach() {
    await this.cdp.send('Page.enable');
    await this.cdp.send('Runtime.enable');
    await this.cdp.send('Network.enable');
    await this.cdp.send('Log.enable');
    await this.cdp.send('Page.bringToFront');
    await this.cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });

    this.cdp.on('Runtime.consoleAPICalled', (event) => {
      if (event.type !== 'error') return;
      const text = (event.args || [])
        .map((arg) => arg.value ?? arg.description ?? '')
        .filter(Boolean)
        .join(' ');
      this.consoleErrors.push(text || 'console.error');
    });

    this.cdp.on('Runtime.exceptionThrown', (event) => {
      const details = event.exceptionDetails || {};
      this.pageErrors.push(details.exception?.description || details.text || 'Uncaught page exception');
    });

    this.cdp.on('Log.entryAdded', (event) => {
      if (event.entry?.level === 'error') this.consoleErrors.push(event.entry.text);
    });

    this.cdp.on('Network.requestWillBeSent', (event) => {
      const url = event.request?.url || '';
      if (!/^https?:/i.test(url)) return;
      try {
        const parsed = new URL(url);
        if (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') {
          this.externalRequests.push(url);
        }
      } catch {
        this.externalRequests.push(url);
      }
    });

    this.cdp.on('Network.loadingFailed', (event) => {
      if (event.canceled) return;
      this.failedRequests.push(`${event.type || 'resource'} — ${event.errorText}`);
    });
  }

  async setViewport(width, height, { mobile = false } = {}) {
    await this.cdp.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile,
      screenWidth: width,
      screenHeight: height
    });
  }

  async evaluate(expression) {
    const result = await this.cdp.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true
    });
    if (result.exceptionDetails) {
      const details = result.exceptionDetails;
      throw new Error(details.exception?.description || details.text || 'Runtime.evaluate failed');
    }
    return result.result?.value;
  }

  async waitFor(expression, label, timeout = 9000) {
    const start = Date.now();
    let last = null;
    while (Date.now() - start < timeout) {
      try {
        last = await this.evaluate(expression);
        if (last) return last;
      } catch (error) {
        last = error.message;
      }
      await sleep(90);
    }
    throw new Error(`Timed out waiting for ${label}. Last value: ${JSON.stringify(last)}`);
  }

  async click(selector) {
    const result = await this.evaluate(`(() => {
      const node = document.querySelector(${JSON.stringify(selector)});
      if (!node) throw new Error('Missing click target: ${selector.replaceAll("'", "\\'")}');
      node.scrollIntoView({ block: 'center', inline: 'center' });
      const box = node.getBoundingClientRect();
      const visible = box.width > 0 && box.height > 0;
      const disabled = Boolean(node.disabled);
      if (visible && !disabled) {
        node.focus({ preventScroll: true });
        node.click();
      }
      return { width: box.width, height: box.height, disabled, visible };
    })()`);
    assert(!result.disabled, `${selector} is disabled`);
    assert(result.visible, `${selector} has no visible box`);
    await sleep(120);
  }

  async key(key, code, vk) {
    await this.cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key,
      code,
      windowsVirtualKeyCode: vk,
      nativeVirtualKeyCode: vk
    });
    await this.cdp.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key,
      code,
      windowsVirtualKeyCode: vk,
      nativeVirtualKeyCode: vk
    });
    await sleep(120);
  }

  async screenshot(name) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const result = await this.cdp.send('Page.captureScreenshot', {
      format: 'jpeg',
      quality: 88,
      captureBeyondViewport: false
    });
    const target = path.join(SCREENSHOT_DIR, name);
    fs.writeFileSync(target, Buffer.from(result.data, 'base64'));
    return target;
  }

  async galleryState() {
    return this.evaluate(`window.__pbGallery ? window.__pbGallery.getState() : null`);
  }
}

/* ---------- page-side fixtures and helpers ---------- */

const UPLOAD_EXPRESSION = (specs) => `(async () => {
  const input = document.querySelector('[data-gallery-input]');
  if (!input) throw new Error('No gallery file input');
  const specs = ${JSON.stringify(specs)};
  const transfer = new DataTransfer();
  for (const spec of specs) {
    let blob;
    if (spec.kind === 'valid') {
      const canvas = document.createElement('canvas');
      canvas.width = spec.width || 2400;
      canvas.height = spec.height || 1600;
      const context = canvas.getContext('2d');
      const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
      gradient.addColorStop(0, '#ffd9e1');
      gradient.addColorStop(1, '#8a2be2');
      context.fillStyle = gradient;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#ffffff';
      context.font = '160px serif';
      context.fillText(spec.label || 'Bloom', 90, 260);
      blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    } else if (spec.kind === 'invalid') {
      blob = new Blob([new Uint8Array([1, 2, 3, 4, 5, 6])], { type: 'text/plain' });
    } else if (spec.kind === 'oversize') {
      blob = new Blob([new Uint8Array(16 * 1024 * 1024)], { type: 'image/png' });
    }
    transfer.items.add(new File([blob], spec.name, { type: spec.type || blob.type }));
  }
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return transfer.files.length;
})()`;

const DB_SNAPSHOT = (chapter) => `new Promise((resolve, reject) => {
  const request = indexedDB.open(${JSON.stringify(DB_NAME)}, 1);
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    const db = request.result;
    let transaction;
    try {
      transaction = db.transaction('artworks', 'readonly');
    } catch (error) { reject(error); return; }
    const index = transaction.objectStore('artworks').index('chapter');
    const get = index.getAll(${JSON.stringify(chapter)});
    get.onsuccess = () => {
      const records = get.result || [];
      resolve({
        count: records.length,
        bytes: records.reduce((sum, record) => sum + (record.bytes || 0), 0),
        mimes: Array.from(new Set(records.map((record) => record.mime))),
        maxEdge: records.reduce((max, record) => Math.max(max, record.width || 0, record.height || 0), 0),
        titles: records.map((record) => record.title),
        artists: records.map((record) => record.artist)
      });
    };
    get.onerror = () => reject(get.error);
  };
})`;

async function main() {
  const browserPath = findBrowser();
  assert(browserPath, 'Microsoft Edge or Chrome was not found in its standard install path');

  const server = await startServer();
  const debugPort = await freePort();
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-gallery-qa-'));
  const browser = spawn(
    browserPath,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-sync',
      '--disable-features=Translate,MediaRouter,OptimizationHints',
      '--window-size=1440,1000',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${profileDir}`,
      `${ORIGIN}/index.html?qa=gallery#/`
    ],
    { stdio: 'ignore', windowsHide: true }
  );

  let cdp = null;
  let page = null;
  let exitCode = 0;

  const gotoGallery = async () => {
    await page.evaluate(`location.hash = '#/read/${CHAPTER}/gallery'`);
    await page.waitFor(`location.hash === '#/read/${CHAPTER}/gallery'`, 'the gallery route');
    await page.waitFor(
      `(() => {
        const state = window.__pbGallery?.getState();
        return state && state.mounted && state.chapter === ${CHAPTER} ? state : null;
      })()`,
      'the gallery to mount'
    );
    await page.waitFor(
      `document.querySelector('[data-gallery-host] .pb-gallery') !== null`,
      'the gallery host to render'
    );
  };

  try {
    const target = await pageTarget(debugPort);
    cdp = new CDPConnection(target.webSocketDebuggerUrl);
    await cdp.connect();
    page = new Page(cdp);
    await page.attach();
    await page.setViewport(1440, 1000);

    await page.waitFor(
      `document.documentElement.dataset.appReady === 'true' && Boolean(window.__pbGallery)`,
      'the application to boot with the gallery controller'
    );
    await sleep(400);

    await gotoGallery();
    const seeded = await page.evaluate(`({
      seeds: document.querySelectorAll('.pb-art--seed').length,
      badges: document.querySelectorAll('.pb-art--seed .pb-art__badge--original').length,
      empty: !document.querySelector('[data-gallery-empty]').hidden,
      dropzone: Boolean(document.querySelector('[data-gallery-dropzone]')?.getClientRects().length),
      addButton: Boolean(document.querySelector('[data-gallery-add]')?.getClientRects().length),
      heading: document.querySelector('.pb-gallery__user .pb-gallery__heading')?.textContent || ''
    })`);
    const initialState = await page.galleryState();
    assert(seeded.seeds === 2, `Expected 2 seeded plates, found ${seeded.seeds}`);
    assert(seeded.badges === 2, 'Seeded plates are missing the "Original plate" badge');
    assert(seeded.empty, 'The empty-state invitation is not visible');
    assert(seeded.dropzone, 'The upload dropzone is not visible');
    assert(seeded.addButton, 'The "Add images" button is not visible');
    assert(seeded.heading === 'Reader additions', `Unexpected section heading: ${seeded.heading}`);
    assert(initialState.userCount === 0, `Expected an empty gallery, found ${initialState.userCount}`);
    pass('Chapter 3 gallery shows two plates, the dropzone and the empty state');
    await page.screenshot('01-gallery-empty.jpg');

    /* Invalid type and oversize are rejected with a visible message. */
    await page.evaluate(UPLOAD_EXPRESSION([{ kind: 'invalid', name: 'notes.txt', type: 'text/plain' }]));
    await page.waitFor(
      `document.querySelector('.pb-gallery__feedback.is-error')?.textContent.length > 0`,
      'the invalid-type error'
    );
    const invalidMessage = await page.evaluate(`document.querySelector('.pb-gallery__feedback').textContent`);
    assert(/not a/i.test(invalidMessage), `Unexpected invalid-type message: ${invalidMessage}`);
    assert((await page.galleryState()).userCount === 0, 'An invalid file was stored');

    await page.evaluate(UPLOAD_EXPRESSION([{ kind: 'oversize', name: 'huge.png', type: 'image/png' }]));
    await page.waitFor(
      `document.querySelector('.pb-gallery__feedback.is-error')?.textContent.includes('15 MB')`,
      'the oversize error'
    );
    assert((await page.galleryState()).userCount === 0, 'An oversize file was stored');
    pass('Invalid type and oversize files are rejected visibly', invalidMessage.trim());

    /* Upload two real images through the file input/DataTransfer path. */
    const hashBeforeUpload = await page.evaluate(`location.hash`);
    await page.evaluate(
      UPLOAD_EXPRESSION([
        { kind: 'valid', name: 'clover_study.png', label: 'Clover', width: 3000, height: 2000 },
        { kind: 'valid', name: 'relic sketch.png', label: 'Relic', width: 1200, height: 1600 }
      ])
    );
    const afterUpload = await page.waitFor(
      `(() => {
        const state = window.__pbGallery.getState();
        return state.userCount === 2 ? state : null;
      })()`,
      'two uploaded artworks',
      12000
    );
    const uploadDom = await page.evaluate(`({
      cards: document.querySelectorAll('.pb-art--user').length,
      openButtons: document.querySelectorAll('.pb-art--user [data-open]').length,
      editButtons: document.querySelectorAll('.pb-art--user [data-edit]').length,
      deleteButtons: document.querySelectorAll('.pb-art--user [data-delete]').length,
      countText: document.querySelector('[data-gallery-count]')?.textContent || '',
      storageText: document.querySelector('[data-gallery-storage]')?.textContent || '',
      emptyHidden: document.querySelector('[data-gallery-empty]').hidden,
      objectUrls: Array.from(document.querySelectorAll('.pb-art--user img')).map((img) => img.src.startsWith('blob:')),
      hash: location.hash
    })`);
    const db = await page.evaluate(DB_SNAPSHOT(CHAPTER));
    assert(uploadDom.cards === 2, `Expected 2 user cards, found ${uploadDom.cards}`);
    assert(uploadDom.openButtons === 2 && uploadDom.editButtons === 2 && uploadDom.deleteButtons === 2, 'User cards are missing controls');
    assert(uploadDom.emptyHidden, 'The empty state is still visible after uploading');
    assert(/2 additions/.test(uploadDom.countText), `Unexpected count text: ${uploadDom.countText}`);
    assert(/Saved only in this browser/.test(uploadDom.storageText), `Unexpected storage note: ${uploadDom.storageText}`);
    assert(uploadDom.objectUrls.every(Boolean), 'User images are not using object URLs');
    assert(db.count === 2, `Expected 2 IndexedDB records, found ${db.count}`);
    assert(db.mimes.every((mime) => mime === 'image/webp' || mime === 'image/jpeg'), `Unexpected stored mime types: ${db.mimes}`);
    assert(db.maxEdge <= 1800, `Stored images were not downscaled (max edge ${db.maxEdge})`);
    assert(afterUpload.totalBytes > 0, 'Stored bytes were not reported');
    assert(hashBeforeUpload === uploadDom.hash, 'Uploading changed the reader route');
    pass('Images are optimised locally and stored in IndexedDB', `${db.mimes.join(', ')} · max edge ${db.maxEdge}px`);
    await page.screenshot('02-gallery-uploads.jpg');

    /* Lightbox: seeds and uploads share one sequence. */
    await page.click('.pb-art--seed [data-seed="0"]');
    await page.waitFor(`document.querySelector('.pb-lightbox')?.open === true`, 'the lightbox to open');
    const lightboxSeed = await page.evaluate(`({
      badge: document.querySelector('[data-lb-badge]').textContent,
      counter: document.querySelector('[data-lb-counter]').textContent
    })`);
    assert(lightboxSeed.badge === 'Original plate', `Unexpected lightbox badge: ${lightboxSeed.badge}`);
    assert(lightboxSeed.counter === '1 / 4', `Unexpected lightbox counter: ${lightboxSeed.counter}`);
    await page.key('ArrowRight', 'ArrowRight', 39);
    const afterArrow = await page.evaluate(`document.querySelector('[data-lb-counter]').textContent`);
    assert(afterArrow === '2 / 4', `Arrow key did not advance the lightbox (${afterArrow})`);
    await page.screenshot('03-gallery-lightbox.jpg');
    await page.key('Escape', 'Escape', 27);
    await page.waitFor(`document.querySelector('.pb-lightbox')?.open === false`, 'the lightbox to close with Escape');
    const focusReturned = await page.evaluate(
      `document.activeElement?.closest('.pb-art--seed')?.querySelector('[data-seed]')?.dataset.seed === '0'`
    );
    assert(focusReturned, 'Focus did not return to the seed plate that opened the lightbox');
    pass('Lightbox shows both plates, navigates with arrows and closes with Escape');

    await page.click('.pb-art--user [data-open]');
    await page.waitFor(`document.querySelector('.pb-lightbox')?.open === true`, 'the lightbox for user art');
    const fanBadge = await page.evaluate(`document.querySelector('[data-lb-badge]').textContent`);
    assert(fanBadge === 'Fan-art', `Unexpected user-art badge: ${fanBadge}`);
    await page.click('[data-lb-close]');
    await page.waitFor(`document.querySelector('.pb-lightbox')?.open === false`, 'the lightbox to close');
    pass('A user artwork opens in the lightbox and closes from its button');

    /* Edit and persist. */
    await page.click('.pb-art--user [data-edit]');
    await page.waitFor(`document.querySelector('.pb-editor')?.open === true`, 'the editor to open');
    await page.screenshot('04-gallery-editor.jpg');
    await page.evaluate(`(() => {
      const form = document.querySelector('.pb-editor__form');
      form.querySelector('[name="title"]').value = 'Starlight Clover';
      form.querySelector('[name="artist"]').value = 'Sravz';
      form.querySelector('[data-editor-save]').click();
    })()`);
    await page.waitFor(`document.querySelector('.pb-editor')?.open === false`, 'the editor to save and close');
    await page.waitFor(
      `Array.from(document.querySelectorAll('[data-artwork-title]')).some((node) => node.textContent === 'Starlight Clover')`,
      'the edited card title'
    );
    const editedDb = await page.evaluate(DB_SNAPSHOT(CHAPTER));
    assert(editedDb.titles.includes('Starlight Clover'), 'The edited title was not persisted');
    assert(editedDb.artists.includes('Sravz'), 'The edited artist was not persisted');
    pass('Editing a title and artist updates the card and IndexedDB');

    /* Persistence across a reload. */
    await page.cdp.send('Page.reload', { ignoreCache: true });
    await page.waitFor(
      `document.documentElement.dataset.appReady === 'true' && Boolean(window.__pbGallery)`,
      'the application to boot after reload'
    );
    await gotoGallery();
    await page.waitFor(
      `window.__pbGallery.getState().userCount === 2`,
      'uploads to persist across the reload',
      12000
    );
    const afterReload = await page.evaluate(`({
      titles: Array.from(document.querySelectorAll('[data-artwork-title]')).map((node) => node.textContent),
      storage: document.querySelector('[data-gallery-storage]').textContent
    })`);
    assert(afterReload.titles.includes('Starlight Clover'), 'Edited title did not survive the reload');
    assert(/Saved only in this browser/.test(afterReload.storage), 'Storage note missing after reload');
    pass('Uploads and edits persist across a reload');

    /* Delete both with the two-step confirmation. */
    const deleteButtons = await page.evaluate(`document.querySelectorAll('.pb-art--user [data-delete]').length`);
    for (let index = 0; index < deleteButtons; index += 1) {
      await page.click('.pb-art--user [data-delete]');
      const confirming = await page.evaluate(`document.querySelector('.pb-art--user [data-delete]')?.dataset.confirm`);
      assert(confirming === 'true', 'The first delete click did not ask for confirmation');
      await page.click('.pb-art--user [data-delete]');
      await page.waitFor(
        `!document.querySelector('.pb-art--user [data-delete]') || document.querySelectorAll('.pb-art--user').length === ${deleteButtons - index - 1}`,
        'a card to be removed'
      );
    }
    const finalState = await page.waitFor(
      `(() => {
        const state = window.__pbGallery.getState();
        return state.userCount === 0 ? state : null;
      })()`,
      'an empty gallery'
    );
    const finalDb = await page.evaluate(DB_SNAPSHOT(CHAPTER));
    const emptyVisible = await page.evaluate(`!document.querySelector('[data-gallery-empty]').hidden`);
    assert(finalDb.count === 0, `Expected 0 IndexedDB records, found ${finalDb.count}`);
    assert(emptyVisible, 'The empty state did not return after deleting every upload');
    assert(finalState.gridImages === 0, 'Object URLs were not released after deletion');
    pass('Two-step delete removes the records and restores the empty state');
    await page.screenshot('05-gallery-after-delete.jpg');

    /* Responsive layout and touch safety. */
    await page.evaluate(
      UPLOAD_EXPRESSION([{ kind: 'valid', name: 'mobile plate.png', label: 'Bloom', width: 1600, height: 1600 }])
    );
    await page.waitFor(`window.__pbGallery.getState().userCount === 1`, 'a fresh upload for responsive checks');

    const viewports = [
      { width: 1440, height: 900, name: '06-gallery-1440.jpg', mobile: false },
      { width: 1000, height: 900, name: '07-gallery-1000.jpg', mobile: false },
      { width: 390, height: 844, name: '08-gallery-mobile.jpg', mobile: true }
    ];

    for (const viewport of viewports) {
      await page.setViewport(viewport.width, viewport.height, { mobile: viewport.mobile });
      await sleep(320);
      const layout = await page.evaluate(`(() => {
        const add = document.querySelector('[data-gallery-add]');
        const bar = document.querySelector('#audio-bar');
        add.scrollIntoView({ block: 'center' });
        const addBox = add.getBoundingClientRect();
        const barBox = bar.getBoundingClientRect();
        const overlaps = !(addBox.bottom <= barBox.top || addBox.top >= barBox.bottom);
        return {
          overflow: document.documentElement.scrollWidth - window.innerWidth,
          addWidth: Math.round(addBox.width),
          addHeight: Math.round(addBox.height),
          overlapsBar: overlaps,
          barVisible: Boolean(bar.getClientRects().length)
        };
      })()`);
      assert(layout.overflow <= 1, `${viewport.width}px layout overflows by ${layout.overflow}px`);
      assert(layout.addWidth > 0 && layout.addHeight >= 34, `Upload button is too small at ${viewport.width}px`);
      assert(layout.barVisible, `The audio bar is missing at ${viewport.width}px`);
      assert(!layout.overlapsBar, `The upload button overlaps the audio bar at ${viewport.width}px`);
      await page.screenshot(viewport.name);
    }
    pass('Upload controls stay usable and clear of the audio bar at three widths');

    /* A horizontal swipe inside the gallery must not turn the page. */
    const hashBeforeSwipe = await page.evaluate(`location.hash`);
    await page.evaluate(`(() => {
      const target = document.querySelector('.pb-gallery__dropzone');
      const start = new Event('touchstart', { bubbles: true, cancelable: true });
      start.touches = [{ clientX: 320, clientY: 500 }];
      target.dispatchEvent(start);
      const end = new Event('touchend', { bubbles: true, cancelable: true });
      end.changedTouches = [{ clientX: 60, clientY: 505 }];
      target.dispatchEvent(end);
    })()`);
    await sleep(400);
    const hashAfterSwipe = await page.evaluate(`location.hash`);
    const pageType = await page.evaluate(`document.getElementById('reader-view').dataset.pageType`);
    const onLastScreen = await page.evaluate(
      `(() => {
        const view = document.getElementById('reader-view');
        return view.dataset.page === String(Number(view.dataset.totalPages) - 1);
      })()`
    );
    assert(hashBeforeSwipe === hashAfterSwipe, 'A swipe inside the gallery turned the page');
    assert(pageType === 'gallery', `The reader left the gallery page (${pageType})`);
    assert(onLastScreen, 'The reader moved off the gallery screen after a swipe');
    pass('Swipes inside the gallery do not turn the page');

    /* Copy and network hygiene. */
    const staleCopy = await page.evaluate(`(() => {
      const text = document.body.innerHTML;
      return /Phase\\s*2|coming later|not part of this build|when they arrive/i.test(text);
    })()`);
    assert(staleCopy === false, 'The page still contains stale upload/soundtrack copy');

    await page.setViewport(1440, 1000);
    await page.evaluate(`location.hash = '#/'`);
    await page.waitFor(`location.hash === '#/'`, 'the landing route');
    await sleep(300);
    const landingStale = await page.evaluate(`/Phase\\s*2|coming later|not part of this build|when they arrive/i.test(document.body.innerHTML)`);
    assert(landingStale === false, 'The landing page still contains stale copy');
    pass('No stale upload/soundtrack copy remains');

    /* Graceful degradation when IndexedDB is unavailable. */
    await page.cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true });`
    });
    await page.cdp.send('Page.reload', { ignoreCache: true });
    await page.waitFor(
      `document.documentElement.dataset.appReady === 'true' && Boolean(window.__pbGallery)`,
      'the application to boot without IndexedDB'
    );
    await gotoGallery();
    await page.waitFor(`Boolean(window.__pbGallery.getState().error)`, 'the gallery storage error');
    await page.waitFor(
      `document.querySelector('.pb-gallery__feedback')?.textContent.includes('cannot save images locally') === true`,
      'the inline storage message'
    );
    const degraded = await page.evaluate(`({
      message: document.querySelector('.pb-gallery__feedback')?.textContent || '',
      addDisabled: document.querySelector('[data-gallery-add]')?.disabled === true,
      seeds: document.querySelectorAll('.pb-art--seed').length,
      error: window.__pbGallery.getState().error
    })`);
    assert(
      degraded.error && /cannot save images locally/i.test(degraded.error),
      `Unexpected storage-unavailable message: ${degraded.error}`
    );
    assert(degraded.message && /cannot save images locally/i.test(degraded.message), 'The inline storage message is missing');
    assert(degraded.addDisabled, 'Uploads were not disabled when IndexedDB is unavailable');
    assert(degraded.seeds === 2, 'The original plates disappeared when storage was unavailable');
    await page.screenshot('09-indexeddb-unavailable.jpg');
    pass('Gallery degrades gracefully when IndexedDB is unavailable');

    assert(page.pageErrors.length === 0, `Page exceptions:\n${page.pageErrors.join('\n')}`);
    assert(page.consoleErrors.length === 0, `Console errors:\n${page.consoleErrors.join('\n')}`);
    assert(page.externalRequests.length === 0, `External network requests:\n${page.externalRequests.join('\n')}`);
    assert(page.failedRequests.length === 0, `Failed resource loads:\n${page.failedRequests.join('\n')}`);
    pass('No page exceptions, console errors, external or failed requests');

    console.log(`\nGallery QA passed: ${checks.length} checks.`);
    console.log(`Screenshots: ${path.relative(ROOT, SCREENSHOT_DIR)}`);
  } catch (error) {
    exitCode = 1;
    console.error(`\nGallery QA failed: ${error.message}`);
    if (page) {
      console.error(`Console errors: ${JSON.stringify(page.consoleErrors, null, 2)}`);
      console.error(`Page errors: ${JSON.stringify(page.pageErrors, null, 2)}`);
      try {
        console.error(
          `Page diagnostic: ${JSON.stringify(await page.evaluate(`({
            hash: location.hash,
            route: document.documentElement.dataset.route,
            appReady: document.documentElement.dataset.appReady,
            gallery: window.__pbGallery?.getState() || null,
            activeElement: document.activeElement?.outerHTML?.slice(0, 140)
          })`), null, 2)}`
        );
      } catch {
        /* Best effort only. */
      }
    }
    try {
      if (page && cdp) {
        await page.screenshot('failure.jpg');
        console.error('Failure screenshot: qa/gallery/failure.jpg');
      }
    } catch {
      /* Best effort only. */
    }
  } finally {
    try {
      await cdp?.send('Browser.close', {}, 2000);
    } catch {
      /* The browser may already be closing. */
    }
    cdp?.close();
    browser.kill();
    if (server.process) server.process.kill();
    await sleep(300);
    try {
      fs.rmSync(profileDir, { recursive: true, force: true });
    } catch {
      /* Windows can hold profile locks briefly. */
    }
  }

  process.exitCode = exitCode;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
