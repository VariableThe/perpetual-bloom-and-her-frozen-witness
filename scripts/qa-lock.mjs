/* Lock-gate mobile QA: passcode screen at real phone widths plus a short
   (landscape) viewport. Checks for horizontal overflow, clipped controls,
   tap-target sizes and the deny/unlock flow, then saves shots to qa/lock/.

   Needs a `playwright` package resolvable from this repo and the site
   served locally (e.g. `node server.mjs --port 4173`).

   Run with: npm run qa:lock */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SCREENSHOT_DIR = path.join(ROOT, 'qa', 'lock');
const BASE_URL = process.env.PB_URL ?? 'http://localhost:4173/';
const VIEWPORTS = [
  { name: 'lock-mobile-360.png', width: 360, height: 740 },
  { name: 'lock-mobile-375.png', width: 375, height: 667 },
  { name: 'lock-mobile-390.png', width: 390, height: 844 },
  { name: 'lock-mobile-landscape-740x360.png', width: 740, height: 360 },
];

let playwright;
try {
  playwright = await import('playwright');
} catch {
  console.log('SKIP  qa:lock - no `playwright` package installed; screenshots skipped.');
  process.exit(0);
}

const browser = await playwright.chromium.launch();
let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}`);
  if (!ok) failures += 1;
};

try {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  for (const vp of VIEWPORTS) {
    const page = await browser.newPage({
      viewport: { width: vp.width, height: vp.height },
      isMobile: true,
      hasTouch: true,
    });
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.evaluate(() => { sessionStorage.clear(); localStorage.clear(); });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('#lock-screen:not([hidden])', { timeout: 8000 });
    await page.waitForTimeout(500);
    const m = await page.evaluate(() => {
      const rect = (el) => {
        const b = el.getBoundingClientRect();
        return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
      };
      const screen = document.querySelector('.lock-screen');
      const card = document.querySelector('.lock-card');
      const row = document.querySelector('.lock-form__row');
      const input = document.querySelector('#lock-passcode');
      const btn = document.querySelector('.lock-form .btn');
      return {
        overflowX: document.documentElement.scrollWidth - window.innerWidth,
        rowRight: Math.round(row.getBoundingClientRect().right),
        btnRight: Math.round(btn.getBoundingClientRect().right),
        button: rect(btn),
        input: rect(input),
        cardTop: Math.round(card.getBoundingClientRect().top),
        scrollable: screen.scrollHeight > screen.clientHeight + 1,
      };
    });
    console.log(`--- ${vp.width}x${vp.height} ---`);
    check('no horizontal page overflow', m.overflowX <= 0, `overflow=${m.overflowX}px`);
    check('passcode row stays inside viewport', m.rowRight <= vp.width + 1, `rowRight=${m.rowRight}`);
    check('unlock button fully on-screen', m.btnRight <= vp.width + 1, `btnRight=${m.btnRight}`);
    check('unlock button tap target >=44px', m.button.h >= 44 && m.button.w >= 44, `${m.button.w}x${m.button.h}`);
    check('passcode input tap height >=44px', m.input.h >= 44, `h=${m.input.h}`);
    if (vp.height < 500) {
      check('short viewport: card top reachable', m.cardTop >= -1 || m.scrollable, `top=${m.cardTop}`);
    }
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, vp.name) });

    await page.fill('#lock-passcode', '000000');
    await page.click('.lock-form .btn');
    await page.waitForTimeout(300);
    const err = await page.textContent('#lock-error');
    check('wrong passcode denied with message', /did not open/i.test(err || ''), JSON.stringify(err));
    await page.fill('#lock-passcode', '111105');
    await page.click('.lock-form .btn');
    await page.waitForSelector('#lock-screen[hidden]', { timeout: 5000 }).catch(() => null);
    const hidden = await page.evaluate(() => document.getElementById('lock-screen').hidden);
    check('edition passcode unlocks', hidden === true);
    await page.close();
  }
} finally {
  await browser.close();
}

console.log(failures ? `\n${failures} FAILURES` : `\nScreenshots: ${path.relative(ROOT, SCREENSHOT_DIR)}`);
process.exit(failures ? 1 : 0);
