/* Load the decrypted novel (unlocked in the browser via lock.js) and merge
   it with the edition configuration. The sealed envelope data/book.enc.json
   is fetched and decrypted by the passcode gate; this module only consumes
   the in-memory plaintext, which is never written back to any storage. */

import { getBookData } from './lock.js';

const CONFIG_URL = new URL('../../data/story.config.json', import.meta.url);
const BOOKENDS_URL = new URL('../../assets/images/bookends.json', import.meta.url);

async function fetchJson(url, label) {
  let response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new Error(`Could not fetch ${label}. Start the local server and try again.`);
  }
  if (!response.ok) {
    throw new Error(`Could not fetch ${label} (HTTP ${response.status}).`);
  }
  try {
    return await response.json();
  } catch (error) {
    throw new Error(`${label} is not valid JSON.`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/* Chapter bookend art is optional: the mapping lives in the repository at
   assets/images/bookends.json so art can be swapped without touching UI code.
   A missing or invalid map simply leaves the slots empty. */
async function loadBookends() {
  try {
    const response = await fetch(BOOKENDS_URL);
    if (!response.ok) return null;
    const map = await response.json();
    if (!map || !Array.isArray(map.chapters)) return null;
    return {
      defaults: map.defaults || {},
      byChapter: new Map(map.chapters.map((entry) => [entry.chapter, entry]))
    };
  } catch (error) {
    return null;
  }
}

export async function loadStory() {
  const book = getBookData();
  const [config, bookends] = await Promise.all([
    fetchJson(CONFIG_URL, 'the edition configuration'),
    loadBookends()
  ]);

  assert(book && Array.isArray(book.chapters), 'the decrypted book is missing its chapters array.');
  assert(config && Array.isArray(config.chapters), 'story.config.json is missing its chapters array.');
  assert(Array.isArray(config.acts) && config.acts.length === 5, 'Expected five acts in the configuration.');
  assert(Array.isArray(config.tracks) && config.tracks.length === 21, 'Expected twenty-one soundtrack tracks.');

  const bookByNumber = new Map(book.chapters.map((chapter) => [chapter.number, chapter]));
  const trackByNumber = new Map(config.tracks.map((track) => [track.number, track]));
  const tracksById = new Map(config.tracks.map((track) => [track.id, track]));
  const actsById = new Map(config.acts.map((act) => [act.id, act]));

  const chapters = config.chapters.map((entry) => {
    const source = bookByNumber.get(entry.number);
    assert(source, `Chapter ${entry.number} is missing from the decrypted book.`);
    assert(Array.isArray(source.paragraphs) && source.paragraphs.length > 0, `Chapter ${entry.number} has no prose.`);

    const act = actsById.get(entry.actId);
    assert(act, `Chapter ${entry.number} refers to an unknown act "${entry.actId}".`);

    const track = trackByNumber.get(entry.number) || tracksById.get(entry.trackId);
    assert(track, `Chapter ${entry.number} has no soundtrack track.`);

    const bookend = bookends?.byChapter.get(entry.number) || {};
    const openingBookend = bookend.opening || bookends?.defaults.opening || null;
    const closingBookend = bookend.closing || bookends?.defaults.closing || null;

    return {
      number: entry.number,
      title: entry.title || source.title,
      part: entry.part || source.part || null,
      date: entry.date || source.date || null,
      relic: entry.relic || source.relic || null,
      accent: entry.accent || '#D76C9B',
      coverArt: entry.coverArt,
      galleryPlates: entry.galleryPlates,
      galleryPrompt: entry.galleryPrompt,
      openingBookend,
      closingBookend,
      wordCount: entry.wordCount || source.wordCount,
      trackId: entry.trackId,
      track,
      act,
      actId: entry.actId,
      paragraphs: source.paragraphs.slice()
    };
  });

  assert(chapters.length === 21, `Expected twenty-one chapters, found ${chapters.length}.`);
  assert(new Set(chapters.map((chapter) => chapter.number)).size === 21, 'Chapter numbers are not unique.');

  const chaptersByNumber = new Map(chapters.map((chapter) => [chapter.number, chapter]));

  const acts = config.acts.map((actConfig) => {
    const actChapters = actConfig.chapterNumbers
      .map((number) => chaptersByNumber.get(number))
      .filter(Boolean);

    return {
      ...actConfig,
      chapters: actChapters,
      wordCount: actChapters.reduce((total, chapter) => total + (chapter.wordCount || 0), 0),
      accent: actChapters[0] ? actChapters[0].accent : '#D76C9B',
      firstChapter: actChapters.length ? actChapters[0].number : 1,
      lastChapter: actChapters.length ? actChapters[actChapters.length - 1].number : 1
    };
  });

  const meta = {
    ...config.meta,
    ...book.meta,
    title: config.meta?.title || book.meta?.title || 'Perpetual Bloom and her Frozen Witness',
    chapterCount: chapters.length,
    wordCount: chapters.reduce((total, chapter) => total + (chapter.wordCount || 0), 0)
  };

  return {
    meta,
    bookMeta: book.meta,
    config,
    acts,
    chapters,
    tracks: config.tracks,
    chaptersByNumber,
    tracksById,
    actsById
  };
}
