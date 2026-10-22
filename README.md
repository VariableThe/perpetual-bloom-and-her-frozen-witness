# Perpetual Bloom and her Frozen Witness

An interactive, local-first web reader for a novel in twenty-one chapters by Me and Sravz. The edition includes a landing page, a hash-routed reader with real text pagination and 3D page turns, twenty-one chapter covers, and two gallery plates per chapter.

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

## What is local

Everything is served from this repository. Fonts are bundled WOFF2 files with their OFL licences in `assets/fonts/`, artwork is original SVG in `assets/art/`, and there are no runtime network requests, analytics or accounts.

Audio playback and fan-art uploads are honestly deferred to Phase 2. The tracklist maps every chapter to its generative palette, and the gallery and `#audio-dock` include labelled Phase 2 hooks, but neither feature pretends to be active yet. Uploads will use IndexedDB and stay on the device when implemented.

## Validate

```powershell
npm test
```

This runs focused navigation/persistence unit tests, the content validator and the site validator. The content validator checks chapter counts, word counts, metadata, soundtrack palettes and SVG integrity. The site validator checks the reader shell, local references, module imports, font files, artwork paths and the no-external-runtime-request rule.

## Content pipeline

```powershell
npm run build:content
npm run build:art
npm run validate
```

- `build:content` parses `src/data/novel.txt` into `data/book.json`.
- `build:art` generates the cover, 21 chapter covers and 42 gallery plates in `assets/art/`.
- `validate` checks both the content pipeline output and the static site.

## Layout

```text
index.html              landing page and reader shell
start.bat               Windows one-click server launcher
server.mjs              zero-dependency local static server
assets/css/             design tokens, landing and reader styles
assets/js/              data loading, routing, pagination and reading UI
assets/fonts/           local variable fonts and OFL licences
assets/art/             original covers and gallery plates
data/                   generated book data and edition configuration
scripts/                content, artwork and site validation
src/data/               source novel text and extraction notes
```
