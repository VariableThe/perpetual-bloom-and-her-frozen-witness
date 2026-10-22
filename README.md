# Perpetual Bloom and her Frozen Witness

An interactive, page-by-page web reader with chapter soundtracks and end-of-chapter galleries.

## Status

Novel text extracted to `src/data/novel.txt`; the extraction report is in `src/data/structure.md`. Story data, soundtrack config and original SVG artwork now live in `data/` and `assets/art/`. The web reader is not built yet.

## Content pipeline

- `npm run build:content` parses `src/data/novel.txt` into `data/book.json`.
- `npm run build:art` generates the cover, 21 chapter covers and 42 gallery plates in `assets/art/`.
- `npm run validate` checks chapter counts, word counts, metadata, audio palettes and SVG integrity.

No dependencies are required.
