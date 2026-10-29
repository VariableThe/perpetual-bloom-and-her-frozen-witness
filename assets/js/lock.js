/* Passcode gate for the edition.
   The reader stays inert behind a full-screen lock until the recipient
   enters the edition passcode. The novel prose is NOT in the served tree:
   only the sealed envelope data/book.enc.json ships, and the key is
   derived in the browser with PBKDF2-SHA256 (>= 210,000 iterations) +
   AES-256-GCM. A wrong passcode fails authentication and keeps the
   existing invalid-pin UX.

   The passcode itself is never stored anywhere in the repo or in a
   shipped file; it arrives only as the recipient's keystrokes. What the
   browser remembers is the derived AES key, exported as base64:
   this-session only in sessionStorage, or on the device in localStorage
   when "Remember on this device" is checked. The decrypted book lives
   only in module memory for the life of the page; reloading re-derives
   (silently from a remembered key) or asks for the passcode again.
*/

import { createFocusTrap } from './utils.js';

const ENC_URL = new URL('../../data/book.enc.json', import.meta.url);
const SESSION_KEY = 'pb.lock.key.v1';
const REMEMBER_KEY = 'pb.lock.key.remember.v1';
const DENY_MESSAGE = 'That passcode did not open the archive. Try again.';

/* In-memory only: the decrypted book and its AES key. Never written to
   any storage area; a reload drops them and the gate re-opens. */
let cachedBook = null;
let cachedKey = null;
let envelopePromise = null;

function readStorage(area, key) {
  try {
    return area.getItem(key);
  } catch (error) {
    return null;
  }
}

function writeStorage(area, key, value) {
  try {
    area.setItem(key, value);
    return true;
  } catch (error) {
    return false;
  }
}

function base64ToBytes(base64) {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return window.btoa(binary);
}

async function loadEnvelope() {
  if (!envelopePromise) {
    envelopePromise = (async () => {
      let response;
      try {
        response = await fetch(ENC_URL);
      } catch (error) {
        throw new Error('Could not fetch the sealed archive. Start the local server and try again.');
      }
      if (!response.ok) throw new Error(`Could not fetch the sealed archive (HTTP ${response.status}).`);
      const envelope = await response.json();
      if (!envelope || envelope.version !== 1 || envelope.algorithm !== 'AES-256-GCM') {
        throw new Error('The sealed archive has an unknown format.');
      }
      if (
        envelope.kdf !== 'PBKDF2-SHA256' ||
        !Number.isInteger(envelope.iterations) ||
        envelope.iterations < 210000
      ) {
        throw new Error('The sealed archive has unsafe key-derivation parameters.');
      }
      return {
        salt: base64ToBytes(envelope.salt),
        iv: base64ToBytes(envelope.iv),
        data: base64ToBytes(envelope.ciphertext),
        iterations: envelope.iterations
      };
    })();
    envelopePromise.catch(() => {
      envelopePromise = null;
    });
  }
  return envelopePromise;
}

async function deriveKeyFromPasscode(passcode, salt, iterations) {
  const passwordKey = await window.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passcode),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return window.crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    passwordKey,
    { name: 'AES-GCM', length: 256 },
    true,
    ['decrypt']
  );
}

async function importStoredKey(stored) {
  return window.crypto.subtle.importKey('raw', base64ToBytes(stored), 'AES-GCM', true, ['decrypt']);
}

async function decryptEnvelope(key, envelope) {
  const plainBuffer = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: envelope.iv },
    key,
    envelope.data
  );
  const book = JSON.parse(new TextDecoder().decode(plainBuffer));
  if (!book || !Array.isArray(book.chapters)) throw new Error('The archive did not decrypt cleanly.');
  return book;
}

async function activateKey(key) {
  const envelope = await loadEnvelope();
  const book = await decryptEnvelope(key, envelope);
  cachedKey = key;
  cachedBook = book;
  return book;
}

/* Resolve with the decrypted book when the given passcode opens the
   archive; reject when authentication fails. */
export async function unlockWithPasscode(passcode) {
  const envelope = await loadEnvelope();
  const key = await deriveKeyFromPasscode(passcode, envelope.salt, envelope.iterations);
  const book = await decryptEnvelope(key, envelope);
  cachedKey = key;
  cachedBook = book;
  const exported = bytesToBase64(new Uint8Array(await window.crypto.subtle.exportKey('raw', key)));
  return { book, exported };
}

function persistUnlock(exported, remember) {
  writeStorage(window.sessionStorage, SESSION_KEY, exported);
  if (remember) writeStorage(window.localStorage, REMEMBER_KEY, exported);
}

/* The decrypted book for the data layer. Throws while the gate is shut. */
export function getBookData() {
  if (!cachedBook) throw new Error('The archive is still locked.');
  return cachedBook;
}

export function getSessionKey() {
  return cachedKey;
}

export function isUnlocked() {
  if (cachedBook) return true;
  if (readStorage(window.sessionStorage, SESSION_KEY)) return true;
  return Boolean(readStorage(window.localStorage, REMEMBER_KEY));
}

function setLocked(locked) {
  document.documentElement.dataset.locked = locked ? 'true' : 'false';
  for (const id of ['landing-view', 'reader-view']) {
    const view = document.getElementById(id);
    if (!view) continue;
    if (locked) view.setAttribute('inert', '');
    else view.removeAttribute('inert');
  }
}

/* Try a remembered key (this session first, then this device) without
   bothering the recipient. */
async function trySilentUnlock() {
  const stored = readStorage(window.sessionStorage, SESSION_KEY)
    || readStorage(window.localStorage, REMEMBER_KEY);
  if (!stored) return false;
  try {
    await activateKey(await importStoredKey(stored));
    /* A device-remembered key also unlocks this session while it lasts. */
    writeStorage(window.sessionStorage, SESSION_KEY, stored);
    return true;
  } catch (error) {
    try {
      window.sessionStorage.removeItem(SESSION_KEY);
      window.localStorage.removeItem(REMEMBER_KEY);
    } catch (cleanupError) {
      /* Storage may be unavailable; the form flow still works. */
    }
    return false;
  }
}

/* Resolves once the edition is unlocked. Resolves silently when a stored
   key from this browser opens the sealed archive. */
export function waitForUnlock() {
  const screen = document.getElementById('lock-screen');
  if (!screen) return Promise.resolve();
  if (cachedBook) {
    screen.hidden = true;
    setLocked(false);
    return Promise.resolve();
  }

  setLocked(true);
  const form = screen.querySelector('#lock-form');
  const input = screen.querySelector('#lock-passcode');
  const error = screen.querySelector('#lock-error');
  const remember = screen.querySelector('#lock-remember');
  const trap = createFocusTrap(screen, input);

  function deny(message) {
    if (error) error.textContent = message;
    if (input) {
      input.setAttribute('aria-invalid', 'true');
      input.value = '';
      input.focus({ preventScroll: true });
    }
    screen.classList.remove('shake');
    void screen.offsetWidth;
    screen.classList.add('shake');
  }

  function unlock(exported) {
    persistUnlock(exported, Boolean(remember && remember.checked));
    if (error) error.textContent = '';
    if (input) input.removeAttribute('aria-invalid');
    setLocked(false);
    trap.deactivate({ restoreFocus: false });
    screen.classList.add('is-unlocking');
    window.setTimeout(() => {
      screen.hidden = true;
    }, 460);
  }

  trap.activate();

  return trySilentUnlock().then((silent) => {
    if (silent) {
      setLocked(false);
      trap.deactivate({ restoreFocus: false });
      screen.hidden = true;
      return undefined;
    }

    return new Promise((resolve) => {
      form?.addEventListener('submit', (event) => {
        event.preventDefault();
        const attempt = (input?.value || '').trim();
        if (!attempt) {
          deny('Enter the passcode to open the edition.');
          return;
        }
        if (input) input.disabled = true;
        unlockWithPasscode(attempt).then(
          ({ exported }) => {
            if (input) input.disabled = false;
            unlock(exported);
            resolve();
          },
          () => {
            if (input) input.disabled = false;
            deny(DENY_MESSAGE);
          }
        );
      });

      input?.addEventListener('input', () => {
        if (error) error.textContent = '';
        input.removeAttribute('aria-invalid');
      });
    });
  });
}
