#!/usr/bin/env node
/**
 * Build content/book.json from src/data/novel.txt.
 *
 * content/book.json is the PLAINTEXT source of truth. It is never served
 * (see server.mjs, .vercelignore): after rebuilding it, re-seal the
 * served envelope with
 *
 *   PB_PASSCODE='<edition-passcode>' node scripts/encrypt-book.mjs
 *
 * and commit the refreshed data/book.enc.json alongside it.
 *
 * The source is a plain-text extraction of the novel. Chapter headings are
 * explicit ("Chapter N" / blank / title), but the text also contains act and
 * part labels, per-chapter object/date metadata, and END OF CHAPTER markers.
 * Those are structural, so this parser removes them from the prose while
 * keeping every narrative paragraph byte-for-byte (including emoji, verse
 * line breaks and marginalia).
 *
 * No dependencies. Run with: node scripts/build-content.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_FILE = path.join(ROOT, 'src', 'data', 'novel.txt');
const OUTPUT_FILE = path.join(ROOT, 'content', 'book.json');

// Authoritative chapter body counts from src/data/structure.md. These are a
// guard against accidentally letting headings, dates or markers into a body.
const EXPECTED_WORDS = {
  1: 4633,
  2: 4535,
  3: 3843,
  4: 4502,
  5: 4322,
  6: 4417,
  7: 5080,
  8: 3381,
  9: 2735,
  10: 3944,
  11: 3047,
  12: 2673,
  13: 3620,
  14: 3188,
  15: 2602,
  16: 4212,
  17: 5423,
  18: 7049,
  19: 4059,
  20: 4185,
  21: 4396,
};
const EXPECTED_TOTAL = 85846;
const EXPECTED_CHAPTERS = 21;

const CHAPTER_HEADING = /^Chapter (\d+)$/;
const END_MARKER = /^END OF CHAPTER \d+$/;
const ACT_LABEL = /^ACT (?:I|II|III|IV):\s+.+$/;
const PART_LABEL = /^THE WITNESS AND THE BLOOM$/;
const RELIC_PREFIX = 'Object anchor:';
const DATE_LINE =
  /^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+.+$/;

function countWords(text) {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

function isStructural(line) {
  return (
    CHAPTER_HEADING.test(line) ||
    END_MARKER.test(line) ||
    ACT_LABEL.test(line) ||
    PART_LABEL.test(line)
  );
}

function nextNonEmpty(lines, from) {
  for (let i = from; i < lines.length; i += 1) {
    if (lines[i].trim() !== '') return i;
  }
  return -1;
}

function parseNovel(raw) {
  // Accept CRLF input too, but emit LF everywhere.
  const lines = raw.replace(/\r\n?/g, '\n').split('\n');
  const starts = [];

  lines.forEach((line, index) => {
    const match = line.match(CHAPTER_HEADING);
    if (match) starts.push({ number: Number(match[1]), headingIndex: index });
  });

  if (starts.length !== EXPECTED_CHAPTERS) {
    throw new Error(
      `Expected ${EXPECTED_CHAPTERS} chapter headings, found ${starts.length}.`,
    );
  }

  const chapters = starts.map((start, position) => {
    const { number, headingIndex } = start;
    const titleIndex = nextNonEmpty(lines, headingIndex + 1);
    if (titleIndex < 0) throw new Error(`Chapter ${number} has no title.`);

    const title = lines[titleIndex].trim();
    let cursor = titleIndex + 1;
    let relic = null;
    let date = null;

    // Chapters 3+ carry an object-anchor line followed by a date. The parser
    // treats any such lines as metadata rather than prose; chapter 1 and 2
    // have no metadata block.
    const metadataIndex = nextNonEmpty(lines, cursor);
    if (
      metadataIndex >= 0 &&
      lines[metadataIndex].trim().startsWith(RELIC_PREFIX)
    ) {
      relic = lines[metadataIndex].trim().slice(RELIC_PREFIX.length).trim();
      cursor = metadataIndex + 1;
      const dateIndex = nextNonEmpty(lines, cursor);
      if (dateIndex >= 0 && DATE_LINE.test(lines[dateIndex].trim())) {
        date = lines[dateIndex].trim();
        cursor = dateIndex + 1;
      } else {
        throw new Error(`Chapter ${number} has an object anchor but no date.`);
      }
    } else if (number >= 3) {
      throw new Error(`Chapter ${number} is missing its object anchor.`);
    }

    const bodyEnd = position + 1 < starts.length
      ? starts[position + 1].headingIndex
      : lines.length;

    // Stop at the first structural marker in the body range. This removes
    // END markers, trailing act/part labels, and any repeated headings.
    let stop = bodyEnd;
    for (let i = cursor; i < bodyEnd; i += 1) {
      if (isStructural(lines[i].trim())) {
        stop = i;
        break;
      }
    }

    const paragraphs = [];
    for (let i = cursor; i < stop; i += 1) {
      const line = lines[i];
      if (line.trim() !== '') paragraphs.push(line);
    }

    if (paragraphs.length === 0) {
      throw new Error(`Chapter ${number} parsed with an empty body.`);
    }

    const wordCount = paragraphs.reduce((sum, p) => sum + countWords(p), 0);
    const expected = EXPECTED_WORDS[number];
    if (wordCount !== expected) {
      throw new Error(
        `Chapter ${number} word count ${wordCount} does not match expected ${expected}.`,
      );
    }

    return {
      number,
      title,
      paragraphs,
      wordCount,
      date,
      relic,
      part: number === 17 || number === 21 ? 'The Witness and the Bloom' : null,
    };
  });

  return chapters;
}

function assertClean(chapters) {
  const forbidden = [
    /END OF CHAPTER/i,
    /Object anchor:/i,
    /^ACT (?:I|II|III|IV):/i,
    /THE WITNESS AND THE BLOOM/,
    /^Chapter \d+$/,
  ];

  for (const chapter of chapters) {
    for (const paragraph of chapter.paragraphs) {
      for (const pattern of forbidden) {
        if (pattern.test(paragraph)) {
          throw new Error(
            `Structural leakage in chapter ${chapter.number}: ${pattern}`,
          );
        }
      }
    }

    if (chapter.number >= 3 && (!chapter.date || !chapter.relic)) {
      throw new Error(`Chapter ${chapter.number} is missing date/relic metadata.`);
    }
    if (chapter.number <= 2 && (chapter.date || chapter.relic)) {
      throw new Error(`Chapter ${chapter.number} should not have date/relic metadata.`);
    }
  }

  const total = chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0);
  if (total !== EXPECTED_TOTAL) {
    throw new Error(`Total body words ${total} do not equal ${EXPECTED_TOTAL}.`);
  }
}

function main() {
  const raw = fs.readFileSync(SOURCE_FILE, 'utf8');
  const chapters = parseNovel(raw);
  assertClean(chapters);

  const total = chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0);
  const book = {
    meta: {
      title: 'Perpetual Bloom and her Frozen Witness',
      source: 'Novel Draft(Me and Sravz).pdf',
      chapterCount: chapters.length,
      wordCount: total,
      generatedAt: new Date().toISOString(),
    },
    chapters,
  };

  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify(book, null, 2)}\n`, 'utf8');

  console.log(`Wrote ${path.relative(ROOT, OUTPUT_FILE)}`);
  console.log('Chapter  Words  Expected  Status  Title');
  for (const chapter of chapters) {
    const expected = EXPECTED_WORDS[chapter.number];
    const status = chapter.wordCount === expected ? 'ok' : 'FAIL';
    console.log(
      `${String(chapter.number).padStart(7)}  ${String(chapter.wordCount).padStart(5)}  ${String(expected).padStart(8)}  ${status.padEnd(6)}  ${chapter.title}`,
    );
  }
  console.log(`Total body words: ${total} (expected ${EXPECTED_TOTAL})`);
  console.log('Plaintext is NOT served. Re-seal it with:');
  console.log('  PB_PASSCODE=\'<edition-passcode>\' node scripts/encrypt-book.mjs');
}

main();
