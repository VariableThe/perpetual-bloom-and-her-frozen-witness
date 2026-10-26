# Chapter bookend images

This folder holds the **visual bookends** for every chapter: one picture shown
at the **beginning** of the chapter (opening bookend) and one shown at the
**end** of the chapter (closing bookend), following the Act → Chapter → Text
structure of the edition.

## How to swap or add images (no UI code changes needed)

1. Drop your image file(s) anywhere inside this folder, e.g.
   `assets/images/chapter-07-opening.svg` (SVG, PNG, JPG and WebP all work).
2. Open `bookends.json`, find the chapter entry, and point `opening` and/or
   `closing` at your new file path (relative to the repository root).
3. Commit and push — the reader picks the new art up automatically. The next
   Vercel deployment serves it with immutable caching.

```json
{
  "chapter": 7,
  "title": "The Sparrows That Kept Getting Up",
  "opening": "assets/images/chapter-07-opening.svg",
  "closing": "assets/images/chapter-07-closing.svg"
}
```

## Conventions

- `opening-default.svg` / `closing-default.svg` — shared placeholder plates used
  by every chapter until you override them. You can replace these two files to
  re-skin all bookends at once.
- `chapter-NN-opening.*` / `chapter-NN-closing.*` — optional per-chapter files
  (`NN` is the zero-padded chapter number, e.g. `chapter-03-opening.svg`).
- Prefer files under ~500 KB. SVGs scale cleanly; photos are served as-is by
  the static host with long-lived cache headers.

## Where they appear

- **Opening bookend** — framed plate at the top of each chapter's cover screen
  in the reader, captioned "Opening bookend".
- **Closing bookend** — framed plate at the top of each chapter's end gallery,
  captioned "Closing bookend", above the seeded plates and fan-art uploads.
