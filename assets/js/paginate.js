/* Measure real DOM height and split prose into page-sized paragraph fragments. */

import { clear } from './utils.js';

function tokenize(text) {
  const tokens = text.match(/\s*\S+\s*/g);
  if (tokens && tokens.join('') === text) return tokens;
  const fallback = text.split(/(\s+)/).filter((part) => part.length > 0);
  if (fallback.join('') === text) return fallback;
  return [text];
}

export function paginateChapter(chapter, { probe, width, height }) {
  const paragraphs = chapter.paragraphs || [];
  const paragraphStarts = [];
  let totalChars = 0;

  for (const paragraph of paragraphs) {
    paragraphStarts.push(totalChars);
    totalChars += paragraph.length + 1;
  }

  probe.style.width = `${Math.max(120, width)}px`;
  probe.classList.add('is-first');
  clear(probe);

  const pages = [];
  let pagePieces = [];

  const maxHeight = Math.max(80, height);
  const fits = () => probe.getBoundingClientRect().height <= maxHeight + 0.25;

  function pushPage() {
    if (pagePieces.length === 0) return;
    pages.push({
      startGlobal: pagePieces[0].startGlobal,
      pieces: pagePieces
    });
    pagePieces = [];
    clear(probe);
  }

  for (let paragraphIndex = 0; paragraphIndex < paragraphs.length; paragraphIndex += 1) {
    const text = paragraphs[paragraphIndex];
    if (!text) continue;

    const tokens = tokenize(text);
    const tokenOffsets = new Array(tokens.length + 1);
    tokenOffsets[0] = 0;
    for (let index = 0; index < tokens.length; index += 1) {
      tokenOffsets[index + 1] = tokenOffsets[index] + tokens[index].length;
    }

    let tokenIndex = 0;
    let continuation = false;

    while (tokenIndex < tokens.length) {
      const paragraphNode = document.createElement('p');
      if (continuation) paragraphNode.className = 'cont';
      probe.appendChild(paragraphNode);

      const remaining = tokens.length - tokenIndex;
      paragraphNode.textContent = tokens.slice(tokenIndex).join('');

      if (fits()) {
        pagePieces.push({
          paragraphIndex,
          text: paragraphNode.textContent,
          cont: continuation,
          startGlobal: paragraphStarts[paragraphIndex] + tokenOffsets[tokenIndex]
        });
        tokenIndex = tokens.length;
        break;
      }

      let low = 1;
      let high = remaining - 1;
      let best = 0;

      while (low <= high) {
        const middle = (low + high) >> 1;
        paragraphNode.textContent = tokens.slice(tokenIndex, tokenIndex + middle).join('');
        if (fits()) {
          best = middle;
          low = middle + 1;
        } else {
          high = middle - 1;
        }
      }

      if (best === 0) {
        if (pagePieces.length > 0) {
          probe.removeChild(paragraphNode);
          pushPage();
          probe.classList.remove('is-first');
          continuation = true;
          continue;
        }

        /* A viewport too short for even one word: place one token and move on
           rather than looping forever. */
        best = 1;
        paragraphNode.textContent = tokens[tokenIndex];
      } else {
        paragraphNode.textContent = tokens.slice(tokenIndex, tokenIndex + best).join('');
      }

      pagePieces.push({
        paragraphIndex,
        text: paragraphNode.textContent,
        cont: continuation,
        startGlobal: paragraphStarts[paragraphIndex] + tokenOffsets[tokenIndex]
      });

      tokenIndex += best;

      if (tokenIndex < tokens.length) {
        pushPage();
        probe.classList.remove('is-first');
        continuation = true;
      }
    }
  }

  pushPage();
  probe.classList.remove('is-first');
  clear(probe);

  if (pages.length === 0) {
    pages.push({ startGlobal: 0, pieces: [] });
  }

  return {
    pages,
    totalChars,
    width,
    height
  };
}

export function findPageForOffset(pages, offset) {
  if (!pages || pages.length === 0) return 0;
  let index = 0;
  for (let cursor = 0; cursor < pages.length; cursor += 1) {
    if (pages[cursor].startGlobal <= offset) index = cursor;
    else break;
  }
  return index;
}
