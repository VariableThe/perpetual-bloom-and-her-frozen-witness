/* Render the landing page from data/book.json + story.config.json. */

import {
  el,
  clear,
  formatNumber,
  splitRelic,
  getSavedPosition,
  prefersReducedMotion
} from './utils.js';

function chapterHref(number, page = 0) {
  return `#/read/${number}/${page}`;
}

function padded(number) {
  return String(number).padStart(2, '0');
}

function coverAlt(chapter) {
  return `Cover artwork for Chapter ${chapter.number}, ${chapter.title}`;
}

function renderHeroStats(story) {
  const host = document.getElementById('hero-stats');
  if (!host) return;
  clear(host);

  const galleryCount = story.chapters.filter((chapter) => chapter.galleryPlates?.length).length;
  const stats = [
    [story.chapters.length, 'chapters'],
    [formatNumber(story.meta.wordCount), 'words'],
    [story.tracks.length, 'generative tracks'],
    [galleryCount, 'chapter galleries']
  ];

  for (const [value, label] of stats) {
    host.append(el('li', {}, [
      el('strong', { text: value }),
      el('span', { text: label })
    ]));
  }
}

function renderHeroCtas(audio, navigate) {
  const host = document.getElementById('hero-ctas');
  if (!host) return;
  clear(host);

  const soundReady = Boolean(audio && audio.supported);
  const begin = el('button', {
    class: 'btn btn--primary',
    type: 'button',
    disabled: !soundReady,
    title: soundReady ? 'Start Chapter 1 with its soundtrack' : 'WebAudio is unavailable in this browser'
  }, [
    soundReady ? 'Begin with sound' : 'Sound unavailable',
    el('span', { 'aria-hidden': 'true', text: soundReady ? '▶' : '·' })
  ]);

  begin.addEventListener('click', () => {
    if (!soundReady) return;
    audio.playTrack(1);
    if (typeof navigate === 'function') navigate(chapterHref(1, 0));
    else location.hash = chapterHref(1, 0);
  });
  host.append(begin);

  const saved = getSavedPosition();
  if (saved) {
    const chapter = saved.chapter;
    const suffix = saved.token === 'gallery' ? ' · gallery' : '';
    host.append(el('a', {
      class: 'btn btn--ghost',
      href: chapterHref(chapter, saved.token)
    }, [
      `Continue · Chapter ${chapter}${suffix}`,
      el('span', { 'aria-hidden': 'true', text: '↩' })
    ]));
  } else {
    host.append(el('a', { class: 'btn btn--ghost', href: chapterHref(1, 0) }, [
      'Read silently',
      el('span', { 'aria-hidden': 'true', text: '→' })
    ]));
  }
}

function renderActs(story) {
  const host = document.getElementById('act-list');
  if (!host) return;
  clear(host);

  for (const act of story.acts) {
    const card = el('article', {
      class: 'act-card reveal',
      style: { '--act-accent': act.accent },
      'aria-labelledby': `act-title-${act.id}`
    });

    const watermark = el('span', {
      class: 'act-card__watermark',
      'aria-hidden': 'true',
      text: act.id === 'prologue' ? '✦' : act.roman
    });

    const roman = el('span', {
      class: 'act-head__roman',
      'aria-hidden': 'true',
      text: act.id === 'prologue' ? '✦' : act.roman
    });

    const meta = el('div', {}, [
      el('h3', { class: 'act-head__title', id: `act-title-${act.id}`, text: act.title }),
      el('p', { class: 'act-head__subtitle', text: act.subtitle }),
      el('p', { class: 'act-head__blurb', text: act.blurb })
    ]);

    const range = el('p', { class: 'act-head__range' }, [
      el('span', {}, [
        `Chapters ${act.firstChapter}–${act.lastChapter}`,
        ' · ',
        el('strong', { text: `${formatNumber(act.wordCount)} words` })
      ])
    ]);

    const head = el('div', { class: 'act-head' }, [roman, meta, range]);
    const grid = el('div', { class: 'chapter-grid' });

    for (const chapter of act.chapters) {
      const relic = splitRelic(chapter.relic);
      const kicker = el('p', { class: 'chapter-card__kicker' }, [
        el('span', { text: `Chapter ${chapter.number}` }),
        el('span', { text: `${formatNumber(chapter.wordCount)} words` })
      ]);

      const title = el('h4', { class: 'chapter-card__title', text: chapter.title });

      const relicNode = relic.primary
        ? el('p', { class: 'chapter-card__relic', text: relic.primary })
        : el('p', { class: 'chapter-card__relic chapter-card__relic--none', text: 'No object anchor' });

      const track = el('p', {
        class: 'chapter-card__track',
        text: `Track ${padded(chapter.track.number)} · ${chapter.track.title}`
      });

      const read = el('span', { class: 'chapter-card__read' }, [
        'Read chapter',
        el('span', { 'aria-hidden': 'true', text: '→' })
      ]);

      const body = el('div', { class: 'chapter-card__body' }, [kicker, title, relicNode, track, read]);

      const art = el('div', { class: 'chapter-card__art' }, [
        el('img', {
          src: chapter.coverArt,
          alt: coverAlt(chapter),
          width: 1000,
          height: 1400,
          loading: 'lazy',
          decoding: 'async'
        }),
        el('span', { class: 'chapter-card__num', 'aria-hidden': 'true', text: padded(chapter.number) })
      ]);

      const cardLink = el('a', {
        class: 'chapter-card',
        href: chapterHref(chapter.number, 0),
        'aria-label': `Read Chapter ${chapter.number}: ${chapter.title}`,
        style: { '--card-accent': chapter.accent }
      }, [art, body]);

      grid.append(cardLink);
    }

    card.append(watermark, head, grid);
    host.append(card);
  }
}

function renderGalleryPreviews(story) {
  const host = document.getElementById('gallery-preview');
  if (!host) return;
  clear(host);

  const preferred = [3, 7, 13, 18, 21];
  const previews = preferred
    .map((number) => story.chaptersByNumber.get(number))
    .filter(Boolean);

  for (const chapter of previews) {
    const plate = chapter.galleryPlates?.[0];
    if (!plate) continue;

    const link = el('a', {
      class: 'gallery-card',
      href: chapterHref(chapter.number, 'gallery'),
      'aria-label': `Open the gallery for Chapter ${chapter.number}: ${chapter.title}`
    }, [
      el('img', {
        src: plate,
        alt: chapter.galleryPrompt || `Bloom plate for Chapter ${chapter.number}, ${chapter.title}`,
        width: 1200,
        height: 900,
        loading: 'lazy',
        decoding: 'async'
      }),
      el('span', { class: 'gallery-card__body' }, [
        el('span', {}, [
          el('span', { class: 'gallery-card__eyebrow', text: `Chapter ${chapter.number} · Bloom plate` }),
          el('span', { class: 'gallery-card__title', text: chapter.title })
        ]),
        el('span', { class: 'gallery-card__open', 'aria-hidden': 'true', text: '→' })
      ])
    ]);

    host.append(link);
  }
}

function renderAbout(story) {
  const quote = document.getElementById('about-quote');
  const cite = document.getElementById('about-quote-cite');
  if (quote) quote.textContent = story.meta.openingQuote;
  if (cite) cite.textContent = '— Chapter 1';

  const creditsHost = document.getElementById('about-credits');
  if (creditsHost) {
    clear(creditsHost);
    const credits = story.meta.credits || {};
    const ordered = [
      ['Story', credits.story || 'Me and Sravz'],
      ['Source', credits.source || 'Novel Draft'],
      ['Text extraction', credits.textExtraction],
      ['Artwork', credits.artwork],
      ['Soundtrack', credits.soundtrack]
    ];
    for (const [term, description] of ordered) {
      if (!description) continue;
      creditsHost.append(el('div', {}, [
        el('dt', { text: term }),
        el('dd', { text: description })
      ]));
    }
  }

  const noteHost = document.getElementById('about-note');
  if (noteHost) {
    clear(noteHost);
    noteHost.append(
      el('p', {}, [
        el('strong', { text: 'Me and Sravz. ' }),
        'Original SVG artwork and a live generative WebAudio score were made for this edition. All twenty-one chapters are presented from the extracted novel text.'
      ]),
      el('p', {}, [
        el('strong', { text: 'Local-first. ' }),
        'No accounts, no analytics and no runtime network requests. Reading position, theme, type and soundtrack settings stay in this browser. Fan-art uploads are not part of this build yet; when they arrive they will stay on this device too.'
      ]),
      el('p', {}, [
        'Inspired by interactive fan-comic readers. No Attack on Titan artwork, music or lyrics are used, and this edition is not affiliated with any existing work, publisher or rights holder.'
      ]),
      el('span', { class: 'phase-pill', text: 'Sound on · 21 generative tracks' })
    );
  }

  const footer = document.getElementById('footer-meta');
  if (footer) {
    clear(footer);
    footer.append(
      el('p', { text: `${story.meta.title} · ${story.chapters.length} chapters · ${formatNumber(story.meta.wordCount)} words` }),
      el('p', { text: 'Original SVG art · local-first · no tracking · no external requests' })
    );
  }
}

function initReveal() {
  const nodes = Array.from(document.querySelectorAll('.reveal'));
  if (!nodes.length) return;

  if (prefersReducedMotion() || !('IntersectionObserver' in window)) {
    nodes.forEach((node) => node.classList.add('is-visible'));
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });

  nodes.forEach((node) => observer.observe(node));
}

function initMobileNav() {
  const header = document.getElementById('site-header');
  const toggle = document.getElementById('nav-toggle');
  const nav = document.getElementById('site-nav');
  if (!header || !toggle || !nav) return;

  function setOpen(open) {
    header.classList.toggle('is-nav-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  }

  toggle.addEventListener('click', () => {
    setOpen(!header.classList.contains('is-nav-open'));
  });

  nav.addEventListener('click', (event) => {
    if (event.target.closest('a')) setOpen(false);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && header.classList.contains('is-nav-open')) {
      setOpen(false);
      toggle.focus();
    }
  });

  document.addEventListener('click', (event) => {
    if (!header.classList.contains('is-nav-open')) return;
    if (!header.contains(event.target)) setOpen(false);
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 900) setOpen(false);
  });
}

function initEndingToast() {
  const toast = document.getElementById('ending-toast');
  if (!toast) return null;
  let timer = 0;

  return {
    show(message) {
      const text = toast.querySelector('p');
      if (text) text.textContent = message;
      toast.hidden = false;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        toast.hidden = true;
      }, 7200);
    },
    hide() {
      window.clearTimeout(timer);
      toast.hidden = true;
    }
  };
}

export function initLanding(story, { navigate, audio = null }) {
  const landingView = document.getElementById('landing-view');
  const echo = initEndingToast();

  document.getElementById('hero-eyebrow').textContent =
    `A novel in ${story.chapters.length} chapters · ${story.meta.authors || 'Me and Sravz'}`;
  document.getElementById('hero-tagline').textContent = story.meta.tagline || story.meta.description || '';
  document.getElementById('hero-quote').textContent = story.meta.openingQuote || '';
  document.getElementById('hero-quote-cite').textContent = '— Chapter 1';

  const cover = document.getElementById('hero-cover');
  if (cover) {
    cover.src = story.meta.coverArt;
    cover.alt = `Cover of ${story.meta.title}`;
  }

  const aboutQuote = document.getElementById('about-quote');
  if (aboutQuote) aboutQuote.textContent = story.meta.openingQuote || '';

  renderHeroCtas(audio, navigate);
  renderHeroStats(story);
  renderActs(story);
  if (audio) {
    audio.mountLanding(document.getElementById('soundtrack-list'), { navigate });
  }
  renderGalleryPreviews(story);
  renderAbout(story);
  initMobileNav();
  initReveal();

  return {
    refreshProgress() {
      renderHeroCtas(audio, navigate);
    },
    setInert(value) {
      if (!landingView) return;
      if (value) {
        landingView.setAttribute('inert', '');
        landingView.setAttribute('aria-hidden', 'true');
      } else {
        landingView.removeAttribute('inert');
        landingView.removeAttribute('aria-hidden');
      }
    },
    scrollToSection(id, { smooth = true } = {}) {
      const target = document.getElementById(id);
      if (!target) return;
      /* 'auto' would inherit the page's smooth scroll-behavior. Direct loads
         use 'instant' so the target is stable before the first paint settles. */
      target.scrollIntoView({
        behavior: smooth && !prefersReducedMotion() ? 'smooth' : 'instant',
        block: 'start'
      });
    },
    scrollToTop() {
      window.scrollTo({
        top: 0,
        behavior: prefersReducedMotion() ? 'instant' : 'smooth'
      });
    },
    showEnding(message) {
      echo?.show(message);
    },
    hideEnding() {
      echo?.hide();
    }
  };
}
