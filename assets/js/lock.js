/* Passcode gate for the edition.
   The reader stays inert behind a full-screen lock until the recipient
   enters the edition passcode. Unlock state lives only in this browser
   (session by default, local when "Remember on this device" is checked).
   Note: this is a gentle gate for a static site, not DRM — the text files
   themselves are public assets of the deployment. */

import { createFocusTrap } from './utils.js';

export const EDITION_PASSCODE = '111105';
const SESSION_KEY = 'pb.lock.unlocked.v1';
const REMEMBER_KEY = 'pb.lock.remember.v1';

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

export function isUnlocked() {
  if (readStorage(window.sessionStorage, SESSION_KEY) === '1') return true;
  return readStorage(window.localStorage, REMEMBER_KEY) === '1';
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

/* Resolves once the edition is unlocked. Resolves immediately when a stored
   unlock flag from this browser is present. */
export function waitForUnlock() {
  const screen = document.getElementById('lock-screen');
  if (!screen) return Promise.resolve();
  if (isUnlocked()) {
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
  trap.activate();

  return new Promise((resolve) => {
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

    function unlock() {
      writeStorage(window.sessionStorage, SESSION_KEY, '1');
      if (remember && remember.checked) writeStorage(window.localStorage, REMEMBER_KEY, '1');
      if (error) error.textContent = '';
      if (input) input.removeAttribute('aria-invalid');
      setLocked(false);
      trap.deactivate({ restoreFocus: false });
      screen.classList.add('is-unlocking');
      window.setTimeout(() => {
        screen.hidden = true;
        resolve();
      }, 460);
    }

    form?.addEventListener('submit', (event) => {
      event.preventDefault();
      const attempt = (input?.value || '').trim();
      if (!attempt) {
        deny('Enter the passcode to open the edition.');
        return;
      }
      if (attempt === EDITION_PASSCODE) unlock();
      else deny('That passcode did not open the archive. Try again.');
    });

    input?.addEventListener('input', () => {
      if (error) error.textContent = '';
      input.removeAttribute('aria-invalid');
    });
  });
}
