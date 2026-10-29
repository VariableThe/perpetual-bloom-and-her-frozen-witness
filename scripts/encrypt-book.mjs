#!/usr/bin/env node
/**
 * Encrypt the edition plaintext for the passcode gate.
 *
 * Reads content/book.json (the plaintext source of truth, never served),
 * derives an AES-256-GCM key from the edition passcode with PBKDF2-SHA256
 * (>= 210,000 iterations, random 16-byte salt), and writes the sealed
 * envelope data/book.enc.json that the browser decrypts after unlock.
 *
 * The passcode is NEVER stored in the repo or in any shipped file. Pass it
 * only via the environment:
 *
 *   PB_PASSCODE='<edition-passcode>' node scripts/encrypt-book.mjs
 *
 * Re-run this script every time content/book.json changes (directly, or via
 * `npm run build:content`), then commit the refreshed data/book.enc.json.
 *
 * Node built-ins only (node:crypto, node:fs, node:path).
 */

import { createCipheriv, createHash, pbkdf2Sync, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLAINTEXT_FILE = path.join(ROOT, 'content', 'book.json');
const ENVELOPE_FILE = path.join(ROOT, 'data', 'book.enc.json');

/* Security parameters. Iterations must stay >= 210,000; raising them slows
   both offline guessing and legitimate unlocks, so change with care. */
const KDF = 'PBKDF2-SHA256';
const ALGORITHM = 'AES-256-GCM';
const ITERATIONS = 210000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const KEY_BYTES = 32;

function fail(message) {
  console.error(`encrypt-book: ${message}`);
  process.exit(1);
}

function main() {
  const passcode = (process.env.PB_PASSCODE || '').trim();
  if (!passcode) {
    fail('PB_PASSCODE is empty. Run: PB_PASSCODE=\'<edition-passcode>\' node scripts/encrypt-book.mjs');
  }
  if (!fs.existsSync(PLAINTEXT_FILE)) {
    fail(`${path.relative(ROOT, PLAINTEXT_FILE)} is missing. Run: npm run build:content`);
  }

  const plaintext = fs.readFileSync(PLAINTEXT_FILE);
  let chapters = 0;
  try {
    const book = JSON.parse(plaintext.toString('utf8'));
    if (!book || !Array.isArray(book.chapters)) throw new Error('no chapters array');
    chapters = book.chapters.length;
  } catch (error) {
    fail(`plaintext is not a valid book: ${error.message}`);
  }

  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = pbkdf2Sync(passcode, salt, ITERATIONS, KEY_BYTES, 'sha256');
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  key.fill(0);

  const envelope = {
    version: 1,
    algorithm: ALGORITHM,
    kdf: KDF,
    iterations: ITERATIONS,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    /* AES-GCM auth tag appended to the ciphertext, matching the layout the
       Web Crypto API expects for AES-GCM decryption. */
    ciphertext: Buffer.concat([ciphertext, tag]).toString('base64'),
    plaintext: {
      bytes: plaintext.length,
      sha256: createHash('sha256').update(plaintext).digest('hex')
    }
  };

  fs.mkdirSync(path.dirname(ENVELOPE_FILE), { recursive: true });
  fs.writeFileSync(ENVELOPE_FILE, `${JSON.stringify(envelope, null, 2)}\n`, 'utf8');

  console.log(`Sealed ${path.relative(ROOT, PLAINTEXT_FILE)} (${chapters} chapters, ${plaintext.length} bytes)`);
  console.log(`Wrote ${path.relative(ROOT, ENVELOPE_FILE)} (${fs.statSync(ENVELOPE_FILE).size} bytes)`);
  console.log(`${KDF} ${ITERATIONS} iterations · ${ALGORITHM} · fresh random salt+iv`);
}

main();
