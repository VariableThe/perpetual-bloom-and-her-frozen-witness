/* The chapter reader: pagination, page turns, overlays and persistence. */

import {
  el,
  clear,
  clamp,
  splitRelic,
  formatNumber,
  FONT_STEPS,
  getSettings,
  getSavedPosition,
  saveSettings,
  savePosition,
  twoFrames,
  debounce,
  prefersReducedMotion,
  isWideEnoughForDuo,
  lastDuoSpreadStart,
  createFocusTrap,
  announce,
  actLabel
} from './utils.js';
import { paginateChapter, findPageForOffset } from './paginate.js';

const TURN_FALLBACK = 940;
const DUO_FALLBACK = 620;

function padded(number) {
  return String(number).padStart(2, '0');
}

function pageTextFor(piece) {
  const node = document.createElement('p');
  if (piece.cont) node.className = 'cont';
  node.textContent = piece.text;
  return node;
}

export class Reader {
  constructor(story, callbacks = {}) {
    this.story = story;
    this.callbacks = callbacks;
    this.settings = getSettings();

    this.view = document.getElementById('reader-view');
    this.stage = document.getElementById('reader-stage');
    this.bookStage = document.getElementById('book-stage');
    this.underlay = document.getElementById('spread-underlay');
    this.probe = document.getElementById('paginate-probe');
    this.loading = document.getElementById('reader-loading');
    this.errorPanel = document.getElementById('reader-error');
    this.errorDetail = document.getElementById('reader-error-detail');
    this.errorRetry = document.getElementById('reader-error-retry');
    this.errorBack = document.getElementById('reader-error-back');
    this.actNode = document.getElementById('reader-act');
    this.titleNode = document.getElementById('reader-chapter-title');
    this.counter = document.getElementById('reader-counter');
    this.slider = document.getElementById('page-slider');
    this.sliderLabel = document.getElementById('page-slider-label');
    this.progressBar = document.getElementById('chapter-progress-bar');
    this.prevButton = document.getElementById('reader-prev');
    this.nextButton = document.getElementById('reader-next');
    this.status = document.getElementById('reader-status');
    this.backButton = document.getElementById('reader-back');
    this.indexButton = document.getElementById('reader-index');
    this.settingsButton = document.getElementById('reader-settings');
    this.settingsPanel = document.getElementById('settings-popover');
    this.settingsClose = document.getElementById('settings-close');
    this.particlesToggle = document.getElementById('particles-toggle');
    this.drawer = document.getElementById('chapter-drawer');
    this.drawerList = document.getElementById('drawer-list');
    this.drawerClose = document.getElementById('drawer-close');
    this.duoHint = document.getElementById('duo-hint');
    this.modeButtons = Array.from(document.querySelectorAll('[data-mode-choice]'));
    this.fontButtons = Array.from(document.querySelectorAll('[data-font-step]'));

    this.cache = new Map();
    this.open = false;
    this.chapter = null;
    this.currentPage = 0;
    this.totalPages = 1;
    this.pagination = null;
    this.currentKey = '';
    this.effectiveMode = 'single';
    this.animating = false;
    this.loadId = 0;
    this.transitionSerial = 0;
    this.transitionCleanup = null;
    this.lastRequest = null;
    this.lastFocus = null;
    this.drawerOpen = false;
    this.settingsOpen = false;
    this.drawerTrap = null;
    this.settingsTrap = null;
    this.repaginateLater = 0;
    this.swipeStart = null;

    this.applySettings();
    this.bindEvents();
  }

  /* ------------------------------------------------------------------ */
  /* Settings                                                            */
  /* ------------------------------------------------------------------ */

  applySettings() {
    const step = FONT_STEPS[this.settings.fontSize] || FONT_STEPS[2];
    this.view.style.setProperty('--reader-font-size', `${step.size}px`);
    this.view.style.setProperty('--reader-line-height', String(step.lineHeight));

    this.effectiveMode = isWideEnoughForDuo() && this.settings.pageMode === 'duo' ? 'duo' : 'single';
    this.stage.dataset.mode = this.effectiveMode;

    if (this.particlesToggle) this.particlesToggle.checked = this.settings.particles !== false;

    for (const button of this.fontButtons) {
      button.setAttribute('aria-pressed', String(Number(button.dataset.fontStep) === this.settings.fontSize));
    }

    const wide = isWideEnoughForDuo();
    for (const button of this.modeButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.modeChoice === this.settings.pageMode));
      if (button.dataset.modeChoice === 'duo') {
        button.disabled = !wide;
        button.title = wide
          ? 'Show two pages side by side (1000px and wider)'
          : 'Duo is available at 1000px and wider';
      }
    }

    if (this.duoHint) {
      if (!wide && this.settings.pageMode === 'duo') {
        this.duoHint.textContent = 'Duo is saved, but this screen is below 1000px — showing a single page.';
      } else if (!wide) {
        this.duoHint.textContent = 'Duo is available at 1000px and wider; below 1000px pages stay single.';
      } else {
        this.duoHint.textContent = 'Duo shows two consecutive pages side by side at 1000px and wider.';
      }
    }
  }

  setFontSize(value) {
    const next = clamp(Number(value) || 2, 1, 4);
    if (next === this.settings.fontSize) return;
    this.settings = saveSettings({ fontSize: next });
    this.applySettings();
    this.repaginate();
  }

  setPageMode(mode) {
    if (mode !== 'single' && mode !== 'duo') return;
    if (mode === 'duo' && !isWideEnoughForDuo()) return;
    if (mode === this.settings.pageMode) return;
    this.settings = saveSettings({ pageMode: mode });
    this.applySettings();
    this.repaginate();
  }

  setParticles(enabled) {
    this.settings = saveSettings({ particles: Boolean(enabled) });
    this.callbacks.particles?.setEnabled?.(Boolean(enabled));
  }

  /* ------------------------------------------------------------------ */
  /* Events                                                              */
  /* ------------------------------------------------------------------ */

  bindEvents() {
    this.backButton?.addEventListener('click', () => this.callbacks.onBackToChapters?.());
    this.errorRetry?.addEventListener('click', () => this.retryChapter());
    this.errorBack?.addEventListener('click', () => this.callbacks.onBackToChapters?.());
    this.indexButton?.addEventListener('click', () => {
      if (this.drawerOpen) this.closeDrawer();
      else this.openDrawer();
    });
    this.settingsButton?.addEventListener('click', () => {
      if (this.settingsOpen) this.closeSettings();
      else this.openSettings();
    });
    this.settingsClose?.addEventListener('click', () => this.closeSettings());
    this.drawerClose?.addEventListener('click', () => this.closeDrawer());

    this.drawer?.querySelector('[data-drawer-close]')?.addEventListener('click', () => this.closeDrawer());
    this.drawerList?.addEventListener('click', (event) => {
      if (event.target.closest('a')) this.closeDrawer();
    });

    this.prevButton?.addEventListener('click', () => this.previous());
    this.nextButton?.addEventListener('click', () => this.next());

    this.slider?.addEventListener('input', () => this.previewPage(Number(this.slider.value)));
    this.slider?.addEventListener('change', () => {
      const value = Number(this.slider.value);
      this.goToPage(value, { animate: false, history: 'replace' });
    });

    this.fontButtons.forEach((button) => {
      button.addEventListener('click', () => this.setFontSize(button.dataset.fontStep));
    });

    this.modeButtons.forEach((button) => {
      button.addEventListener('click', () => this.setPageMode(button.dataset.modeChoice));
    });

    this.particlesToggle?.addEventListener('change', () => {
      this.setParticles(this.particlesToggle.checked);
    });

    this.bookStage?.addEventListener('click', (event) => this.onStageClick(event));

    this.stage?.addEventListener('touchstart', (event) => this.onTouchStart(event), { passive: true });
    this.stage?.addEventListener('touchend', (event) => this.onTouchEnd(event), { passive: true });
    this.stage?.addEventListener('touchcancel', () => {
      this.swipeStart = null;
    });

    document.addEventListener('keydown', (event) => this.onKeyDown(event));
    document.addEventListener('click', (event) => {
      if (!this.settingsOpen) return;
      if (this.settingsPanel?.contains(event.target) || this.settingsButton?.contains(event.target)) return;
      this.closeSettings({ restoreFocus: false });
    });

    window.addEventListener('resize', debounce(() => this.onResize(), 170));
    window.addEventListener('orientationchange', debounce(() => this.onResize(), 220));
  }

  onResize() {
    this.applySettings();
    if (!this.open) return;
    if (this.animating) {
      window.clearTimeout(this.repaginateLater);
      this.repaginateLater = window.setTimeout(() => this.repaginate(), TURN_FALLBACK);
      return;
    }
    this.repaginate();
  }

  onStageClick(event) {
    if (!this.open) return;

    if (this.settingsOpen) {
      if (!this.settingsPanel?.contains(event.target) && !this.settingsButton?.contains(event.target)) {
        this.closeSettings({ restoreFocus: false });
      }
      return;
    }

    if (this.drawerOpen) return;
    if (this.animating) return;

    const action = event.target.closest('[data-action]');
    if (action) {
      const name = action.dataset.action;
      if (name === 'begin-page') {
        this.goToPage(1, { animate: true, direction: 'next' });
      } else if (name === 'gallery-next') {
        this.next();
      } else if (name === 'gallery-back') {
        this.callbacks.onBackToChapters?.();
      }
      return;
    }

    if (event.target.closest('a, button, input, select, textarea, label, [data-no-swipe]')) return;
    if (window.getSelection && String(window.getSelection()).length > 0) return;
    if (this.view.dataset.pageType === 'gallery') return;

    const rect = this.underlay.getBoundingClientRect();
    if (rect.width === 0) return;
    const ratio = (event.clientX - rect.left) / rect.width;

    if (ratio < 0.18) {
      this.previous();
      this.stage.focus({ preventScroll: true });
    } else if (ratio > 0.82) {
      this.next();
      this.stage.focus({ preventScroll: true });
    }
  }

  onTouchStart(event) {
    if (!this.open || this.settingsOpen || this.drawerOpen || event.touches.length !== 1) {
      this.swipeStart = null;
      return;
    }
    if (event.target.closest('a, button, input, select, textarea, label, [data-no-swipe]')) {
      this.swipeStart = null;
      return;
    }
    const touch = event.touches[0];
    this.swipeStart = { x: touch.clientX, y: touch.clientY, time: Date.now() };
  }

  onTouchEnd(event) {
    if (!this.swipeStart || this.animating) {
      this.swipeStart = null;
      return;
    }
    if (window.getSelection && String(window.getSelection()).length > 0) {
      this.swipeStart = null;
      return;
    }
    const touch = event.changedTouches[0];
    if (!touch) {
      this.swipeStart = null;
      return;
    }
    const dx = touch.clientX - this.swipeStart.x;
    const dy = touch.clientY - this.swipeStart.y;
    const elapsed = Date.now() - this.swipeStart.time;
    this.swipeStart = null;

    if (elapsed > 900) return;
    if (Math.abs(dx) < 54 || Math.abs(dx) < Math.abs(dy) * 1.35) return;
    if (dx < 0) this.next();
    else this.previous();
  }

  onKeyDown(event) {
    if (!this.open) return;

    if (this.settingsOpen) {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.closeSettings();
      }
      return;
    }

    if (this.drawerOpen) {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.closeDrawer();
      }
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      this.callbacks.onExit?.();
      return;
    }

    if (event.altKey || event.ctrlKey || event.metaKey) return;

    const target = event.target;
    const interactive = target instanceof Element
      ? target.closest('input, textarea, select, [contenteditable="true"]')
      : null;
    if (interactive) return;

    const onButton = target instanceof Element ? target.closest('button, a') : null;

    if (event.key === 'ArrowRight' || event.key === 'PageDown') {
      event.preventDefault();
      this.next();
    } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
      event.preventDefault();
      this.previous();
    } else if (event.key === ' ' || event.key === 'Spacebar') {
      if (onButton) return;
      event.preventDefault();
      this.next();
    } else if (event.key === 'Home') {
      event.preventDefault();
      this.goToPage(0, { animate: true, direction: 'prev' });
    } else if (event.key === 'End') {
      event.preventDefault();
      this.goToPage(this.totalPages - 1, { animate: true, direction: 'next' });
    }
  }

  /* ------------------------------------------------------------------ */
  /* Shell                                                               */
  /* ------------------------------------------------------------------ */

  openShell() {
    if (this.open) return;
    this.lastFocus = document.activeElement;
    this.open = true;
    this.view.hidden = false;
    document.documentElement.classList.add('reader-open');
    document.body.classList.add('reader-open');
    this.applySettings();
    this.callbacks.onOpen?.();
    requestAnimationFrame(() => this.stage.focus({ preventScroll: true }));
  }

  close() {
    if (!this.open) return;
    this.endTransition();
    this.closeDrawer({ restoreFocus: false });
    this.closeSettings({ restoreFocus: false });

    this.open = false;
    this.loadId += 1;
    this.view.hidden = true;
    this.loading.hidden = true;
    if (this.errorPanel) this.errorPanel.hidden = true;
    this.stage.dataset.ready = 'false';
    this.view.dataset.ready = 'false';
    document.documentElement.classList.remove('reader-open');
    document.body.classList.remove('reader-open');
    document.title = this.story.meta.title;

    this.chapter = null;
    this.pagination = null;
    this.currentPage = 0;
    this.totalPages = 1;
    this.currentKey = '';
    this.lastRequest = null;

    const focusTarget = this.lastFocus;
    this.lastFocus = null;
    if (focusTarget && focusTarget.isConnected) {
      requestAnimationFrame(() => focusTarget.focus({ preventScroll: true }));
    }
  }

  async show(chapterNumber, pageToken = '0', options = {}) {
    const number = Number(chapterNumber);
    const chapter = this.story.chaptersByNumber.get(number);
    if (!chapter) {
      this.callbacks.onInvalidRoute?.();
      return;
    }

    this.openShell();

    if (!this.chapter || this.chapter.number !== number || !this.pagination) {
      await this.loadChapter(chapter, pageToken, options);
      return;
    }

    /* History can move while a page is turning. Route-driven navigation must
       settle that turn rather than being silently ignored, otherwise the URL
       and the visible spread disagree. */
    let animate = options.animate !== false;
    if (this.animating) {
      this.endTransition();
      animate = false;
    }

    const target = this.resolveToken(pageToken, this.totalPages, this.savedOffsetFor(number, pageToken));
    if (target === this.currentPage) {
      this.updateChrome();
      this.canonicaliseUrl(number, pageToken);
      return;
    }

    const direction = target > this.currentPage ? 'next' : 'prev';
    this.goToPage(target, { animate, direction, history: 'none', force: true });
    if (this.currentPage === target) this.canonicaliseUrl(number, pageToken);
  }

  canonicaliseUrl(number, requestedToken) {
    const canonical = this.tokenForPage(this.currentPage);
    if (canonical !== String(requestedToken)) {
      this.callbacks.onPageChange?.(number, canonical, { replace: true });
    }
  }

  /* Only use the saved character offset when the URL token itself is the one
     we saved. Manual URLs and gallery/cover tokens stay authoritative. */
  savedOffsetFor(chapterNumber, pageToken) {
    const saved = getSavedPosition();
    if (!saved || saved.chapter !== chapterNumber) return null;
    if (saved.token !== String(pageToken)) return null;
    return saved.offset;
  }

  /* ------------------------------------------------------------------ */
  /* Chapter loading and pagination                                      */
  /* ------------------------------------------------------------------ */

  cacheKey(chapter, dimensions) {
    return [
      `c${chapter.number}`,
      dimensions.mode,
      Math.round(dimensions.width),
      Math.round(dimensions.height),
      this.settings.fontSize
    ].join('|');
  }

  resolveToken(token, total, offset = null) {
    const last = Math.max(0, total - 1);
    if (token === 'gallery') return last;

    const value = Number(token);
    if (!Number.isFinite(value)) return 0;

    const raw = Math.trunc(value);
    const clamped = clamp(raw, 0, last);
    const isTextPage = raw > 0 && raw < last;

    /* A saved page-start marker survives type, layout and viewport changes.
       It is only applied to a text-page token, never to cover or gallery. */
    if (isTextPage && Number.isFinite(offset) && offset >= 0 && this.pagination?.pages?.length) {
      const textIndex = findPageForOffset(this.pagination.pages, offset);
      return clamp(textIndex + 1, 1, Math.max(1, total - 2));
    }

    return clamped;
  }

  tokenForPage(page) {
    return page === this.totalPages - 1 ? 'gallery' : String(page);
  }

  async loadChapter(chapter, pageToken, options = {}) {
    const loadId = ++this.loadId;
    this.endTransition();
    this.lastRequest = { chapter, pageToken };
    this.chapter = chapter;
    this.pagination = null;
    this.currentKey = '';
    this.totalPages = 1;
    this.currentPage = 0;
    this.applySettings();
    this.updateHeader();
    this.closeDrawer({ restoreFocus: false });
    this.closeSettings({ restoreFocus: false });
    if (this.errorPanel) this.errorPanel.hidden = true;
    this.loading.hidden = false;
    this.view.dataset.ready = 'false';
    this.view.dataset.chapter = String(chapter.number);

    try {
      if (document.fonts?.ready) await document.fonts.ready;
      if (loadId !== this.loadId) return;
      await twoFrames();
      if (loadId !== this.loadId) return;

      const dimensions = await this.measureLayout({ allowExisting: true });
      if (loadId !== this.loadId) return;

      const key = this.cacheKey(chapter, dimensions);
      let result = this.cache.get(key);
      if (!result) {
        result = paginateChapter(chapter, {
          probe: this.probe,
          width: dimensions.width,
          height: dimensions.height
        });
        this.cache.set(key, result);
      }

      this.pagination = result;
      this.currentKey = key;
      this.totalPages = 1 + result.pages.length + 1;
      this.currentPage = this.resolveToken(
        pageToken,
        this.totalPages,
        this.savedOffsetFor(chapter.number, pageToken)
      );

      this.renderSpread(this.currentPage);
      this.updateChrome({ announce: false });
      this.saveProgress();

      const canonical = this.tokenForPage(this.currentPage);
      if (canonical !== String(pageToken)) {
        this.callbacks.onPageChange?.(chapter.number, canonical, { replace: true });
      }

      this.loading.hidden = true;
      this.view.dataset.ready = 'true';
      this.view.dataset.totalPages = String(this.totalPages);
      this.stage.dataset.ready = 'true';
      this.announcePage();
      this.stage.focus({ preventScroll: true });
    } catch (error) {
      if (loadId !== this.loadId) return;
      console.error(error);
      this.view.dataset.ready = 'error';
      this.loading.hidden = true;
      if (this.errorPanel) {
        this.errorPanel.hidden = false;
        if (this.errorDetail) {
          this.errorDetail.textContent = 'The chapter text could not be typeset. Try again, or return to the archive.';
        }
      }
      announce(this.status, `Chapter ${chapter.number} could not be typeset. Use Retry or Back to chapters.`);
      requestAnimationFrame(() => this.errorRetry?.focus({ preventScroll: true }));
    }
  }

  retryChapter() {
    if (!this.chapter) return;
    const token = this.lastRequest?.pageToken ?? this.tokenForPage(this.currentPage);
    if (this.errorPanel) this.errorPanel.hidden = true;
    this.loadChapter(this.chapter, token);
  }

  async measureLayout({ allowExisting = true } = {}) {
    const mode = this.effectiveMode;
    const existingMode = this.underlay.classList.contains('spread--duo') ? 'duo' : 'single';
    const existingBody = this.underlay.querySelector('.reader-page__body');

    if (!allowExisting || !existingBody || existingMode !== mode) {
      /* .spread has a 280ms width transition. Measuring the skeleton midway
         through a single↔duo change paginates against a transient width, so
         suppress that transition for the measurement pass. */
      const previousTransition = this.underlay.style.transition;
      this.underlay.style.transition = 'none';
      this.renderSkeleton();
      await twoFrames();
      this.underlay.style.transition = previousTransition;
    }

    const body = this.underlay.querySelector('.reader-page__body');
    if (!body) throw new Error('No page body available for measurement.');

    const style = window.getComputedStyle(body);
    const paddingLeft = parseFloat(style.paddingLeft) || 0;
    const paddingRight = parseFloat(style.paddingRight) || 0;
    const paddingTop = parseFloat(style.paddingTop) || 0;
    const paddingBottom = parseFloat(style.paddingBottom) || 0;

    const width = Math.floor(body.clientWidth - paddingLeft - paddingRight);
    const height = Math.floor(body.clientHeight - paddingTop - paddingBottom);

    return {
      mode,
      width: Math.max(120, width),
      height: Math.max(80, height)
    };
  }

  renderSkeleton() {
    const mode = this.effectiveMode;
    this.underlay.className = `spread spread--${mode === 'duo' ? 'duo' : 'single'}`;
    clear(this.underlay);

    const count = mode === 'duo' ? 2 : 1;
    for (let index = 0; index < count; index += 1) {
      const side = mode === 'duo' ? (index === 0 ? 'reader-page--left' : 'reader-page--right') : 'reader-page--single';
      const page = el('article', { class: `reader-page reader-page--text ${side}`, 'aria-hidden': 'true' }, [
        el('header', { class: 'reader-page__head' }, [
          el('span', { class: 'reader-page__head-act', text: 'Setting the type' }),
          el('span', { class: 'reader-page__head-chapter', text: this.chapter ? `Chapter ${this.chapter.number}` : '' })
        ]),
        el('div', { class: 'reader-page__body' }, [
          el('div', { class: 'page-text' })
        ]),
        el('footer', { class: 'reader-page__foot' }, [
          el('span', { class: 'reader-page__foot-title', text: this.chapter?.title || '' }),
          el('span', { class: 'reader-page__folio', text: '✦' })
        ])
      ]);
      this.underlay.append(page);
    }
  }

  async repaginate() {
    if (!this.open || !this.chapter || !this.pagination) return;
    if (this.animating) {
      window.clearTimeout(this.repaginateLater);
      this.repaginateLater = window.setTimeout(() => this.repaginate(), TURN_FALLBACK);
      return;
    }

    const wasCover = this.currentPage === 0;
    const wasGallery = this.currentPage === this.totalPages - 1;
    const oldTextIndex = !wasCover && !wasGallery ? this.currentPage - 1 : -1;
    const oldOffset = oldTextIndex >= 0 ? this.pagination.pages[oldTextIndex]?.startGlobal : null;
    const previousKey = this.currentKey;

    const mode = this.effectiveMode;
    const existingMode = this.underlay.classList.contains('spread--duo') ? 'duo' : 'single';
    const existingBody = this.underlay.querySelector('.reader-page__body');
    const needsSkeleton = !existingBody || existingMode !== mode;

    if (needsSkeleton) {
      this.loading.hidden = false;
      this.renderSkeleton();
      await twoFrames();
    } else {
      await twoFrames();
    }

    let dimensions;
    try {
      dimensions = await this.measureLayout({ allowExisting: !needsSkeleton });
    } catch (error) {
      console.error(error);
      this.loading.hidden = true;
      return;
    }

    const key = this.cacheKey(this.chapter, dimensions);
    if (key === previousKey) {
      if (needsSkeleton) this.renderSpread(this.currentPage);
      this.loading.hidden = true;
      return;
    }

    this.view.dataset.ready = 'false';
    let result = this.cache.get(key);
    if (!result) {
      result = paginateChapter(this.chapter, {
        probe: this.probe,
        width: dimensions.width,
        height: dimensions.height
      });
      this.cache.set(key, result);
    }

    this.pagination = result;
    this.currentKey = key;
    this.totalPages = 1 + result.pages.length + 1;

    if (wasCover) {
      this.currentPage = 0;
    } else if (wasGallery) {
      this.currentPage = this.totalPages - 1;
    } else {
      const offset = oldOffset ?? 0;
      const textIndex = findPageForOffset(result.pages, offset);
      this.currentPage = clamp(textIndex + 1, 1, Math.max(1, this.totalPages - 2));
    }

    this.renderSpread(this.currentPage);
    this.updateChrome();
    this.saveProgress();
    this.loading.hidden = true;
    this.view.dataset.ready = 'true';
    this.view.dataset.totalPages = String(this.totalPages);
    this.stage.dataset.ready = 'true';
    this.syncUrl({ replace: true });
    this.stage.focus({ preventScroll: true });
  }

  /* ------------------------------------------------------------------ */
  /* Rendering                                                           */
  /* ------------------------------------------------------------------ */

  renderSpread(page) {
    const mode = this.effectiveMode;
    const last = this.totalPages - 1;

    if (page === 0) {
      this.underlay.className = 'spread spread--single';
      clear(this.underlay);
      this.underlay.append(this.renderCoverPage());
      return;
    }

    if (page === last) {
      this.underlay.className = 'spread spread--single';
      clear(this.underlay);
      this.underlay.append(this.renderGalleryPage());
      return;
    }

    if (mode === 'duo') {
      this.underlay.className = 'spread spread--duo';
      clear(this.underlay);
      this.underlay.append(this.renderTextPage(page - 1, 'left'));
      const second = page + 1;
      if (second <= last - 1 && second - 1 < this.pagination.pages.length) {
        this.underlay.append(this.renderTextPage(second - 1, 'right'));
      } else {
        this.underlay.append(this.renderBlankPage('right'));
      }
      return;
    }

    this.underlay.className = 'spread spread--single';
    clear(this.underlay);
    this.underlay.append(this.renderTextPage(page - 1, 'single'));
  }

  renderCoverPage() {
    const chapter = this.chapter;
    const relic = splitRelic(chapter.relic);
    const article = el('article', {
      class: 'reader-page reader-page--cover',
      'aria-label': `Cover of Chapter ${chapter.number}: ${chapter.title}, screen 1 of ${this.totalPages}`,
      'data-page-type': 'cover',
      'data-screen': '1'
    });

    const art = el('div', { class: 'cover-page__art' }, [
      el('img', {
        src: chapter.coverArt,
        alt: `Chapter ${chapter.number} cover artwork: ${chapter.title}`,
        width: 1000,
        height: 1400,
        decoding: 'async'
      })
    ]);

    const topline = el('div', { class: 'cover-page__topline' }, [
      el('span', { text: this.story.meta.title }),
      el('span', { text: actLabel(chapter.act) })
    ]);

    const chapterLine = el('div', { class: 'cover-page__chapter' }, [
      el('span', { class: 'cover-page__chapter-label', text: 'Chapter' }),
      el('span', { class: 'cover-page__chapter-number', text: padded(chapter.number) })
    ]);

    const overlayChildren = [
      el('p', { class: 'cover-page__eyebrow', text: chapter.part || actLabel(chapter.act) }),
      chapterLine,
      el('h3', { class: 'cover-page__title', text: chapter.title })
    ];

    if (chapter.date) {
      overlayChildren.push(el('p', { class: 'cover-page__date', text: chapter.date }));
    }

    if (relic.primary) {
      overlayChildren.push(el('p', { class: 'cover-page__relic' }, [
        el('span', { class: 'cover-page__relic-label', text: 'Object anchor' }),
        relic.primary
      ]));
    }

    overlayChildren.push(el('div', { class: 'cover-page__actions' }, [
      el('button', {
        class: 'btn btn--light',
        type: 'button',
        'data-action': 'begin-page',
        'aria-label': `Begin Chapter ${chapter.number}`
      }, ['Begin chapter', el('span', { 'aria-hidden': 'true', text: '→' })])
    ]));

    const overlay = el('div', { class: 'cover-page__overlay' }, overlayChildren);
    article.append(art, topline, overlay);
    return article;
  }

  renderTextPage(pageIndex, side) {
    const chapter = this.chapter;
    const page = this.pagination.pages[pageIndex];
    const pieces = page?.pieces || [];
    const isFirst = pageIndex === 0;
    const sideClass = side === 'left'
      ? 'reader-page--left'
      : side === 'right'
        ? 'reader-page--right'
        : 'reader-page--single';

    const textHost = el('div', { class: `page-text${isFirst ? ' is-first' : ''}` });
    for (const piece of pieces) {
      textHost.append(pageTextFor(piece));
    }

    const article = el('article', {
      class: `reader-page reader-page--text ${sideClass}${isFirst ? ' is-first' : ''}`,
      'aria-label': `Chapter ${chapter.number}, text page ${pageIndex + 1} of ${this.pagination.pages.length}, screen ${pageIndex + 2} of ${this.totalPages}`,
      'data-page-type': 'text',
      'data-text-page': pageIndex + 1,
      'data-screen': String(pageIndex + 2)
    }, [
      el('header', { class: 'reader-page__head' }, [
        el('span', { class: 'reader-page__head-act', text: actLabel(chapter.act) }),
        el('span', { class: 'reader-page__head-chapter', text: `Chapter ${chapter.number}` })
      ]),
      el('div', { class: 'reader-page__body' }, [textHost]),
      el('footer', { class: 'reader-page__foot' }, [
        el('span', { class: 'reader-page__foot-title', text: chapter.title }),
        el('span', { class: 'reader-page__folio', text: String(pageIndex + 1) })
      ])
    ]);

    return article;
  }

  renderBlankPage(side) {
    return el('article', {
      class: `reader-page reader-page--blank ${side === 'right' ? 'reader-page--right' : 'reader-page--left'}`,
      'aria-hidden': 'true'
    }, [
      el('div', { class: 'reader-page__blank-mark', 'aria-hidden': 'true', text: '✦' })
    ]);
  }

  renderGalleryPage() {
    const chapter = this.chapter;
    const plates = chapter.galleryPlates || [];
    const isLast = chapter.number === this.story.chapters.length;

    const header = el('header', { class: 'reader-page__head' }, [
      el('span', { class: 'reader-page__head-act', text: actLabel(chapter.act) }),
      el('span', { class: 'reader-page__head-chapter', text: 'Chapter gallery' })
    ]);

    const intro = el('div', { class: 'reader-gallery__intro' }, [
      el('h3', { text: `Chapter ${chapter.number} gallery` }),
      el('p', { text: chapter.galleryPrompt || 'Two original plates and a space for your own artwork.' })
    ]);

    const plateGrid = el('div', { class: 'reader-gallery__plates' });
    plates.forEach((src, index) => {
      plateGrid.append(el('figure', { class: 'reader-plate' }, [
        el('div', { class: 'reader-plate__art' }, [
          el('img', {
            src,
            alt: `${index === 0 ? 'Bloom' : 'Relic'} plate for Chapter ${chapter.number}: ${chapter.title}`,
            width: 1200,
            height: 900,
            loading: index === 0 ? 'eager' : 'lazy',
            decoding: 'async'
          })
        ]),
        el('figcaption', {}, [
          el('span', { text: index === 0 ? 'Bloom plate' : 'Relic plate' }),
          el('strong', { text: `Plate ${padded(index + 1)}` })
        ])
      ]));
    });

    const upload = el('div', { class: 'upload-shell', 'data-upload-state': 'coming-later' }, [
      el('span', { class: 'upload-shell__mark', 'aria-hidden': 'true', text: '+' }),
      el('p', {}, [
        el('strong', { text: 'Your plate belongs here' }),
        'Fan-art uploads are not part of this build yet. When they arrive, files will be stored locally with IndexedDB and never uploaded.'
      ]),
      el('button', { type: 'button', disabled: true, 'aria-label': 'Artwork uploads are not available in this build yet' }, ['Coming later'])
    ]);

    const actions = el('div', { class: 'gallery-page__actions' }, [
      el('button', {
        class: 'btn btn--primary',
        type: 'button',
        'data-action': 'gallery-next',
        'aria-label': isLast ? 'Finish the archive and return to the story' : `Continue to Chapter ${chapter.number + 1}`
      }, [
        isLast ? 'Finish the archive' : 'Next chapter',
        el('span', { 'aria-hidden': 'true', text: '→' })
      ]),
      el('button', {
        class: 'btn btn--ghost',
        type: 'button',
        'data-action': 'gallery-back'
      }, ['Back to chapters'])
    ]);

    const gallery = el('div', {
      class: 'reader-gallery',
      id: 'reader-gallery-container',
      'data-chapter': chapter.number,
      'data-no-swipe': ''
    }, [intro, plateGrid, upload, actions]);

    const body = el('div', {
      class: 'reader-page__body reader-page__body--gallery',
      'data-no-swipe': ''
    }, [gallery]);

    return el('article', {
      class: 'reader-page reader-page--gallery reader-page--single',
      'aria-label': `Gallery for Chapter ${chapter.number}: ${chapter.title}, screen ${this.totalPages} of ${this.totalPages}`,
      'data-page-type': 'gallery',
      'data-screen': String(this.totalPages)
    }, [
      header,
      body,
      el('footer', { class: 'reader-page__foot' }, [
        el('span', { class: 'reader-page__foot-title', text: chapter.title }),
        el('span', { class: 'reader-page__folio', text: 'Gallery' })
      ])
    ]);
  }

  /* ------------------------------------------------------------------ */
  /* Navigation                                                          */
  /* ------------------------------------------------------------------ */

  goToPage(page, { animate = false, direction = null, history = 'push', force = false } = {}) {
    if (!this.pagination) return false;
    if (this.animating) {
      if (!force) return false;
      this.endTransition();
    }

    const target = clamp(Math.trunc(Number(page) || 0), 0, this.totalPages - 1);
    if (target === this.currentPage) {
      this.updateChrome();
      return true;
    }

    const oldClone = animate ? this.underlay.cloneNode(true) : null;
    const turnDirection = direction || (target > this.currentPage ? 'next' : 'prev');
    this.currentPage = target;
    this.renderSpread(target);
    this.updateChrome();
    this.saveProgress();

    if (history === 'push') this.syncUrl({ replace: false });
    else if (history === 'replace') this.syncUrl({ replace: true });

    if (animate) this.runTransition(oldClone, turnDirection);
    this.stage.focus({ preventScroll: true });
    return true;
  }

  next() {
    if (!this.open || !this.pagination || this.animating) return;
    if (this.currentPage === this.totalPages - 1) {
      if (this.chapter.number < this.story.chapters.length) {
        this.callbacks.onNavigate?.(`#/read/${this.chapter.number + 1}/0`);
      } else {
        this.callbacks.onEnd?.();
      }
      return;
    }

    let target;
    if (this.effectiveMode === 'duo') {
      const lastSpread = lastDuoSpreadStart(this.pagination.pages.length);
      target = this.currentPage === 0
        ? 1
        : this.currentPage >= lastSpread
          ? this.totalPages - 1
          : this.currentPage + 2;
    } else {
      target = this.currentPage + 1;
    }

    this.goToPage(target, { animate: true, direction: 'next' });
  }

  previous() {
    if (!this.open || !this.pagination || this.animating) return;
    if (this.currentPage === 0) {
      if (this.chapter.number > 1) {
        this.callbacks.onNavigate?.(`#/read/${this.chapter.number - 1}/gallery`);
      } else {
        this.callbacks.onBackToChapters?.();
      }
      return;
    }

    let target;
    if (this.effectiveMode === 'duo') {
      if (this.currentPage === this.totalPages - 1) {
        target = lastDuoSpreadStart(this.pagination.pages.length);
      } else if (this.currentPage <= 1) {
        target = 0;
      } else {
        target = Math.max(1, this.currentPage - 2);
      }
    } else {
      target = this.currentPage - 1;
    }

    this.goToPage(target, { animate: true, direction: 'prev' });
  }

  syncUrl({ replace = false } = {}) {
    if (!this.chapter || !this.totalPages) return;
    this.callbacks.onPageChange?.(this.chapter.number, this.tokenForPage(this.currentPage), { replace });
  }

  saveProgress() {
    if (!this.chapter) return;
    const token = this.tokenForPage(this.currentPage);
    let offset = null;

    if (this.currentPage === 0) {
      offset = 0;
    } else if (this.currentPage < this.totalPages - 1) {
      const textIndex = this.currentPage - 1;
      offset = this.pagination?.pages?.[textIndex]?.startGlobal ?? null;
    }

    savePosition(this.chapter.number, token, offset);
  }

  /* ------------------------------------------------------------------ */
  /* Page turn animation                                                 */
  /* ------------------------------------------------------------------ */

  runTransition(oldClone, direction) {
    if (!oldClone) return;
    const serial = ++this.transitionSerial;
    const reduced = prefersReducedMotion();
    const mode = this.effectiveMode;

    this.animating = true;
    this.bookStage.classList.add('is-turning');

    let overlay = null;
    let timer = 0;

    const finish = () => {
      if (serial !== this.transitionSerial) return;
      window.clearTimeout(timer);
      if (overlay?.isConnected) overlay.remove();
      overlay = null;
      this.bookStage.classList.remove('is-turning');
      this.underlay.classList.remove('is-enter-next', 'is-enter-prev', 'is-fading-in');
      this.animating = false;
      this.transitionCleanup = null;
    };

    this.transitionCleanup = finish;

    if (reduced) {
      if (mode === 'duo') {
        overlay = el('div', { class: 'spread-turn is-fading', 'aria-hidden': 'true' });
        overlay.append(oldClone);
        overlay.style.transition = 'opacity 190ms ease-out';
        this.underlay.append(overlay);
        this.underlay.classList.add('is-fading-in');
        requestAnimationFrame(() => {
          if (overlay) overlay.style.opacity = '0';
        });
      } else {
        overlay = el('div', { class: 'page-leaf is-fading', 'aria-hidden': 'true' }, [
          el('div', { class: 'leaf-face leaf-face--front' }, [oldClone])
        ]);
        overlay.style.transition = 'opacity 190ms ease-out';
        this.underlay.append(overlay);
        this.underlay.classList.add('is-fading-in');
        requestAnimationFrame(() => {
          if (overlay) overlay.style.opacity = '0';
        });
      }
      timer = window.setTimeout(finish, 240);
      return;
    }

    if (mode === 'duo') {
      overlay = el('div', { class: `spread-turn is-${direction}`, 'aria-hidden': 'true' });
      overlay.append(oldClone);
      this.underlay.append(overlay);
      this.underlay.classList.add(direction === 'next' ? 'is-enter-next' : 'is-enter-prev');
      timer = window.setTimeout(finish, DUO_FALLBACK);
      return;
    }

    const leaf = el('div', {
      class: `page-leaf${direction === 'prev' ? ' is-backward-start' : ''}`,
      'aria-hidden': 'true'
    }, [
      el('div', { class: 'leaf-face leaf-face--front' }, [oldClone]),
      el('div', { class: 'leaf-face leaf-face--back', 'aria-hidden': 'true' }),
      el('div', { class: 'leaf-shade', 'aria-hidden': 'true' })
    ]);

    overlay = leaf;
    this.underlay.append(leaf);

    const onTransition = (event) => {
      if (event.target !== leaf || event.propertyName !== 'transform') return;
      leaf.removeEventListener('transitionend', onTransition);
      finish();
    };
    leaf.addEventListener('transitionend', onTransition);

    requestAnimationFrame(() => {
      if (serial !== this.transitionSerial) return;
      if (direction === 'next') {
        leaf.classList.remove('is-backward-start');
        leaf.classList.add('is-forward');
      } else {
        leaf.classList.remove('is-backward-start');
        leaf.classList.add('is-backward');
      }
    });

    timer = window.setTimeout(finish, TURN_FALLBACK);
  }

  endTransition() {
    this.transitionSerial += 1;
    if (this.transitionCleanup) {
      this.transitionCleanup();
      this.transitionCleanup = null;
    }
    this.animating = false;
    this.bookStage.classList.remove('is-turning');
    this.underlay.classList.remove('is-enter-next', 'is-enter-prev', 'is-fading-in');
    this.underlay.querySelectorAll('.page-leaf, .spread-turn').forEach((node) => node.remove());
  }

  /* ------------------------------------------------------------------ */
  /* Chrome, slider and progress                                         */
  /* ------------------------------------------------------------------ */

  updateHeader() {
    if (!this.chapter) return;
    const act = this.chapter.act;
    const actText = act ? (act.id === 'prologue' ? 'Prologue · The book and the arrow' : `Act ${act.roman} · ${act.title}`) : '';
    this.actNode.textContent = this.chapter.part ? `${actText} · ${this.chapter.part}` : actText;
    this.titleNode.textContent = this.chapter.title;
    this.titleNode.title = this.chapter.title;
  }

  hasSecondPage(page = this.currentPage) {
    return this.effectiveMode === 'duo'
      && page > 0
      && page + 1 <= this.totalPages - 2;
  }

  textPageCount() {
    return this.pagination?.pages?.length || 0;
  }

  screenAnnouncement(page = this.currentPage) {
    const total = this.totalPages;
    const textTotal = this.textPageCount();

    if (page === 0) return `cover, screen 1 of ${total}`;
    if (page === total - 1) return `gallery, screen ${total} of ${total}`;
    if (this.hasSecondPage(page)) {
      return `screens ${page + 1}–${page + 2} of ${total}, text pages ${page}–${page + 1} of ${textTotal}`;
    }
    return `screen ${page + 1} of ${total}, text page ${page} of ${textTotal}`;
  }

  screenLabel(page = this.currentPage) {
    const total = this.totalPages;
    const textTotal = this.textPageCount();

    if (page === 0) return `Cover · screen 1 of ${total}`;
    if (page === total - 1) return `Gallery · screen ${total} of ${total}`;
    if (this.hasSecondPage(page)) {
      return `Screens ${page + 1}–${page + 2} of ${total} · text pages ${page}–${page + 1} of ${textTotal}`;
    }
    return `Screen ${page + 1} of ${total} · text page ${page} of ${textTotal}`;
  }

  announcePage() {
    if (!this.chapter) return;
    announce(this.status, `Chapter ${this.chapter.number}, ${this.screenAnnouncement()}`);
  }

  updateChrome({ announce: shouldAnnounce = true } = {}) {
    if (!this.chapter) return;
    const page = this.currentPage;
    const total = this.totalPages;
    const last = total - 1;

    const paired = this.hasSecondPage(page);
    const counterText = paired ? `${page + 1}–${page + 2} / ${total}` : `${page + 1} / ${total}`;
    this.counter.textContent = counterText;

    const label = this.screenLabel(page);
    this.sliderLabel.textContent = label;
    this.slider.setAttribute('aria-valuetext', label);

    this.slider.max = String(last);
    this.slider.value = String(page);
    const percent = last > 0 ? (page / last) * 100 : 100;
    this.slider.style.setProperty('--progress', `${percent}%`);
    this.progressBar.style.width = `${percent}%`;

    this.prevButton.setAttribute('aria-label', this.previousLabel());
    this.nextButton.setAttribute('aria-label', this.nextLabel());
    this.prevButton.title = this.previousLabel();
    this.nextButton.title = this.nextLabel();

    this.view.dataset.page = String(page);
    this.view.dataset.pageType = page === 0 ? 'cover' : page === last ? 'gallery' : 'text';
    this.view.dataset.totalPages = String(total);
    document.title = `Chapter ${this.chapter.number}: ${this.chapter.title} — ${this.story.meta.title}`;

    if (shouldAnnounce) this.announcePage();
  }

  previousLabel() {
    if (this.currentPage === 0) {
      return this.chapter.number > 1 ? 'Previous screen: chapter gallery' : 'Back to the story archive';
    }
    return 'Previous screen';
  }

  nextLabel() {
    if (this.currentPage === this.totalPages - 1) {
      return this.chapter.number < this.story.chapters.length
        ? 'Next chapter'
        : 'Finish the archive';
    }
    return 'Next screen';
  }

  previewPage(page) {
    if (!this.pagination) return;
    const value = clamp(Number(page) || 0, 0, this.totalPages - 1);
    const last = this.totalPages - 1;
    const label = this.screenLabel(value);
    this.sliderLabel.textContent = label;
    this.slider.setAttribute('aria-valuetext', label);
    const percent = last > 0 ? (value / last) * 100 : 100;
    this.slider.style.setProperty('--progress', `${percent}%`);
    this.progressBar.style.width = `${percent}%`;
  }

  /* ------------------------------------------------------------------ */
  /* Settings and drawer overlays                                        */
  /* ------------------------------------------------------------------ */

  openSettings() {
    if (!this.settingsPanel || this.settingsOpen) return;
    if (this.drawerOpen) this.closeDrawer({ restoreFocus: false });
    this.settingsOpen = true;
    this.settingsPanel.hidden = false;
    this.settingsButton?.setAttribute('aria-expanded', 'true');
    this.applySettings();
    this.settingsTrap = createFocusTrap(this.settingsPanel);
    this.settingsTrap.activate();
  }

  closeSettings({ restoreFocus = true } = {}) {
    if (!this.settingsOpen) return;
    this.settingsOpen = false;
    if (this.settingsPanel) this.settingsPanel.hidden = true;
    this.settingsButton?.setAttribute('aria-expanded', 'false');
    if (this.settingsTrap) {
      const trap = this.settingsTrap;
      this.settingsTrap = null;
      trap.deactivate({ restoreFocus });
    }
  }

  openDrawer() {
    if (!this.drawer || this.drawerOpen) return;
    if (this.settingsOpen) this.closeSettings({ restoreFocus: false });
    this.renderDrawer();
    this.drawerOpen = true;
    this.drawer.hidden = false;
    this.indexButton?.setAttribute('aria-expanded', 'true');
    this.drawerTrap = createFocusTrap(this.drawer.querySelector('.drawer__panel'));
    this.drawerTrap.activate();

    requestAnimationFrame(() => {
      const current = this.drawerList?.querySelector('.is-current');
      if (current) current.scrollIntoView({ block: 'center', behavior: 'auto' });
    });
  }

  closeDrawer({ restoreFocus = true } = {}) {
    if (!this.drawerOpen) return;
    this.drawerOpen = false;
    if (this.drawer) this.drawer.hidden = true;
    this.indexButton?.setAttribute('aria-expanded', 'false');
    if (this.drawerTrap) {
      const trap = this.drawerTrap;
      this.drawerTrap = null;
      trap.deactivate({ restoreFocus });
    }
  }

  renderDrawer() {
    if (!this.drawerList) return;
    clear(this.drawerList);

    for (const act of this.story.acts) {
      const section = el('section', { class: 'drawer-act' });
      section.append(el('header', { class: 'drawer-act__head' }, [
        el('span', { class: 'drawer-act__title', text: act.id === 'prologue' ? 'Prologue' : `Act ${act.roman} · ${act.title}` }),
        el('span', { class: 'drawer-act__range', text: `Ch. ${act.firstChapter}–${act.lastChapter}` })
      ]));

      for (const chapter of act.chapters) {
        const current = this.chapter && chapter.number === this.chapter.number;
        const link = el('a', {
          class: `drawer-chapter${current ? ' is-current' : ''}`,
          href: `#/read/${chapter.number}/0`,
          'aria-current': current ? 'page' : null
        }, [
          el('span', { class: 'drawer-chapter__art' }, [
            el('img', {
              src: chapter.coverArt,
              alt: '',
              width: 1000,
              height: 1400,
              loading: 'lazy',
              decoding: 'async'
            })
          ]),
          el('span', { class: 'drawer-chapter__body' }, [
            el('span', { class: 'drawer-chapter__kicker' }, [
              el('span', { text: `Chapter ${chapter.number}` }),
              el('span', { text: `${formatNumber(chapter.wordCount)} words` })
            ]),
            el('span', { class: 'drawer-chapter__title', text: chapter.title }),
            el('span', { class: 'drawer-chapter__track', text: `Track ${padded(chapter.track.number)} · ${chapter.track.title}` })
          ]),
          current ? el('span', { class: 'drawer-chapter__current', text: 'Reading' }) : null
        ]);
        section.append(link);
      }

      this.drawerList.append(section);
    }
  }
}
