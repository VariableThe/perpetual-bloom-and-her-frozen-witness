# Extraction report — *Novel Draft (Me and Sravz)*

- **Source PDF:** `D:\mentor project\Novel Draft(Me and Sravz).pdf`
- **Extracted text:** `src/data/novel.txt`
- **Extraction date:** 22 October 2026
- **Tooling:** Python 3.13.5 + PyMuPDF 2.0 (MuPDF 1.28.5), no OCR

## 1. At a glance

| Item | Value |
|---|---:|
| PDF pages | 143 |
| Pages with extractable text | 143 / 143 |
| Pages that are image-only | 0 |
| Extracted characters (UTF-8, including spaces and newlines) | 456,678 |
| Total words (whitespace-delimited) | 86,654 |
| Narrative body words (excludes headings, metadata, dates and END markers) | 85,846 |
| Logical blocks in `novel.txt` (paragraphs, headings, metadata, dates, END markers) | 1,113 |
| Text lines in `novel.txt` | 2,236 |
| Non-whitespace characters | 368,912 |
| Embedded PDF outline entries | 4 (incomplete) |
| OCR used | No |

**Integrity check.** After deleting the PDF's zero-width spaces, the PDF text and
`novel.txt` contain exactly the same **368,912 non-whitespace characters** in the
same order, and both yield **86,654 words**. The one-token difference between the
raw PDF token count (86,655) and the cleaned count (86,654) comes from a standalone
zero-width-space line on p. 71, which is formatting noise rather than a word. No
text was lost.

## 2. Title, author and front matter, as printed

**Printed in the document:** there is **no title page, author byline, copyright
page, dedication, epigraph or contents page**. Page 1 begins directly with the
chapter heading `Chapter 1`. The first printed words are:

> Chapter 1 — The Book That Introduced Her to Him

The project title *Perpetual Bloom and her Frozen Witness* is not printed anywhere
in the PDF; it comes from the repository brief. The phrase "Me and Sravz" appears
only in the PDF title metadata and the filename.

**PDF metadata:**

| Field | Value |
|---|---|
| Title | `Novel Draft:(Me and Sravz)` |
| Author | *(blank)* |
| Subject / Keywords | *(blank)* |
| Creator | *(blank)* |
| Producer | `Skia/PDF m158 Google Docs Renderer` |
| PDF format | PDF 1.4 |
| Encryption | None |

**Filename:** `Novel Draft(Me and Sravz).pdf`.

No author is named anywhere in the printed text or metadata. The embedded outline
lists only `Chapter 1` + its title (p. 1) and `Chapter 2` + its title (p. 12); it
omits every later chapter.

## 3. Headings, in order

Word counts are **chapter body words only**: they run from the first body paragraph
after the chapter's `Object anchor` / date metadata to the line before
`END OF CHAPTER N`. Headings, metadata, dates and `END OF CHAPTER` markers are
excluded. Act, part and title rows therefore show `—`; the chapter row carries the
count for that chapter. `Body lines` are 1-based line numbers in `novel.txt`.

| # | Line | PDF p. | Heading | Type | Body lines | Words |
|---:|---:|---:|---|---|---|---:|
| 1 | 1 | 1 | Chapter 1 | Chapter heading | 5–353 | 4,633 |
| 2 | 3 | 1 | The Book That Introduced Her to Him | Chapter title | — | — |
| 3 | 355 | 12 | Chapter 2 | Chapter heading | 359–655 | 4,535 |
| 4 | 357 | 12 | The Arrow That Became a Heart | Chapter title | — | — |
| 5 | 657 | 23 | ACT I: THE ARRIVAL | Act heading | — | — |
| 6 | 659 | 23 | Chapter 3 | Chapter heading | 667–895 | 3,843 |
| 7 | 661 | 23 | The Clover and the Home | Chapter title | — | — |
| 8 | 899 | 31 | ACT I: THE ARRIVAL | Act heading | — | — |
| 9 | 901 | 31 | Chapter 4 | Chapter heading | 909–1097 | 4,502 |
| 10 | 903 | 31 | The Things She Could Not Replace | Chapter title | — | — |
| 11 | 1101 | 40 | ACT I: THE ARRIVAL | Act heading | — | — |
| 12 | 1103 | 40 | Chapter 5 | Chapter heading | 1111–1241 | 4,322 |
| 13 | 1105 | 40 | The Hair Clip at 7:02 | Chapter title | — | — |
| 14 | 1245 | 48 | ACT II: THE ACCUMULATION | Act heading | — | — |
| 15 | 1247 | 48 | Chapter 6 | Chapter heading | 1255–1327 | 4,417 |
| 16 | 1249 | 48 | The First Sip | Chapter title | — | — |
| 17 | 1331 | 54 | ACT II: THE ACCUMULATION | Act heading | — | — |
| 18 | 1333 | 54 | Chapter 7 | Chapter heading | 1341–1399 | 5,080 |
| 19 | 1335 | 54 | The Sparrows That Kept Getting Up | Chapter title | — | — |
| 20 | 1403 | 62 | ACT II: THE ACCUMULATION | Act heading | — | — |
| 21 | 1405 | 62 | Chapter 8 | Chapter heading | 1413–1453 | 3,381 |
| 22 | 1407 | 62 | The Memory Box | Chapter title | — | — |
| 23 | 1457 | 67 | ACT II: THE ACCUMULATION | Act heading | — | — |
| 24 | 1459 | 67 | Chapter 9 | Chapter heading | 1467–1499 | 2,735 |
| 25 | 1461 | 67 | The Sentence "I Noticed" | Chapter title | — | — |
| 26 | 1503 | 71 | ACT II: THE ACCUMULATION | Act heading | — | — |
| 27 | 1505 | 71 | Chapter 10 | Chapter heading | 1513–1553 | 3,944 |
| 28 | 1507 | 71 | 4:11 | Chapter title | — | — |
| 29 | 1557 | 77 | ACT II: THE ACCUMULATION | Act heading | — | — |
| 30 | 1559 | 77 | Chapter 11 | Chapter heading | 1567–1597 | 3,047 |
| 31 | 1561 | 77 | The Goku Figurine | Chapter title | — | — |
| 32 | 1601 | 81 | ACT II: THE ACCUMULATION | Act heading | — | — |
| 33 | 1603 | 81 | Chapter 12 | Chapter heading | 1611–1645 | 2,673 |
| 34 | 1605 | 81 | The Hot Pink Note | Chapter title | — | — |
| 35 | 1649 | 85 | ACT III: THE RELICS | Act heading | — | — |
| 36 | 1651 | 85 | Chapter 13 | Chapter heading | 1659–1707 | 3,620 |
| 37 | 1653 | 85 | The Bracelet and the Dried Petals | Chapter title | — | — |
| 38 | 1711 | 91 | ACT III: THE RELICS | Act heading | — | — |
| 39 | 1713 | 91 | Chapter 14 | Chapter heading | 1721–1767 | 3,188 |
| 40 | 1715 | 91 | The Dried Petal Returns | Chapter title | — | — |
| 41 | 1771 | 96 | ACT III: THE RELICS | Act heading | — | — |
| 42 | 1773 | 96 | Chapter 15 | Chapter heading | 1781–1815 | 2,602 |
| 43 | 1775 | 96 | The First Metro | Chapter title | — | — |
| 44 | 1819 | 100 | ACT III: THE RELICS | Act heading | — | — |
| 45 | 1821 | 100 | Chapter 16 | Chapter heading | 1829–1871 | 4,212 |
| 46 | 1823 | 100 | The Penguin in the Pocket | Chapter title | — | — |
| 47 | 1875 | 106 | THE WITNESS AND THE BLOOM | Part heading | — | — |
| 48 | 1877 | 106 | ACT III: THE RELICS | Act heading | — | — |
| 49 | 1879 | 106 | Chapter 17 | Chapter heading | 1887–1941 | 5,423 |
| 50 | 1881 | 106 | The Rose That Knows It Will Wilt | Chapter title | — | — |
| 51 | 1945 | 114 | ACT III: THE RELICS | Act heading | — | — |
| 52 | 1947 | 114 | Chapter 18 | Chapter heading | 1955–2017 | 7,049 |
| 53 | 1949 | 114 | The Hoodie, the Straw, and the Bouquet | Chapter title | — | — |
| 54 | 2021 | 124 | ACT IV: THE TURNING | Act heading | — | — |
| 55 | 2023 | 124 | Chapter 19 | Chapter heading | 2031–2097 | 4,059 |
| 56 | 2025 | 124 | 7:02 / 7:03 | Chapter title | — | — |
| 57 | 2101 | 131 | Chapter 20 | Chapter heading | 2109–2162 | 4,185 |
| 58 | 2103 | 131 | The Letter That Crosses Distance | Chapter title | — | — |
| 59 | 2166 | 137 | THE WITNESS AND THE BLOOM | Part heading | — | — |
| 60 | 2168 | 137 | ACT IV: THE TURNING | Act heading | — | — |
| 61 | 2170 | 137 | Chapter 21 | Chapter heading | 2178–2234 | 4,396 |
| 62 | 2172 | 137 | The Folding of the Final Crane | Chapter title | — | — |

### Words by act

| Section | Chapters | Words |
|---|---|---:|
| Unlabelled opening | Chapters 1–2 | 9,168 |
| ACT I: THE ARRIVAL | Chapters 3–5 | 12,667 |
| ACT II: THE ACCUMULATION | Chapters 6–12 | 25,277 |
| ACT III: THE RELICS | Chapters 13–18 | 26,094 |
| ACT IV: THE TURNING | Chapters 19–21 | 12,640 |
| **Total** | **Chapters 1–21** | **85,846** |

The printed act labels are repeated above individual chapters rather than appearing
once per act. `ACT I: THE ARRIVAL` first appears above Chapter 3; Chapters 1–2 have
no act label. `THE WITNESS AND THE BLOOM` is an unnumbered part/section heading
that appears twice, before Chapter 17 and again before Chapter 21. Chapter 20 has no
act label. There are **21 explicit chapters**, so no manual chapter division is
needed.

## 4. Structural markers

`END OF CHAPTER` markers are preserved as printed. There are **19**, because
Chapters 1 and 2 have no end marker.

| Chapter | Line in `novel.txt` |
|---:|---:|
| 3 | 897 |
| 4 | 1,099 |
| 5 | 1,243 |
| 6 | 1,329 |
| 7 | 1,401 |
| 8 | 1,455 |
| 9 | 1,501 |
| 10 | 1,555 |
| 11 | 1,599 |
| 12 | 1,647 |
| 13 | 1,709 |
| 14 | 1,769 |
| 15 | 1,817 |
| 16 | 1,873 |
| 17 | 1,943 |
| 18 | 2,019 |
| 19 | 2,099 |
| 20 | 2,164 |
| 21 | 2,236 |

No unlabelled scene-break glyphs, asterisks or page markers were found. There is
one printed horizontal rule (a scene break) on p. 105; see the formatting notes
below. The chapter, act and part headings are the other printed structural
divisions.

## 5. Formatting, illustrations and extraction notes

- **No illustrations or images.** Every page was checked with PyMuPDF; there are
  zero raster/embedded image objects. Each page has a full-page white background
  rectangle, and p. 105 additionally has one thin grey horizontal rule. There are
  **0 image-only pages**, so no OCR was used.
- **One scene-break rule on p. 105.** The rule sits between the paragraph ending
  "walked away carrying all of her." (line 1,859) and "She called at ten, from under
  a blanket…" (line 1,861). It is a visual separator, not text, so it is not encoded
  as a character in `novel.txt`; the paragraph break is preserved. No other rules
  or separators were found.
- **Emoji glyphs.** The only graphical characters are four Type3-font glyphs:
  U+1F340 four-leaf clover (p. 10), U+1F602 face with tears of joy (p. 13), and
  U+2764 U+FE0F heavy black heart twice (p. 73). All were extracted as correct
  Unicode.
- **No page headers, footers or page numbers** were found, so none were removed.
  Only zero-width spaces (U+200B, 89 occurrences) and repeated whitespace were
  stripped as Google Docs formatting artifacts.
- **Chapter heading sizes are inconsistent.** Chapter 1 is 23 pt with a 17 pt
  title; Chapter 2 is 23 pt throughout. From Chapter 3 onward the headings are set
  at the 11 pt body size, except Chapter 6 at 10 pt. Weight also changes: Chapters
  3–6 and 16 are bold; Chapters 7–15 and 17–21 are regular (non-bold). Headings were
  therefore detected by text pattern as well as font size.
- **Chapter 6 (pp. 48–53) is set in 10 pt**, unlike the 11 pt used elsewhere.
- **The `ACT IV: THE TURNING` label on p. 124 is 8 pt**, much smaller than the act
  labels elsewhere (10–11 pt).
- **Chapter 19's heading is split across a page break:** `Chapter 19` and
  `7:02 / 7:03` sit at the bottom of p. 124; its `Object anchor`/date metadata sits
  at the top of p. 125. The logical order is preserved in `novel.txt`.
- **Chapter 20 has no act label.** Page 131 begins directly with `Chapter 20`;
  there is no `ACT IV` line above it.
- **Verse is preserved line by line.** `The First Bloom` (p. 130) and the untitled
  four-line poem beginning "If the map should ever fold us into separate halves"
  (p. 132) are set in short italic lines. Their line breaks were retained instead
  of being collapsed into prose paragraphs.
- **Italic marginal lines** (for example `Kept.`, `Noticed.`, `Held.`,
  `Not taken. Given.`) are preserved as separate paragraphs, exactly where the
  PDF sets them.
- **Metadata lines are preserved.** Each chapter's `Object anchor: … · Supporting:
  …` line and its date line are kept, with PDF line wraps rejoined. The middle dot
  (`·`) is retained.
- **Paragraph reconstruction.** PDF text blocks were treated as paragraphs and
  their hard-wrapped visual lines were joined with spaces. Paragraphs that run
  across a page break were rejoined when the next page begins lowercase; this was
  checked against every page boundary. No hyphenated line-end breaks were found,
  so no dehyphenation was needed.
- **Whitespace-only blocks ignored.** A few trailing 8 pt/17 pt blocks containing
  only a space (notably on pp. 22 and 136) were skipped.
- **No missing text.** All 143 pages have a real text layer; the shortest page
  (p. 143) still contains 1,158 characters and the longest (p. 49) 5,061. No page
  required OCR.

## 6. Verification

`novel.txt` is non-empty: **456,678 characters, 86,654 words, 2,236 lines**.

First 300 characters (chapter heading/title followed by prose):

```text
Chapter 1

The Book That Introduced Her to Him

Years from now, or perhaps only hours Zero had stopped trusting the difference he would open a journal to its first page and find a sentence in his own handwriting that he did not remember writing, and the sentence would be this: You came, you saw, and
```

Last 300 characters (the excerpt begins mid-word by construction; it is the closing
prose followed by the final structural marker):

```text
eadsheet, with its beak pointed at the title as though it had been reading. He would turn it over. The left wing would carry a small crescent groove. The right would be fractionally short. The neck would be pinched too hard. He would put his thumb to the groove, and it would fit.

END OF CHAPTER 21
```

The opening excerpt is genuine prose after the heading and title; the closing
excerpt is the final paragraph plus `END OF CHAPTER 21`. Neither contains extraction
noise. `novel.txt` is UTF-8 **without BOM**, uses `\n` line endings, and contains no
U+FFFD replacement characters, no remaining zero-width spaces and no tabs. All 143
pages produced text; no page failed extraction.
