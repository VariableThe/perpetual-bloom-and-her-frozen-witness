/* Load and merge the extracted novel with the edition configuration. */

const BOOK_URL = new URL('../../data/book.json', import.meta.url);
const CONFIG_URL = new URL('../../data/story.config.json', import.meta.url);

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

export async function loadStory() {
  const [book, config] = await Promise.all([
    fetchJson(BOOK_URL, 'the story data'),
    fetchJson(CONFIG_URL, 'the edition configuration')
  ]);

  assert(book && Array.isArray(book.chapters), 'book.json is missing its chapters array.');
  assert(config && Array.isArray(config.chapters), 'story.config.json is missing its chapters array.');
  assert(Array.isArray(config.acts) && config.acts.length === 5, 'Expected five acts in the configuration.');
  assert(Array.isArray(config.tracks) && config.tracks.length === 21, 'Expected twenty-one soundtrack tracks.');

  const bookByNumber = new Map(book.chapters.map((chapter) => [chapter.number, chapter]));
  const trackByNumber = new Map(config.tracks.map((track) => [track.number, track]));
  const tracksById = new Map(config.tracks.map((track) => [track.id, track]));
  const actsById = new Map(config.acts.map((act) => [act.id, act]));

  const chapters = config.chapters.map((entry) => {
    const source = bookByNumber.get(entry.number);
    assert(source, `Chapter ${entry.number} is missing from book.json.`);
    assert(Array.isArray(source.paragraphs) && source.paragraphs.length > 0, `Chapter ${entry.number} has no prose.`);

    const act = actsById.get(entry.actId);
    assert(act, `Chapter ${entry.number} refers to an unknown act "${entry.actId}".`);

    const track = trackByNumber.get(entry.number) || tracksById.get(entry.trackId);
    assert(track, `Chapter ${entry.number} has no soundtrack track.`);

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
