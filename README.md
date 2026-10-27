# Perpetual Bloom and her Frozen Witness

An interactive, local-first web reader for a novel in twenty-one chapters by Me and Sravz. The edition includes a landing page, a hash-routed reader with real text pagination and 3D page turns, twenty-one chapter covers, two gallery plates per chapter, end-of-chapter galleries for local fan-art uploads, and a live generative soundtrack for every chapter.

## Run the reader

You need Node.js 18 or newer. There are no dependencies to install.

```powershell
npm start
```

Then open <http://localhost:4173>. `npm run start:open` opens the browser only after the server is listening. On Windows you can also double-click `start.bat`, which does the same and falls back to Python 3 when Node.js is not installed.

Set `PORT` to use a different port:

```powershell
$env:PORT=8080; npm start
```

Opening `index.html` directly with `file://` will not work because the story data and JavaScript modules are fetched over HTTP.

## Reading

- `#/` — landing page and chapter archive
- `#/read/7/0` — chapter 7 cover
- `#/read/7/3` — chapter 7, third text page
- `#/read/7/gallery` — chapter 7 gallery

Use the arrow keys, Page Up/Page Down, the on-screen page buttons, click zones or a swipe to turn pages. `Home` opens the chapter cover, `End` opens its gallery, and `Esc` returns to the archive. Duo layout is enabled at 1000px and wider; below 1000px the reader stays single-page.

The chapter drawer, theme, text size and layout are stored only in the browser. The saved reading position stores a route token (`gallery` or a screen number) plus the character offset of the current text page, so Continue survives text-size, layout and viewport changes without turning a saved gallery into a text page. Records written by older builds are read as numeric tokens and upgraded when the next position is saved.

## Soundtrack

All 21 tracks are synthesized live with the Web Audio API. There are no audio files, samples, streams or third-party players. Each palette is built from its configured root, mode, tempo, chord progression, pad, chime, density, brightness, air and bell settings, then arranged into a slow eight-chord arc.

- **Start from a gesture.** Browsers require a click, tap or key press before audio can begin. Use **Begin with sound** on the landing page, a track's play button, or the reader's audio bar.
- **Chapter changes crossfade.** Opening a different chapter while playing moves to that chapter's palette. Turning pages within a chapter leaves the music alone.
- **Leaving the reader pauses.** Returning to the archive, the end of the book, or leaving/hiding the tab pauses playback. It never auto-resumes.
- **Controls.** Play/pause, previous/next track, mute, volume, loop and the full track drawer are available in the reader. The drawer also links each track to its chapter.
- **Loop is optional.** With loop off, the current eight-chord arc finishes and the track stops cleanly.
- **Unsupported browsers stay readable.** If Web Audio is unavailable, the player says so and disables its controls; reading is unaffected.

Volume, mute and loop are remembered in `localStorage` under `pb.audio.v1`. Playing state is deliberately not saved. The audio bar is a normal part of the reader layout, not a floating overlay.

## Chapter galleries

Every chapter's final screen is an end-of-chapter gallery. It shows the chapter's two original plates (a **Bloom plate 01** and a **Relic plate 02**) and a dropzone for your own fan art. Everything stays on your device.

- **Add art.** Use **Add images** or drag files onto the dropzone. Accepted formats are JPEG, PNG, WebP and AVIF (when the browser can decode it). Up to 15 MB per file, 10 files per batch and 60 images per chapter.
- **Optimised locally.** Each image is decoded, its EXIF orientation is respected, its longest edge is scaled down to at most 1800px (never upscaled) and it is re-encoded to WebP at quality 0.86 — or JPEG on white when WebP is unavailable. Transparency is kept when it can be. The raw file is never stored.
- **Titles and artists.** A title is derived from the filename; the artist starts blank. Use **Edit** on any card to change the title (required, up to 80 characters) and the optional artist (up to 60 characters).
- **Lightbox.** Click any plate or addition to open a full-screen viewer over one sequence of plates and uploads. Arrow keys or the Prev/Next buttons move through it, `Esc` closes it, and a backdrop click closes it too. Focus returns to the card you opened.
- **Delete.** The **Delete** button asks once (`Delete?`) before removing the record and its blob. There is no undo.
- **Local-only storage.** Artworks live in IndexedDB under the `perpetual-bloom-gallery` database (object store `artworks`, indexed by chapter). Nothing is uploaded, there are no accounts or analytics, and no network request is made. The gallery footer shows the count and the human-readable size for the current chapter and the note "Saved only in this browser".
- **Clearing it.** Removing the site's data (browser settings → site data, or the storage pane in DevTools) deletes the database and every stored image.
- **Caveats.** Browsers can apply a storage quota and can evict "best effort" data under pressure. Private/incognito windows usually discard IndexedDB when they close, and some browsers block storage in embedded contexts. If IndexedDB is unavailable or blocked, the gallery says so inline and the original plates remain readable — images are never moved to `localStorage`.

The two seeded plates are original SVG artwork made for this edition; they remain part of the repository and are not affected by uploads.

## Private edition gate

The edition opens behind a passcode lock screen. The passcode is shared
privately with the recipient and never appears in this repo: the served
tree carries only the sealed envelope `data/book.enc.json` (AES-256-GCM,
key derived from the passcode with PBKDF2-SHA256 at 210,000 iterations).
Entering the passcode derives the key and decrypts the novel in the
browser; anything else is denied with the invalid-pin message. Only the
derived key is remembered in the browser (this session, or on the device
when the checkbox is ticked) — never the passcode, never the plaintext.
The backdrop is a crystallized pink / white / purple gradient layer
(`assets/css/crystal.css`, `#crystal-bg`) that sits behind the ambient
canvas in both themes.

Plaintext pipeline: `src/data/novel.txt` → `content/book.json` (never
served) → `data/book.enc.json` (sealed, served). After any content edit:

```powershell
npm run build:content
$env:PB_PASSCODE='<edition-passcode>'; npm run encrypt:book
npm run validate
```

## Chapter bookends

Every chapter shows an **opening bookend** plate on its cover screen and a
**closing bookend** plate at the top of its end gallery, following the
Act → Chapter → Text structure (Act → Chapter navigation lives in the archive
cards and the reader's chapter drawer).

Art is mapped in `assets/images/bookends.json` (21 chapters plus shared
defaults). To swap art, drop a file into `assets/images/` and point the
chapter entry at it — see `assets/images/README.md`. No UI code changes are
required; missing files hide their slot instead of breaking the page.

## What is local

Everything is served from this repository. Fonts are bundled WOFF2 files with their OFL licences in `assets/fonts/`, artwork is original SVG in `assets/art/`, and there are no runtime network requests, analytics or accounts. The soundtrack is generated in the browser; no note, buffer or request leaves the page. Fan art you add is optimised on your device and stored only in this browser's IndexedDB, so it also never leaves the machine.

## Validate

```powershell
npm test
```

This runs focused navigation/persistence unit tests, the content validator and the site validator. The content validator checks chapter counts, word counts, metadata, soundtrack palettes and SVG integrity. The site validator checks the reader shell, audio shell, gallery shell, local references, module imports, font files, artwork paths and the no-external-runtime-request rule.

For the headless audio smoke test:

```powershell
npm run qa:audio
```

It drives the installed Microsoft Edge in headless mode and writes screenshots to `qa/audio/`. The test verifies UI state and graph lifecycle, not audible quality.

For the headless gallery smoke test:

```powershell
npm run qa:gallery
```

It drives Edge/Chrome through the Chrome DevTools Protocol and writes screenshots to `qa/gallery/`. The test uploads generated fixture images through the real file input, then checks IndexedDB persistence across a reload, the lightbox, editing, deletion, validation errors and responsive layouts.

For the headless cover-page smoke test:

```powershell
npm run qa:cover
```

It writes screenshots to `qa/cover/`, verifies the HTML cover overlay fits at desktop, mobile and short viewports without horizontal overflow, and checks that the chapter SVGs contain no embedded readable chapter labels or titles.

## Content pipeline

```powershell
npm run build:content
npm run build:art
npm run validate
```

- `build:content` parses `src/data/novel.txt` into `content/book.json` (plaintext, never served).
- `encrypt:book` seals `content/book.json` into `data/book.enc.json` (needs `PB_PASSCODE` in the environment).
- `build:art` generates the cover, 21 chapter covers and 42 gallery plates in `assets/art/`.
- `validate` checks both the content pipeline output and the static site.

## Layout

```text
index.html              landing page and reader shell
start.bat               Windows one-click server launcher
server.mjs              zero-dependency local static server
assets/css/             design tokens, landing, reader, audio and gallery styles
assets/js/              data loading, routing, pagination, reading UI, audio engine and gallery
assets/fonts/           local variable fonts and OFL licences
assets/art/             original covers and gallery plates
data/                   generated book data and edition configuration
scripts/                content, artwork, site validation and headless QA harnesses
src/data/               source novel text and extraction notes
```
