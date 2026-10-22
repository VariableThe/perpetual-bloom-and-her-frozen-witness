/* Headless cover-page smoke test for the reader.
   Uses the installed Microsoft Edge (or Chrome) through the Chrome DevTools
   Protocol. No test-runner dependencies are required.

   The chapter SVGs are illustration-only: this test checks that no readable
   chapter labels are baked into the art and that the HTML overlay fits at
   desktop, mobile and short viewports.

   Run with: npm run qa:cover */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..');
const ORIGIN = 'http://127.0.0.1:4173';
const SCREENSHOT_DIR = path.join(ROOT, 'qa', 'cover');
const CHAPTER = 3;
const TITLE = 'The Clover and the Home';
const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
];
const VIEWPORTS = [
  { name: 'desktop-1440.png', label: '1440x900', width: 1440, height: 900 },
  { name: 'mobile-390.png', label: '390x844', width: 390, height: 844, mobile: true },
  { name: 'short-1000.png', label: '1000x700', width: 1000, height: 700 }
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const checks = [];

function pass(name, detail = '') {
  checks.push({ name, detail });
  console.log(`PASS  ${name}${detail ? ` - ${detail}` : ''}`);
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
      const page = targets.find(
        (target) => target.type === 'page' && target.url.startsWith(ORIGIN)
      );
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
      this.pageErrors.push(
        details.exception?.description || details.text || 'Uncaught page exception'
      );
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
      this.failedRequests.push(`${event.type || 'resource'} - ${event.errorText}`);
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
      throw new Error(
        details.exception?.description || details.text || 'Runtime.evaluate failed'
      );
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

  async screenshot(name) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const result = await this.cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false
    });
    const target = path.join(SCREENSHOT_DIR, name);
    fs.writeFileSync(target, Buffer.from(result.data, 'base64'));
    return target;
  }
}

async function waitForCover(page) {
  await page.waitFor(
    `document.documentElement.dataset.appReady === 'true' &&
     location.hash === '#/read/${CHAPTER}/0' &&
     Boolean(document.querySelector('.reader-page--cover .cover-page__title'))`,
    'the chapter cover'
  );
  await page.waitFor(
    `document.querySelector('#reader-stage')?.dataset.ready === 'true' &&
     !document.querySelector('.book-stage.is-turning')`,
    'the reader to settle on the cover'
  );
  await page.waitFor(
    `(() => {
      const img = document.querySelector('.reader-page--cover .cover-page__art img');
      return Boolean(img && img.complete && img.naturalWidth > 0);
    })()`,
    'the cover artwork to load'
  );
  await sleep(180);
}

async function main() {
  const browserPath = findBrowser();
  assert(browserPath, 'Microsoft Edge or Chrome was not found in its standard install path');

  const server = await startServer();
  const debugPort = await freePort();
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-cover-qa-'));
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
      '--window-size=1440,900',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${profileDir}`,
      `${ORIGIN}/index.html?qa=cover#/read/${CHAPTER}/0`
    ],
    { stdio: 'ignore', windowsHide: true }
  );

  let cdp = null;
  let page = null;
  let exitCode = 0;

  try {
    const target = await pageTarget(debugPort);
    cdp = new CDPConnection(target.webSocketDebuggerUrl);
    await cdp.connect();
    page = new Page(cdp);
    await page.attach();
    await page.setViewport(1440, 900);
    await waitForCover(page);

    for (const viewport of VIEWPORTS) {
      await page.setViewport(viewport.width, viewport.height, { mobile: Boolean(viewport.mobile) });
      await sleep(260);
      await waitForCover(page);

      const layout = await page.evaluate(`(() => {
        const overlay = document.querySelector('.reader-page--cover .cover-page__overlay');
        const cover = document.querySelector('.reader-page--cover');
        const title = document.querySelector('.reader-page--cover .cover-page__title');
        const begin = document.querySelector('.reader-page--cover [data-action="begin-page"]');
        const titleBox = title?.getBoundingClientRect();
        const beginBox = begin?.getBoundingClientRect();
        return {
          title: title?.textContent.trim() || '',
          overlayScroll: overlay?.scrollHeight || 0,
          overlayClient: overlay?.clientHeight || 0,
          coverScroll: cover?.scrollHeight || 0,
          coverClient: cover?.clientHeight || 0,
          documentScrollWidth: document.documentElement.scrollWidth,
          bodyScrollWidth: document.body.scrollWidth,
          innerWidth: window.innerWidth,
          titleVisible: Boolean(titleBox && titleBox.width > 0 && titleBox.height > 0),
          beginVisible: Boolean(beginBox && beginBox.width > 0 && beginBox.height > 0)
        };
      })()`);

      assert(layout.title === TITLE, `${viewport.label}: unexpected cover title "${layout.title}"`);
      assert(layout.titleVisible, `${viewport.label}: the overlay title is not visible`);
      assert(layout.beginVisible, `${viewport.label}: the Begin button is not visible`);
      assert(
        layout.overlayScroll <= layout.overlayClient + 1,
        `${viewport.label}: overlay content overflows (${layout.overlayScroll} > ${layout.overlayClient})`
      );
      assert(
        layout.coverScroll <= layout.coverClient + 1,
        `${viewport.label}: cover page content overflows (${layout.coverScroll} > ${layout.coverClient})`
      );
      assert(
        Math.max(layout.documentScrollWidth, layout.bodyScrollWidth) <= layout.innerWidth + 1,
        `${viewport.label}: horizontal document overflow (${Math.max(layout.documentScrollWidth, layout.bodyScrollWidth)} > ${layout.innerWidth})`
      );

      const shot = await page.screenshot(viewport.name);
      pass(
        `Cover overlay fits at ${viewport.label}`,
        `${path.relative(ROOT, shot)} - overlay ${layout.overlayClient}px`
      );
    }

    const artResponse = await fetch(`${ORIGIN}/assets/art/chapters/chapter-03.svg`);
    assert(artResponse.ok, `Could not fetch chapter-03.svg (${artResponse.status})`);
    const art = await artResponse.text();
    const stripped = art
      .replace(/<title\b[\s\S]*?<\/title>/gi, '')
      .replace(/<desc\b[\s\S]*?<\/desc>/gi, '');
    assert(stripped.length < art.length, 'Chapter 3 SVG metadata could not be stripped');
    const visibleText = Array.from(stripped.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/gi))
      .map((match) => match[1].replace(/<[^>]*>/g, '').trim())
      .filter(Boolean);
    assert(
      !visibleText.some((text) => /CHAPTER/i.test(text)),
      `Chapter 3 SVG still contains a visible chapter label: ${visibleText.join(' | ')}`
    );
    assert(
      !visibleText.some((text) => text.includes(TITLE)),
      'Chapter 3 SVG still contains the chapter title'
    );
    const numeral = visibleText.filter((text) => /^\d+$/.test(text));
    assert(numeral.includes(String(CHAPTER)), 'Chapter 3 SVG is missing its numeral watermark');
    pass(
      'Chapter 3 SVG is illustration-only',
      `visible text: ${visibleText.map((text) => JSON.stringify(text)).join(', ')}`
    );

    await page.setViewport(1440, 900);
    await page.evaluate(`location.hash = '#/'`);
    await page.waitFor(
      `location.hash === '#/' && document.querySelectorAll('#act-list .chapter-card').length === 21`,
      'the landing chapter cards'
    );
    await page.evaluate(`(() => {
      const chapters = document.getElementById('chapters');
      const top = chapters.getBoundingClientRect().top + window.scrollY;
      window.scrollTo({ top: Math.max(0, top - 80), behavior: 'instant' });
    })()`);
    await page.waitFor(
      `Array.from(document.querySelectorAll('#act-list .chapter-card img'))
        .filter((img) => {
          const box = img.getBoundingClientRect();
          return box.bottom > 0 && box.top < window.innerHeight;
        })
        .every((img) => img.complete && img.naturalWidth > 0)`,
      'the visible chapter-card thumbnails to load'
    );
    await sleep(400);
    const landing = await page.evaluate(`({
      cards: document.querySelectorAll('#act-list .chapter-card').length,
      acts: document.querySelectorAll('#act-list .act-head').length,
      overflow: document.documentElement.scrollWidth - window.innerWidth
    })`);
    assert(landing.cards === 21, `Expected 21 landing chapter cards, found ${landing.cards}`);
    assert(landing.acts === 5, `Expected 5 landing act groups, found ${landing.acts}`);
    assert(landing.overflow <= 1, `Landing has ${landing.overflow}px horizontal overflow`);
    const landingShot = await page.screenshot('landing-cards.png');
    pass(
      'Landing chapter cards render without embedded art text',
      `${landing.cards} cards / ${landing.acts} acts - ${path.relative(ROOT, landingShot)}`
    );

    assert(page.pageErrors.length === 0, `Page exceptions:\n${page.pageErrors.join('\n')}`);
    assert(page.consoleErrors.length === 0, `Console errors:\n${page.consoleErrors.join('\n')}`);
    assert(
      page.externalRequests.length === 0,
      `External network requests:\n${page.externalRequests.join('\n')}`
    );
    assert(
      page.failedRequests.length === 0,
      `Failed resource loads:\n${page.failedRequests.join('\n')}`
    );
    pass('No page exceptions, console errors or external requests');

    console.log(`\nCover QA passed: ${checks.length} checks.`);
    console.log(`Screenshots: ${path.relative(ROOT, SCREENSHOT_DIR)}`);
  } catch (error) {
    exitCode = 1;
    console.error(`\nCover QA failed: ${error.message}`);
    if (page) {
      console.error(`Console errors: ${JSON.stringify(page.consoleErrors, null, 2)}`);
      console.error(`Page errors: ${JSON.stringify(page.pageErrors, null, 2)}`);
      try {
        console.error(
          `Page diagnostic: ${JSON.stringify(await page.evaluate(`({
            hash: location.hash,
            route: document.documentElement.dataset.route,
            appReady: document.documentElement.dataset.appReady,
            title: document.querySelector('.reader-page--cover .cover-page__title')?.textContent || '',
            overlay: (() => {
              const node = document.querySelector('.reader-page--cover .cover-page__overlay');
              return node ? { scrollHeight: node.scrollHeight, clientHeight: node.clientHeight } : null;
            })()
          })`), null, 2)}`
        );
      } catch {
        /* Best effort only. */
      }
    }
    try {
      if (page && cdp) {
        await page.screenshot('failure.png');
        console.error('Failure screenshot: qa/cover/failure.png');
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
