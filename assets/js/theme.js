/* Theme state. System-aware first, explicit choice persisted locally. */

import { getSettings, saveSettings } from './utils.js';

export const THEME_EVENT = 'pb:themechange';

function systemTheme() {
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function isTheme(value) {
  return value === 'light' || value === 'dark';
}

export function currentTheme() {
  const value = document.documentElement.dataset.theme;
  return isTheme(value) ? value : systemTheme();
}

export function applyTheme(theme, { persist = true, notify = true } = {}) {
  const next = isTheme(theme) ? theme : systemTheme();
  document.documentElement.dataset.theme = next;
  document.documentElement.style.colorScheme = next;

  const meta = document.getElementById('theme-color-meta');
  if (meta) meta.setAttribute('content', next === 'dark' ? '#140f18' : '#fdf8f7');

  if (persist) saveSettings({ theme: next });

  document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
    const label = next === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
    button.setAttribute('aria-label', label);
    button.setAttribute('title', label);
  });

  document.querySelectorAll('[data-theme-choice]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.themeChoice === next));
  });

  if (notify) {
    window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: { theme: next } }));
  }

  return next;
}

export function setTheme(theme, options = {}) {
  return applyTheme(theme, { persist: true, notify: true, ...options });
}

export function toggleTheme() {
  return setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
}

export function initTheme() {
  const settings = getSettings();
  const initial = isTheme(settings.theme) ? settings.theme : systemTheme();
  applyTheme(initial, { persist: false, notify: false });

  document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
    if (button.dataset.themeBound === 'true') return;
    button.dataset.themeBound = 'true';
    button.addEventListener('click', () => toggleTheme());
  });

  document.querySelectorAll('[data-theme-choice]').forEach((button) => {
    if (button.dataset.themeBound === 'true') return;
    button.dataset.themeBound = 'true';
    button.addEventListener('click', () => setTheme(button.dataset.themeChoice));
  });

  if (!isTheme(settings.theme) && window.matchMedia) {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event) => {
      const latest = getSettings();
      if (isTheme(latest.theme)) return;
      applyTheme(event.matches ? 'dark' : 'light', { persist: false, notify: true });
    };
    if (query.addEventListener) query.addEventListener('change', onChange);
    else if (query.addListener) query.addListener(onChange);
  }

  return initial;
}
