#!/usr/bin/env node
/* Focused checks for navigation/persistence helpers. Run with npm run test:unit. */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  STORAGE,
  getSavedPosition,
  isWideEnoughForDuo,
  lastDuoSpreadStart,
  savePosition
} from '../assets/js/utils.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const memory = new Map();

globalThis.window = {
  innerWidth: 1000,
  localStorage: {
    getItem(key) {
      return memory.has(key) ? memory.get(key) : null;
    },
    setItem(key, value) {
      memory.set(key, value);
    }
  }
};

function resetPosition() {
  memory.delete(STORAGE.position);
}

test('duo boundary is exactly 1000px in JS and CSS', () => {
  window.innerWidth = 999;
  assert.equal(isWideEnoughForDuo(), false);
  window.innerWidth = 1000;
  assert.equal(isWideEnoughForDuo(), true);
  window.innerWidth = 1001;
  assert.equal(isWideEnoughForDuo(), true);

  const css = fs.readFileSync(path.join(ROOT, 'assets/css/reader.css'), 'utf8');
  assert.ok(!/@media\s*\(max-width:\s*1000px\)/.test(css), 'duo CSS must not collapse at 1000px');
  assert.ok(/@media\s*\(max-width:\s*999px\)/.test(css), 'duo CSS must collapse below 1000px');
});

test('last duo spread follows text-page parity', () => {
  assert.equal(lastDuoSpreadStart(5), 5);
  assert.equal(lastDuoSpreadStart(4), 3);
  assert.equal(lastDuoSpreadStart(3), 3);
  assert.equal(lastDuoSpreadStart(2), 1);
  assert.equal(lastDuoSpreadStart(1), 1);
});

test('legacy {chapter,page} records migrate to a route token', () => {
  resetPosition();
  memory.set(STORAGE.position, JSON.stringify({ chapter: 7, page: 3, updatedAt: 'yesterday' }));
  assert.deepEqual(getSavedPosition(), {
    version: 1,
    chapter: 7,
    token: '3',
    offset: null,
    updatedAt: 'yesterday'
  });
});

test('gallery token and character offset round-trip', () => {
  resetPosition();
  assert.equal(savePosition(9, 'gallery'), true);
  assert.deepEqual(getSavedPosition(), {
    version: 2,
    chapter: 9,
    token: 'gallery',
    offset: null,
    updatedAt: getSavedPosition().updatedAt
  });

  resetPosition();
  savePosition(12, '4', 1832);
  assert.deepEqual(getSavedPosition(), {
    version: 2,
    chapter: 12,
    token: '4',
    offset: 1832,
    updatedAt: getSavedPosition().updatedAt
  });
});

test('saved chapter is clamped and malformed tokens fall back to the cover', () => {
  resetPosition();
  memory.set(STORAGE.position, JSON.stringify({ chapter: 99, token: 'not-a-token' }));
  const saved = getSavedPosition();
  assert.equal(saved.chapter, 21);
  assert.equal(saved.token, '0');
});
