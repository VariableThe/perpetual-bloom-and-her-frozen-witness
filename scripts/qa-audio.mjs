/* Headless audio/UI smoke test for the generative soundtrack.
   Uses the installed Microsoft Edge through the Chrome DevTools Protocol.
   No test-runner dependencies are required. */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..');
const ORIGIN = 'http://127.0.0.1:4173';
const SCREENSHOT_DIR = path.join(ROOT, 'qa', 'audio');
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

  async click(selector) {
    const result = await this.evaluate(`(() => {
      const node = document.querySelector(${JSON.stringify(selector)});
      if (!node) throw new Error('Missing click target: ${selector.replaceAll("'", "\\'")}');
      node.scrollIntoView({ block: 'center', inline: 'center' });
      const box = node.getBoundingClientRect();
      const visible = box.width > 0 && box.height > 0;
      const enabled = !node.disabled;
      if (visible && enabled) {
        node.focus({ preventScroll: true });
        node.click();
      }
      return {
        width: box.width,
        height: box.height,
        disabled: Boolean(node.disabled),
        visible
      };
    })()`);
    assert(!result.disabled, `${selector} is disabled`);
    assert(result.visible, `${selector} has no visible box`);
    await sleep(100);
  }

  async press(key) {
    await this.evaluate(
      `document.dispatchEvent(new KeyboardEvent('keydown', {
        key: ${JSON.stringify(key)},
        code: ${JSON.stringify(key)},
        bubbles: true,
        cancelable: true
      }))`
    );
    await sleep(80);
  }

  async screenshot(name) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const result = await this.cdp.send('Page.captureScreenshot', {
      format: 'jpeg',
      quality: 86,
      captureBeyondViewport: false
    });
    const target = path.join(SCREENSHOT_DIR, name);
    fs.writeFileSync(target, Buffer.from(result.data, 'base64'));
    return target;
  }

  async state() {
    return this.evaluate(`window.__pbAudio ? window.__pbAudio.getState() : null`);
  }
}

async function main() {
  const browserPath = findBrowser();
  assert(browserPath, 'Microsoft Edge or Chrome was not found in its standard install path');

  const server = await startServer();
  const debugPort = await freePort();
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-audio-qa-'));
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
      '--autoplay-policy=no-user-gesture-required',
      '--window-size=1440,1000',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${profileDir}`,
      `${ORIGIN}/index.html?qa=audio#/`
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
    await page.setViewport(1440, 1000);

    await page.waitFor(
      `document.documentElement.dataset.appReady === 'true' && Boolean(window.__pbAudio)`,
      'the application to boot'
    );
    await sleep(500);

    const landing = await page.evaluate(`({
      rows: document.querySelectorAll('#soundtrack-list [data-track-row]').length,
      acts: document.querySelectorAll('#soundtrack-list .track-act').length,
      hero: document.querySelector('#hero-ctas .btn--primary')?.textContent.trim() || '',
      unsupported: document.querySelector('[data-audio-unsupported]')?.hidden,
      ready: document.documentElement.dataset.appReady
    })`);
    assert(landing.ready === 'true', 'Landing page did not report appReady');
    assert(landing.rows === 21, `Expected 21 landing track rows, found ${landing.rows}`);
    assert(landing.acts === 5, `Expected 5 act groups, found ${landing.acts}`);
    assert(landing.hero.startsWith('Begin with sound'), 'Hero primary is not "Begin with sound"');
    assert(landing.unsupported === true, 'Unsupported-audio notice is visible while audio is available');
    pass('Landing tracklist and hero render', `${landing.rows} tracks / ${landing.acts} acts`);
    await page.screenshot('01-landing.jpg');

    await page.evaluate(
      `window.scrollTo({ top: document.getElementById('soundtrack').offsetTop, behavior: 'instant' })`
    );
    await sleep(350);
    await page.screenshot('01b-landing-soundtrack.jpg');
    await page.evaluate(`window.scrollTo({ top: 0, behavior: 'instant' })`);
    await sleep(150);

    await page.click('#hero-ctas .btn--primary');
    await page.waitFor(`location.hash === '#/read/1/0'`, 'Chapter 1 route');
    const playing = await page.waitFor(
      `(() => {
        const state = window.__pbAudio?.getState();
        return state && state.isPlaying && state.contextState === 'running' ? state : null;
      })()`,
      'the audio context to start'
    );
    assert(playing.activeChapterNumber === 1, 'Hero did not activate chapter 1');
    assert(playing.activeTrackNumber === 1, 'Hero did not activate track 1');
    await page.waitFor(
      `window.__pbAudio.getState().schedulerTicks > 0`,
      'the scheduler to tick'
    );
    const readerBar = await page.evaluate(`({
      title: document.querySelector('#audio-bar [data-audio-title]')?.textContent || '',
      chapter: document.querySelector('#audio-bar [data-audio-chapter]')?.textContent || '',
      toggle: document.querySelector('#audio-bar [data-audio-action="toggle"]')?.getAttribute('aria-pressed'),
      visible: Boolean(document.querySelector('#audio-bar')?.getClientRects().length)
    })`);
    assert(readerBar.visible, 'The reader audio bar is not visible');
    assert(readerBar.title.includes('Track 01'), `Unexpected audio bar title: ${readerBar.title}`);
    assert(readerBar.chapter.includes('Chapter 1'), `Unexpected audio bar chapter: ${readerBar.chapter}`);
    assert(readerBar.toggle === 'true', 'Audio bar play button is not in the playing state');
    pass('Hero starts Chapter 1 and the audio bar follows', readerBar.title);
    await page.screenshot('02-reader-audio-bar.jpg');

    await page.click('#audio-bar [data-audio-action="toggle"]');
    await page.waitFor(`!window.__pbAudio.getState().isPlaying`, 'pause from the audio bar');
    pass('Audio bar pauses playback');

    await page.click('#audio-bar [data-audio-action="toggle"]');
    await page.waitFor(
      `window.__pbAudio.getState().isPlaying && window.__pbAudio.getState().contextState === 'running'`,
      'resume from the audio bar'
    );
    pass('Audio bar resumes playback');

    await page.click('#audio-bar [data-audio-action="next"]');
    await page.waitFor(
      `window.__pbAudio.getState().activeTrackNumber === 2`,
      'next-track navigation'
    );
    assert(
      (await page.evaluate(`document.querySelector('#audio-bar [data-audio-title]').textContent`)).includes(
        'Track 02'
      ),
      'Audio bar did not update for track 2'
    );
    await page.click('#audio-bar [data-audio-action="previous"]');
    await page.waitFor(
      `window.__pbAudio.getState().activeTrackNumber === 1`,
      'previous-track navigation'
    );
    pass('Previous/next controls switch tracks');

    await page.click('#audio-bar [data-audio-action="mute"]');
    await page.waitFor(
      `window.__pbAudio.getState().muted &&
       document.querySelector('#audio-bar [data-audio-action="mute"]')?.getAttribute('aria-pressed') === 'true'`,
      'mute state'
    );
    await page.click('#audio-bar [data-audio-action="mute"]');
    await page.waitFor(`!window.__pbAudio.getState().muted`, 'unmute state');

    await page.click('#audio-bar [data-audio-action="loop"]');
    await page.waitFor(`!window.__pbAudio.getState().loop`, 'loop off state');
    await page.click('#audio-bar [data-audio-action="loop"]');
    await page.waitFor(`window.__pbAudio.getState().loop`, 'loop on state');
    pass('Mute and loop controls update their state');

    await page.click('#audio-bar [data-audio-action="tracks"]');
    await page.waitFor(`!document.querySelector('#track-drawer').hidden`, 'track drawer open');
    await page.waitFor(
      `document.querySelector('#track-drawer').contains(document.activeElement)`,
      'focus to move into the track drawer'
    );
    const drawer = await page.evaluate(`({
      rows: document.querySelectorAll('#track-drawer-list [data-track-row]').length,
      acts: document.querySelectorAll('#track-drawer-list .track-drawer__act').length,
      expanded: document.querySelector('#audio-bar [data-audio-action="tracks"]')?.getAttribute('aria-expanded'),
      focusInside: Boolean(document.querySelector('#track-drawer')?.contains(document.activeElement))
    })`);
    assert(drawer.rows === 21, `Expected 21 drawer rows, found ${drawer.rows}`);
    assert(drawer.acts === 5, `Expected 5 drawer act groups, found ${drawer.acts}`);
    assert(drawer.expanded === 'true', 'Track-list button did not report expanded');
    assert(drawer.focusInside, 'Focus did not move into the track drawer');
    pass('Track drawer lists every track and traps focus', `${drawer.rows} tracks / ${drawer.acts} acts`);
    await page.screenshot('03-track-drawer.jpg');

    await page.click('#track-drawer-list [data-track-row="track-05"] .track-drawer__play');
    await page.waitFor(
      `window.__pbAudio.getState().activeTrackNumber === 5 && window.__pbAudio.getState().isPlaying`,
      'track drawer play control'
    );
    await page.press('Escape');
    await page.waitFor(`document.querySelector('#track-drawer').hidden`, 'track drawer close');
    const focusReturned = await page.evaluate(
      `document.activeElement?.dataset?.audioAction === 'tracks'`
    );
    assert(focusReturned, 'Focus did not return to the track-list button');
    pass('Drawer closes with Escape and restores focus');

    await page.click('#audio-bar [data-audio-action="tracks"]');
    await page.waitFor(`!document.querySelector('#track-drawer').hidden`, 'track drawer reopen');
    await page.click('#track-drawer-list [data-track-row="track-03"] .track-drawer__link');
    await page.waitFor(`location.hash === '#/read/3/0'`, 'chapter link from the drawer');
    const chapterThree = await page.waitFor(
      `(() => {
        const state = window.__pbAudio.getState();
        return state.activeChapterNumber === 3 && state.isPlaying ? state : null;
      })()`,
      'chapter 3 crossfade'
    );
    assert(chapterThree.activeTrackNumber === 3, 'Chapter 3 did not select track 3');
    await page.waitFor(
      `document.querySelector('#reader-stage')?.dataset.ready === 'true' &&
       !document.querySelector('#reader-stage .is-turning')`,
      'the reader to finish opening chapter 3'
    );
    await sleep(250);
    pass('Drawer chapter link crossfades to the new chapter');

    await page.evaluate(`location.hash = '#/read/3/1'`);
    await page.waitFor(`location.hash === '#/read/3/1'`, 'the reader page route');
    await sleep(300);
    const afterTurn = await page.state();
    assert(
      afterTurn.activeChapterNumber === 3 &&
        afterTurn.activeTrackId === chapterThree.activeTrackId &&
        afterTurn.isPlaying,
      'A route change inside the chapter changed or stopped the soundtrack'
    );
    pass('Page routes inside a chapter leave the score alone');

    await page.click('#audio-bar [data-audio-action="toggle"]');
    await page.waitFor(`!window.__pbAudio.getState().isPlaying`, 'pause before leaving');
    await page.click('#reader-back');
    await page.waitFor(`location.hash === '#/'`, 'return to the archive');
    await page.waitFor(`!window.__pbAudio.getState().isPlaying`, 'archive pause state');
    assert(
      (await page.evaluate(`document.querySelector('#audio-bar [data-audio-title]').textContent`)).includes(
        'Track 03'
      ),
      'The archive lost the selected chapter information'
    );
    pass('Returning to the archive pauses and preserves the chapter');
    await page.screenshot('04-archive-paused.jpg');

    await page.evaluate(`(() => {
      const range = document.querySelector('[data-audio-volume]');
      range.value = '0';
      range.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await page.waitFor(`window.__pbAudio.getState().volume === 0`, 'zero volume');
    await page.evaluate(`(() => {
      const range = document.querySelector('[data-audio-volume]');
      range.value = '50';
      range.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await page.waitFor(`window.__pbAudio.getState().volume === 0.5`, 'volume restored from zero');
    await page.evaluate(`(() => {
      const range = document.querySelector('[data-audio-volume]');
      range.value = '0';
      range.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await page.waitFor(`window.__pbAudio.getState().volume === 0`, 'zero volume persistence');
    await page.waitFor(
      `JSON.parse(localStorage.getItem('pb.audio.v1')).volume === 0`,
      'zero volume in localStorage'
    );
    pass('Volume can reach zero, recover and persist exactly');

    await page.setViewport(390, 844, { mobile: true });
    await sleep(250);
    await page.evaluate(`location.hash = '#/read/3/0'`);
    await page.waitFor(`location.hash === '#/read/3/0'`, 'mobile reader route');
    await page.waitFor(
      `document.querySelector('#reader-stage')?.dataset.ready === 'true' &&
       !document.querySelector('#reader-stage .is-turning')`,
      'the mobile reader to settle'
    );
    await sleep(300);
    const mobile = await page.evaluate(`({
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      barVisible: Boolean(document.querySelector('#audio-bar')?.getClientRects().length),
      controlsVisible: Boolean(document.querySelector('.reader-controls')?.getClientRects().length),
      barHeight: Math.round(document.querySelector('#audio-bar')?.getBoundingClientRect().height || 0)
    })`);
    assert(mobile.barVisible, 'The audio bar is missing on mobile');
    assert(mobile.controlsVisible, 'The page controls are missing on mobile');
    assert(mobile.overflow <= 1, `Mobile layout overflows by ${mobile.overflow}px`);
    pass('Mobile reader keeps the audio bar and controls in flow', `${mobile.barHeight}px bar`);
    await page.screenshot('05-mobile-reader.jpg');

    await page.setViewport(1440, 1000);
    await page.cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `Object.defineProperty(window, 'AudioContext', { value: undefined, configurable: true });
               Object.defineProperty(window, 'webkitAudioContext', { value: undefined, configurable: true });`
    });
    await page.cdp.send('Page.reload', { ignoreCache: true });
    await page.waitFor(
      `document.documentElement.dataset.appReady === 'true' && Boolean(window.__pbAudio)`,
      'unsupported-browser boot'
    );
    await page.evaluate(`location.hash = '#/'`);
    await page.waitFor(
      `location.hash === '#/' && Boolean(document.querySelector('#hero-ctas .btn--primary'))`,
      'landing route after reload'
    );
    await page.evaluate(`window.scrollTo(0, 0)`);
    await sleep(500);
    const fallback = await page.evaluate(`({
      supported: window.__pbAudio.getState().supported,
      volume: window.__pbAudio.getState().volume,
      heroDisabled: document.querySelector('#hero-ctas .btn--primary')?.disabled,
      notice: document.querySelector('[data-audio-unsupported]')?.hidden,
      barTitle: document.querySelector('#audio-bar [data-audio-title]')?.textContent || ''
    })`);
    assert(fallback.supported === false, 'AudioContext removal did not disable the player');
    assert(fallback.volume === 0, 'Persisted zero volume was lost on reload');
    assert(fallback.heroDisabled === true, 'Hero sound button is not disabled without WebAudio');
    assert(fallback.notice === false, 'Unsupported-audio notice is hidden');
    assert(
      fallback.barTitle.includes('unavailable'),
      `Unexpected unsupported audio bar title: ${fallback.barTitle}`
    );
    pass('Unsupported WebAudio falls back without blocking the reader');
    await page.screenshot('06-unsupported.jpg');

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

    console.log(`\nAudio QA passed: ${checks.length} checks.`);
    console.log(`Screenshots: ${path.relative(ROOT, SCREENSHOT_DIR)}`);
  } catch (error) {
    exitCode = 1;
    console.error(`\nAudio QA failed: ${error.message}`);
    if (page) {
      console.error(`Console errors: ${JSON.stringify(page.consoleErrors, null, 2)}`);
      console.error(`Page errors: ${JSON.stringify(page.pageErrors, null, 2)}`);
      try {
        console.error(
          `Page diagnostic: ${JSON.stringify(await page.evaluate(`({
            hash: location.hash,
            route: document.documentElement.dataset.route,
            appReady: document.documentElement.dataset.appReady,
            activeElement: document.activeElement?.outerHTML?.slice(0, 120),
            state: window.__pbAudio?.getState() || null
          })`), null, 2)}`
        );
      } catch {
        /* Best effort only. */
      }
    }
    try {
      if (page && cdp) {
        await page.screenshot('failure.jpg');
        console.error('Failure screenshot: qa/audio/failure.jpg');
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
