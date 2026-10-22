/* Shared helpers — DOM, storage, formatting, focus and timing. */

export const STORAGE = {
  settings: 'pb.reader.settings.v1',
  position: 'pb.reader.position.v1'
};

export const DEFAULT_SETTINGS = Object.freeze({
  theme: null,
  fontSize: 2,
  pageMode: 'single',
  particles: true
});

export const FONT_STEPS = Object.freeze({
  1: { size: 17, lineHeight: 1.8 },
  2: { size: 19, lineHeight: 1.78 },
  3: { size: 21, lineHeight: 1.75 },
  4: { size: 23, lineHeight: 1.7 }
});

export const numberFormatter = new Intl.NumberFormat('en-US');

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function formatNumber(value) {
  return numberFormatter.format(Number(value) || 0);
}

export function splitRelic(relic) {
  if (!relic) return { primary: '', supporting: '' };
  const marker = ' · Supporting:';
  const index = relic.indexOf(marker);
  if (index === -1) return { primary: relic.trim(), supporting: '' };
  return {
    primary: relic.slice(0, index).trim(),
    supporting: relic.slice(index + marker.length).trim()
  };
}

export function safeRead(key, fallback = null) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (error) {
    return fallback;
  }
}

export function safeWrite(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    return false;
  }
}

export function getSettings() {
  const saved = safeRead(STORAGE.settings, {}) || {};
  const fontSize = clamp(Number(saved.fontSize) || DEFAULT_SETTINGS.fontSize, 1, 4);
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    fontSize,
    theme: saved.theme === 'dark' || saved.theme === 'light' ? saved.theme : null,
    pageMode: saved.pageMode === 'duo' ? 'duo' : 'single',
    particles: saved.particles !== false
  };
}

export function saveSettings(patch) {
  const next = { ...getSettings(), ...patch };
  safeWrite(STORAGE.settings, next);
  return next;
}

function routeToken(value) {
  if (value === 'gallery') return 'gallery';
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return String(value);
  if (typeof value === 'string' && /^\d+$/.test(value)) return String(Number(value));
  return null;
}

export function getSavedPosition() {
  const saved = safeRead(STORAGE.position, null);
  if (!saved || !Number.isInteger(saved.chapter)) return null;

  /* v1 stored a raw screen index. Prefer the v2 route token, then fall back to
     the old numeric page so existing devices keep a usable Continue link. */
  const token = routeToken(saved.token)
    ?? routeToken(saved.route)
    ?? routeToken(saved.page)
    ?? '0';
  const offset = Number.isFinite(saved.offset) && saved.offset >= 0
    ? Math.trunc(saved.offset)
    : null;

  return {
    version: Number.isInteger(saved.version) ? saved.version : 1,
    chapter: clamp(saved.chapter, 1, 21),
    token,
    offset,
    updatedAt: saved.updatedAt || null
  };
}

export function savePosition(chapter, token, offset = null) {
  return safeWrite(STORAGE.position, {
    version: 2,
    chapter,
    token: routeToken(token) ?? '0',
    offset: Number.isFinite(offset) && offset >= 0 ? Math.trunc(offset) : null,
    updatedAt: new Date().toISOString()
  });
}

export function el(tagName, props = {}, children = []) {
  const node = document.createElement(tagName);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') {
      node.className = value;
    } else if (key === 'text') {
      node.textContent = value;
    } else if (key === 'dataset') {
      for (const [dataKey, dataValue] of Object.entries(value)) {
        node.dataset[dataKey] = dataValue;
      }
    } else if (key === 'style') {
      for (const [styleKey, styleValue] of Object.entries(value)) {
        if (styleKey.startsWith('--')) node.style.setProperty(styleKey, styleValue);
        else node.style[styleKey] = styleValue;
      }
    } else if (key === 'children') {
      appendChildren(node, value);
    } else if (value === true) {
      node.setAttribute(key, '');
    } else {
      node.setAttribute(key, String(value));
    }
  }
  appendChildren(node, children);
  return node;
}

export function appendChildren(parent, children) {
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child === null || child === undefined || child === false) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function raf() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

export async function twoFrames() {
  await raf();
  await raf();
}

export function debounce(fn, wait = 160) {
  let timer = 0;
  return function debounced(...args) {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn.apply(this, args), wait);
  };
}

export function prefersReducedMotion() {
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/* Contract: duo is enabled at 1000px and wider. reader.css collapses duo
   below that boundary, i.e. at max-width: 999px. */
export function isWideEnoughForDuo() {
  return window.innerWidth >= 1000;
}

/* Page index (1-based text page number) of the final duo spread's left page.
   Duo spreads start on odd text-page indices. */
export function lastDuoSpreadStart(textPageCount) {
  const count = Math.max(1, Math.trunc(Number(textPageCount) || 1));
  return count % 2 === 1 ? count : count - 1;
}

export function createFocusTrap(container, initialFocus = null) {
  const selector = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
  ].join(',');

  let previousFocus = null;
  let active = false;

  function focusables() {
    return Array.from(container.querySelectorAll(selector)).filter((node) => {
      return !node.hasAttribute('hidden') && node.getClientRects().length > 0;
    });
  }

  function onKeydown(event) {
    if (event.key !== 'Tab' || !active) return;
    const list = focusables();
    if (list.length === 0) {
      event.preventDefault();
      container.focus({ preventScroll: true });
      return;
    }
    const first = list[0];
    const last = list[list.length - 1];
    const current = document.activeElement;

    if (event.shiftKey && (current === first || !container.contains(current))) {
      event.preventDefault();
      last.focus({ preventScroll: true });
    } else if (!event.shiftKey && (current === last || !container.contains(current))) {
      event.preventDefault();
      first.focus({ preventScroll: true });
    }
  }

  return {
    activate() {
      if (active) return;
      active = true;
      previousFocus = document.activeElement;
      container.addEventListener('keydown', onKeydown);
      const target = initialFocus || focusables()[0] || container;
      requestAnimationFrame(() => {
        if (active) target.focus({ preventScroll: true });
      });
    },
    deactivate({ restoreFocus = true } = {}) {
      if (!active) return;
      active = false;
      container.removeEventListener('keydown', onKeydown);
      if (restoreFocus && previousFocus && previousFocus.isConnected) {
        previousFocus.focus({ preventScroll: true });
      }
      previousFocus = null;
    },
    get active() {
      return active;
    }
  };
}

export function announce(node, message) {
  if (!node) return;
  node.textContent = '';
  requestAnimationFrame(() => {
    node.textContent = message;
  });
}

export function titleCaseAct(act) {
  if (!act) return '';
  if (act.id === 'prologue') return 'Prologue';
  return `Act ${act.roman}`;
}

export function actLabel(act) {
  if (!act) return '';
  if (act.id === 'prologue') return 'Prologue';
  return `Act ${act.roman} · ${act.title}`;
}
