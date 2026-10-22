/* End-of-chapter galleries: local IndexedDB persistence, client-side fan-art
   uploads, a full-screen lightbox and a metadata editor.

   Images never leave the device. Every network-free promise here works on
   blobs handed to IndexedDB, and object URLs are treated as runtime-only. */

import { el, clear } from './utils.js';

const DB_NAME = 'perpetual-bloom-gallery';
const DB_VERSION = 1;
const STORE = 'artworks';
const CHAPTER_INDEX = 'chapter';

export const GALLERY_LIMITS = Object.freeze({
  maxFileBytes: 15 * 1024 * 1024,
  maxBatch: 10,
  maxPerChapter: 60,
  maxEdge: 1800,
  webpQuality: 0.86,
  jpegQuality: 0.86,
  titleMax: 80,
  artistMax: 60
});

const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
const ACCEPTED_EXTENSIONS = /\.(jpe?g|png|webp|avif)$/i;
const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/avif';
const SEPARATORS = /[_\-.]+/g;
const COLLAPSE_SPACE = /\s+/g;

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB'];
  let size = value / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size >= 10 ? Math.round(size) : size.toFixed(1)} ${units[unit]}`;
}

function titleFromFilename(name) {
  const base = String(name || '').replace(/\.[^./\\]+$/, '');
  const cleaned = base.replace(SEPARATORS, ' ').replace(COLLAPSE_SPACE, ' ').trim();
  const title = cleaned || 'Untitled';
  return title.slice(0, GALLERY_LIMITS.titleMax);
}

function pad2(number) {
  return String(number).padStart(2, '0');
}

function sortRecords(records) {
  return records
    .slice()
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || (a.id || 0) - (b.id || 0));
}

function classifyFile(file) {
  const type = String(file?.type || '').toLowerCase();
  if (ACCEPTED_TYPES.has(type)) return true;
  if (!type && ACCEPTED_EXTENSIONS.test(String(file?.name || ''))) return true;
  return false;
}

function createObjectURL(blob) {
  try {
    return URL.createObjectURL(blob);
  } catch {
    return '';
  }
}

function revokeURL(url) {
  if (!url) return;
  try {
    URL.revokeObjectURL(url);
  } catch {
    /* Already revoked. */
  }
}

/* ------------------------------------------------------------------ */
/* Storage errors                                                      */
/* ------------------------------------------------------------------ */

export class GalleryStoreError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'GalleryStoreError';
    this.code = code;
  }
}

export function describeStoreError(error) {
  const code = error?.code;
  if (code === 'unsupported') {
    return 'This browser cannot save images locally (IndexedDB is unavailable). You can still view the original plates.';
  }
  if (code === 'blocked') {
    return 'Local storage is blocked, probably by another open tab. Close the other tab and add your art again.';
  }
  if (code === 'quota') {
    return 'There is not enough space in this browser to save that image. Delete some art and try again.';
  }
  return 'Your image could not be saved locally. Please try again.';
}

function normalizeStoreError(error, phase) {
  if (error instanceof GalleryStoreError) return error;
  const name = String(error?.name || '');
  if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED') {
    return new GalleryStoreError('quota', 'Storage quota exceeded.');
  }
  if (name === 'VersionError') {
    return new GalleryStoreError('blocked', 'A newer gallery database is already open.');
  }
  return new GalleryStoreError('error', `${phase} failed: ${error?.message || name || 'unknown error'}`);
}

/* ------------------------------------------------------------------ */
/* IndexedDB repository                                                */
/* ------------------------------------------------------------------ */

export class GalleryStore {
  constructor(name = DB_NAME, version = DB_VERSION) {
    this.name = name;
    this.version = version;
    this.dbPromise = null;
  }

  static get supported() {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  }

  open() {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = this.#openDatabase().catch((error) => {
      this.dbPromise = null;
      throw error;
    });
    return this.dbPromise;
  }

  #openDatabase() {
    return new Promise((resolve, reject) => {
      if (!GalleryStore.supported) {
        reject(new GalleryStoreError('unsupported', 'IndexedDB is unavailable.'));
        return;
      }

      let request;
      try {
        request = indexedDB.open(this.name, this.version);
      } catch (error) {
        reject(normalizeStoreError(error, 'open'));
        return;
      }

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
          store.createIndex(CHAPTER_INDEX, 'chapter', { unique: false });
        }
      };

      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };

      request.onerror = () => reject(normalizeStoreError(request.error, 'open'));
      request.onblocked = () => reject(new GalleryStoreError('blocked', 'The gallery database is blocked.'));
    });
  }

  async listByChapter(chapter) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      let transaction;
      try {
        transaction = db.transaction(STORE, 'readonly');
      } catch (error) {
        reject(normalizeStoreError(error, 'read'));
        return;
      }
      const index = transaction.objectStore(STORE).index(CHAPTER_INDEX);
      let request;
      try {
        request = index.getAll(Number(chapter));
      } catch (error) {
        reject(normalizeStoreError(error, 'read'));
        return;
      }
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(normalizeStoreError(request.error, 'read'));
    });
  }

  async add(record) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      let transaction;
      try {
        transaction = db.transaction(STORE, 'readwrite');
      } catch (error) {
        reject(normalizeStoreError(error, 'write'));
        return;
      }
      const store = transaction.objectStore(STORE);
      const request = store.add(record);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(normalizeStoreError(request.error, 'write'));
      transaction.onabort = () => reject(normalizeStoreError(transaction.error || request.error, 'write'));
    });
  }

  async update(id, patch) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      let transaction;
      try {
        transaction = db.transaction(STORE, 'readwrite');
      } catch (error) {
        reject(normalizeStoreError(error, 'write'));
        return;
      }
      const store = transaction.objectStore(STORE);
      const getRequest = store.get(id);
      getRequest.onsuccess = () => {
        const record = getRequest.result;
        if (!record) {
          reject(new GalleryStoreError('error', 'That image is no longer saved.'));
          return;
        }
        const next = { ...record, ...patch, id: record.id };
        const putRequest = store.put(next);
        putRequest.onsuccess = () => resolve(next);
        putRequest.onerror = () => reject(normalizeStoreError(putRequest.error, 'write'));
      };
      getRequest.onerror = () => reject(normalizeStoreError(getRequest.error, 'write'));
      transaction.onabort = () => reject(normalizeStoreError(transaction.error, 'write'));
    });
  }

  async remove(id) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      let transaction;
      try {
        transaction = db.transaction(STORE, 'readwrite');
      } catch (error) {
        reject(normalizeStoreError(error, 'write'));
        return;
      }
      const request = transaction.objectStore(STORE).delete(id);
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(normalizeStoreError(request.error, 'write'));
    });
  }
}

/* ------------------------------------------------------------------ */
/* Client-side image optimisation                                      */
/* ------------------------------------------------------------------ */

function decodeWithElement(file) {
  return new Promise((resolve, reject) => {
    const url = createObjectURL(file);
    if (!url) {
      reject(new Error('The image could not be read.'));
      return;
    }
    const image = new Image();
    image.onload = () => {
      revokeURL(url);
      resolve({
        source: image,
        width: image.naturalWidth || image.width,
        height: image.naturalHeight || image.height
      });
    };
    image.onerror = () => {
      revokeURL(url);
      reject(new Error('The image could not be decoded.'));
    };
    image.src = url;
  });
}

async function decodeImage(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, bitmap };
    } catch {
      /* Fall back to the no-orientation decode below. */
    }
    try {
      const bitmap = await createImageBitmap(file);
      return { source: bitmap, width: bitmap.width, height: bitmap.height, bitmap };
    } catch {
      /* Fall back to an HTMLImageElement. */
    }
  }
  return decodeWithElement(file);
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => {
    if (typeof canvas.toBlob !== 'function') {
      resolve(null);
      return;
    }
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}

export async function prepareImage(file) {
  if (!classifyFile(file)) {
    throw new GalleryStoreError('unsupported-type', 'That file is not a JPEG, PNG, WebP or AVIF image.');
  }
  if (Number(file.size) > GALLERY_LIMITS.maxFileBytes) {
    throw new GalleryStoreError('too-large', 'That file is larger than 15 MB.');
  }

  const decoded = await decodeImage(file);
  const naturalWidth = Math.max(1, Math.round(decoded.width || 1));
  const naturalHeight = Math.max(1, Math.round(decoded.height || 1));
  const scale = Math.min(1, GALLERY_LIMITS.maxEdge / Math.max(naturalWidth, naturalHeight));
  const width = Math.max(1, Math.round(naturalWidth * scale));
  const height = Math.max(1, Math.round(naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    decoded.bitmap?.close?.();
    throw new GalleryStoreError('error', 'A drawing surface was unavailable.');
  }

  context.drawImage(decoded.source, 0, 0, width, height);
  decoded.bitmap?.close?.();

  let blob = await canvasToBlob(canvas, 'image/webp', GALLERY_LIMITS.webpQuality);
  let mime = 'image/webp';

  if (!blob || blob.type !== 'image/webp') {
    /* WebP is unavailable; flatten transparency onto white for JPEG. */
    context.globalCompositeOperation = 'destination-over';
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.globalCompositeOperation = 'source-over';
    blob = await canvasToBlob(canvas, 'image/jpeg', GALLERY_LIMITS.jpegQuality);
    mime = 'image/jpeg';
  }

  if (!blob) {
    throw new GalleryStoreError('error', 'The image could not be converted for local storage.');
  }

  return {
    blob,
    mime,
    width,
    height,
    bytes: blob.size
  };
}

/* ------------------------------------------------------------------ */
/* Gallery controller                                                  */
/* ------------------------------------------------------------------ */

export class Gallery {
  constructor(story, { store = new GalleryStore() } = {}) {
    this.story = story;
    this.store = store;

    this.host = null;
    this.chapter = null;
    this.mounted = false;
    this.mountSerial = 0;
    this.artworks = [];
    this.busy = false;
    this.lastError = null;

    this.gridUrls = new Map();
    this.lightboxUrls = new Map();
    this.disposers = [];
    this.pendingDeletes = new Map();

    this.refs = null;
    this.lightbox = null;
    this.editor = null;
    this.editorId = null;
    this.lightboxSequence = [];
    this.lightboxIndex = 0;
    this.lightboxInvoker = null;

    this.dialogsReady = false;
  }

  /* ---------- lifecycle ---------- */

  async mount(host, chapter) {
    if (!host || !chapter) return;
    if (this.mounted) this.unmount();

    const serial = ++this.mountSerial;
    this.host = host;
    this.chapter = chapter;
    this.mounted = true;
    this.artworks = [];
    this.lastError = null;

    this.ensureDialogs();
    this.renderShell();
    this.bindHost();

    try {
      const records = await this.store.listByChapter(chapter.number);
      if (serial !== this.mountSerial || !this.mounted) return;
      this.artworks = sortRecords(records);
      this.renderUserSection();
    } catch (error) {
      if (serial !== this.mountSerial || !this.mounted) return;
      this.renderStorageError(error);
    }
  }

  unmount() {
    this.mountSerial += 1;
    this.mounted = false;

    this.revokeGridUrls();
    this.closeLightbox({ restoreFocus: false, immediate: true });
    if (this.editor?.open) this.editor.close();
    this.clearDeleteTimers();

    for (const dispose of this.disposers.splice(0)) dispose();

    this.host = null;
    this.chapter = null;
    this.artworks = [];
    this.refs = null;
    this.busy = false;
  }

  isOverlayOpen() {
    return Boolean(this.lightbox?.open || this.editor?.open);
  }

  getState() {
    const totalBytes = this.artworks.reduce((sum, record) => sum + (Number(record.bytes) || 0), 0);
    return {
      mounted: this.mounted,
      ready: this.mounted && !this.lastError,
      error: this.lastError,
      chapter: this.chapter ? this.chapter.number : null,
      seedCount: this.chapter?.galleryPlates?.length || 0,
      userCount: this.artworks.length,
      totalBytes,
      busy: this.busy,
      lightboxOpen: Boolean(this.lightbox?.open),
      editorOpen: Boolean(this.editor?.open),
      gridImages: this.gridUrls.size
    };
  }

  /* ---------- event plumbing ---------- */

  on(node, type, handler, options) {
    if (!node) return;
    node.addEventListener(type, handler, options);
    this.disposers.push(() => node.removeEventListener(type, handler, options));
  }

  /* ---------- shell rendering ---------- */

  renderShell() {
    const chapter = this.chapter;
    const root = el('div', { class: 'pb-gallery' });

    const seeds = el('section', { class: 'pb-gallery__seeds', 'aria-label': 'Original plates' }, [
      el('div', { class: 'pb-gallery__section-head' }, [
        el('h4', { class: 'pb-gallery__heading', text: 'Original plates' }),
        el('p', { class: 'pb-gallery__subheading', text: `Made for Chapter ${chapter.number}` })
      ]),
      this.buildSeedGrid()
    ]);

    const divider = el('div', { class: 'pb-gallery__divider', role: 'separator', 'aria-hidden': 'true' });

    const empty = el('p', { class: 'pb-gallery__empty', 'data-gallery-empty': '' }, [
      el('strong', { text: 'The margin is still blank.' }),
      ' Add a drawing, a sketch or a screenshot and it will rest here beside the original plates.'
    ]);

    const grid = el('div', {
      class: 'pb-gallery__grid pb-gallery__grid--user',
      'data-gallery-grid': '',
      'aria-label': 'Your additions'
    });

    const dropzone = el('div', { class: 'pb-gallery__dropzone', 'data-gallery-dropzone': '' }, [
      el('span', { class: 'pb-gallery__drop-mark', 'aria-hidden': 'true', text: '＋' }),
      el('div', { class: 'pb-gallery__drop-copy' }, [
        el('strong', { text: 'Add your fan art' }),
        el('p', { text: 'Drag images here, or use the button. JPEG, PNG, WebP or AVIF · up to 15 MB each.' })
      ]),
      el('button', {
        class: 'btn btn--primary pb-gallery__add',
        type: 'button',
        'data-gallery-add': '',
        'aria-label': 'Add images to this gallery'
      }, ['Add images']),
      el('input', {
        class: 'pb-gallery__file',
        type: 'file',
        accept: IMAGE_ACCEPT,
        multiple: true,
        'data-gallery-input': '',
        'aria-hidden': 'true',
        tabindex: '-1',
        hidden: true
      })
    ]);

    const storage = el('p', { class: 'pb-gallery__storage', 'data-gallery-storage': '' });
    const feedback = el('p', {
      class: 'pb-gallery__feedback',
      'data-gallery-feedback': '',
      role: 'status',
      'aria-live': 'polite'
    });

    const user = el('section', { class: 'pb-gallery__user', 'aria-label': 'Reader additions' }, [
      el('div', { class: 'pb-gallery__section-head' }, [
        el('h4', { class: 'pb-gallery__heading', text: 'Reader additions' }),
        el('p', { class: 'pb-gallery__subheading', 'data-gallery-count': '', text: 'No additions yet' })
      ]),
      empty,
      grid,
      dropzone,
      storage,
      feedback
    ]);

    root.append(seeds, divider, user);
    clear(this.host);
    this.host.append(root);

    this.refs = { root, grid, empty, dropzone, storage, feedback, input: null, addButton: null };
    this.refs.input = dropzone.querySelector('[data-gallery-input]');
    this.refs.addButton = dropzone.querySelector('[data-gallery-add]');
  }

  buildSeedGrid() {
    const chapter = this.chapter;
    const grid = el('div', { class: 'pb-gallery__grid pb-gallery__grid--seed', 'aria-label': 'Original plates' });
    const plates = chapter.galleryPlates || [];

    plates.forEach((src, index) => {
      const isBloom = index === 0;
      const label = isBloom ? 'Bloom' : 'Relic';
      const open = el('button', {
        class: 'pb-art__open',
        type: 'button',
        'data-seed': String(index),
        'aria-label': `Open the ${label} plate, plate ${pad2(index + 1)}, in the viewer`
      }, [
        el('span', {
          class: 'pb-art__frame',
          style: { '--art-ratio': '4 / 3' }
        }, [
          el('img', {
            src,
            alt: `${label} plate for Chapter ${chapter.number}: ${chapter.title}`,
            width: 1200,
            height: 900,
            loading: isBloom ? 'eager' : 'lazy',
            decoding: 'async'
          })
        ]),
        el('span', { class: 'pb-art__badge pb-art__badge--original', text: 'Original plate' })
      ]);

      grid.append(el('figure', { class: 'pb-art pb-art--seed' }, [
        open,
        el('figcaption', { class: 'pb-art__meta' }, [
          el('p', { class: 'pb-art__title', text: `${label} plate` }),
          el('p', { class: 'pb-art__artist', text: `Plate ${pad2(index + 1)}` })
        ])
      ]));
    });

    return grid;
  }

  renderUserSection() {
    if (!this.refs) return;
    const grid = this.refs.grid;
    clear(grid);
    this.revokeGridUrls();

    for (const record of this.artworks) {
      const url = createObjectURL(record.blob);
      if (url) this.gridUrls.set(record.id, url);
      grid.append(this.buildUserCard(record, url));
    }

    this.updateCounts();
  }

  buildUserCard(record, url) {
    const artist = String(record.artist || '').trim();
    const open = el('button', {
      class: 'pb-art__open',
      type: 'button',
      'data-open': String(record.id),
      'aria-label': `Open “${record.title}” in the viewer`
    }, [
      el('span', {
        class: 'pb-art__frame',
        style: { '--art-ratio': `${record.width || 4} / ${record.height || 3}` }
      }, [
        el('img', {
          src: url || '',
          alt: `Fan art: ${record.title}${artist ? ` by ${artist}` : ''}`,
          width: record.width || 1200,
          height: record.height || 900,
          loading: 'lazy',
          decoding: 'async'
        })
      ]),
      el('span', { class: 'pb-art__badge pb-art__badge--user', text: 'Your upload' })
    ]);

    return el('figure', { class: 'pb-art pb-art--user', 'data-artwork-id': String(record.id) }, [
      open,
      el('figcaption', { class: 'pb-art__meta' }, [
        el('p', { class: 'pb-art__title', 'data-artwork-title': '', text: record.title }),
        el('p', {
          class: 'pb-art__artist',
          'data-artwork-artist': '',
          text: artist || 'Artist not set'
        }),
        el('span', { class: 'pb-art__badge pb-art__badge--fan', text: 'Fan-art' }),
        el('div', { class: 'pb-art__actions' }, [
          el('button', {
            class: 'pb-art__action',
            type: 'button',
            'data-edit': String(record.id),
            'aria-label': `Edit details for “${record.title}”`
          }, ['Edit']),
          el('button', {
            class: 'pb-art__action pb-art__action--danger',
            type: 'button',
            'data-delete': String(record.id),
            'aria-label': `Delete “${record.title}”`
          }, ['Delete'])
        ])
      ])
    ]);
  }

  updateCounts() {
    if (!this.refs) return;
    const count = this.artworks.length;
    const bytes = this.artworks.reduce((sum, record) => sum + (Number(record.bytes) || 0), 0);
    const countNode = this.refs.root.querySelector('[data-gallery-count]');
    if (countNode) {
      countNode.textContent = count === 0
        ? 'No additions yet'
        : `${count} ${count === 1 ? 'addition' : 'additions'} saved`;
    }
    if (this.refs.empty) this.refs.empty.hidden = count > 0;
    this.refs.storage.textContent = count === 0
      ? 'Saved only in this browser · nothing added yet'
      : `Saved only in this browser · ${count} ${count === 1 ? 'image' : 'images'} · ${formatBytes(bytes)}`;
  }

  renderStorageError(error) {
    this.lastError = describeStoreError(error);
    if (!this.refs) return;
    if (this.refs.empty) this.refs.empty.hidden = true;
    this.setStatus(this.lastError, { error: true });
    if (this.refs.addButton) this.refs.addButton.disabled = true;
    if (this.refs.dropzone) this.refs.dropzone.classList.add('is-disabled');
    this.updateCounts();
  }

  setStatus(message, { error = false } = {}) {
    const node = this.refs?.feedback;
    if (!node) return;
    node.classList.toggle('is-error', Boolean(error));
    node.textContent = '';
    if (!message) return;
    requestAnimationFrame(() => {
      if (node.isConnected) node.textContent = message;
    });
  }

  /* ---------- host events ---------- */

  bindHost() {
    const { root, dropzone, input } = this.refs;

    this.on(root, 'click', (event) => this.onClick(event));

    this.on(dropzone, 'click', (event) => {
      if (event.target.closest('[data-gallery-add]')) return;
      this.openPicker();
    });

    this.on(input, 'change', () => {
      const files = Array.from(input.files || []);
      input.value = '';
      this.handleFiles(files);
    });

    this.on(dropzone, 'dragenter', (event) => {
      event.preventDefault();
      if (!this.busy) dropzone.classList.add('is-dragover');
    });
    this.on(dropzone, 'dragover', (event) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      if (!this.busy) dropzone.classList.add('is-dragover');
    });
    this.on(dropzone, 'dragleave', (event) => {
      if (event.relatedTarget && dropzone.contains(event.relatedTarget)) return;
      dropzone.classList.remove('is-dragover');
    });
    this.on(dropzone, 'drop', (event) => {
      event.preventDefault();
      dropzone.classList.remove('is-dragover');
      if (this.busy) return;
      const files = Array.from(event.dataTransfer?.files || []);
      this.handleFiles(files);
    });
  }

  onClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const add = target.closest('[data-gallery-add]');
    if (add) {
      this.openPicker();
      return;
    }

    const seed = target.closest('[data-seed]');
    if (seed) {
      this.openLightbox('seed', Number(seed.dataset.seed));
      return;
    }

    const open = target.closest('[data-open]');
    if (open) {
      this.openLightbox('user', Number(open.dataset.open));
      return;
    }

    const edit = target.closest('[data-edit]');
    if (edit) {
      this.openEditor(Number(edit.dataset.edit));
      return;
    }

    const remove = target.closest('[data-delete]');
    if (remove) {
      this.requestDelete(remove, Number(remove.dataset.delete));
    }
  }

  openPicker() {
    if (this.busy || !this.refs?.input || this.refs.addButton?.disabled) return;
    this.refs.input.click();
  }

  /* ---------- upload pipeline ---------- */

  async handleFiles(files) {
    if (this.busy || !files.length) return;

    if (files.length > GALLERY_LIMITS.maxBatch) {
      this.setStatus(`Please add up to ${GALLERY_LIMITS.maxBatch} images at a time.`, { error: true });
      return;
    }

    const remaining = GALLERY_LIMITS.maxPerChapter - this.artworks.length;
    if (remaining <= 0) {
      this.setStatus(`This gallery already holds its limit of ${GALLERY_LIMITS.maxPerChapter} images.`, { error: true });
      return;
    }
    if (files.length > remaining) {
      this.setStatus(
        `This gallery holds up to ${GALLERY_LIMITS.maxPerChapter} images. You can add ${remaining} more.`,
        { error: true }
      );
      return;
    }

    this.busy = true;
    this.setBusy(true);

    const added = [];
    const failures = [];
    const now = Date.now();

    try {
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        this.setStatus(`Adding ${index + 1} of ${files.length}…`);
        try {
          const prepared = await prepareImage(file);
          const record = {
            chapter: this.chapter.number,
            title: titleFromFilename(file.name),
            artist: '',
            mime: prepared.mime,
            width: prepared.width,
            height: prepared.height,
            bytes: prepared.bytes,
            createdAt: new Date(now + index).toISOString(),
            blob: prepared.blob
          };
          const id = await this.store.add(record);
          const stored = { ...record, id };
          this.artworks.push(stored);
          added.push(stored);
        } catch (error) {
          failures.push({ name: file.name, error });
        }
      }

      this.artworks = sortRecords(this.artworks);
      this.renderUserSection();
      this.lastError = null;

      if (added.length) {
        const first = document.querySelector(`[data-artwork-id="${added[0].id}"] [data-open]`);
        first?.focus?.({ preventScroll: true });
      }

      if (added.length && !failures.length) {
        this.setStatus(`Added ${added.length} ${added.length === 1 ? 'image' : 'images'}.`);
      } else if (added.length && failures.length) {
        this.setStatus(`Added ${added.length}. ${this.failureSummary(failures)}`, { error: true });
      } else if (failures.length) {
        this.setStatus(this.failureSummary(failures), { error: true });
      }
    } finally {
      this.busy = false;
      this.setBusy(false);
    }
  }

  failureSummary(failures) {
    const first = failures[0];
    if (failures.length === 1) {
      return `“${first.name}” was skipped: ${this.describeUploadError(first.error)}`;
    }
    return `${failures.length} files were skipped. ${this.describeUploadError(first.error)}`;
  }

  describeUploadError(error) {
    if (error instanceof GalleryStoreError) {
      if (error.code === 'too-large') return 'it is larger than 15 MB.';
      if (error.code === 'unsupported-type') return 'it is not a supported image type.';
      if (['quota', 'blocked', 'unsupported', 'error'].includes(error.code)) {
        return describeStoreError(error);
      }
    }
    return error?.message || 'it could not be read.';
  }

  setBusy(busy) {
    if (this.refs?.addButton) this.refs.addButton.disabled = busy;
    if (this.refs?.dropzone) this.refs.dropzone.classList.toggle('is-busy', busy);
    if (this.refs?.root) this.refs.root.setAttribute('aria-busy', String(Boolean(busy)));
  }

  /* ---------- delete ---------- */

  requestDelete(button, id) {
    const record = this.artworks.find((item) => item.id === id);
    if (!record) return;

    if (button.dataset.confirm === 'true') {
      this.clearDeleteTimer(id);
      this.performDelete(button, record);
      return;
    }

    button.dataset.confirm = 'true';
    button.classList.add('is-confirming');
    button.textContent = 'Delete?';
    button.setAttribute('aria-label', `Confirm delete of “${record.title}”`);
    this.setStatus(`Press delete again to remove “${record.title}”.`);
    this.pendingDeletes.set(id, window.setTimeout(() => {
      this.pendingDeletes.delete(id);
      if (button.isConnected) {
        button.dataset.confirm = 'false';
        button.classList.remove('is-confirming');
        button.textContent = 'Delete';
        button.setAttribute('aria-label', `Delete “${record.title}”`);
      }
    }, 5000));
  }

  clearDeleteTimer(id) {
    const timer = this.pendingDeletes.get(id);
    if (timer) {
      window.clearTimeout(timer);
      this.pendingDeletes.delete(id);
    }
  }

  clearDeleteTimers() {
    for (const timer of this.pendingDeletes.values()) window.clearTimeout(timer);
    this.pendingDeletes.clear();
  }

  async performDelete(button, record) {
    button.disabled = true;
    try {
      await this.store.remove(record.id);
      this.artworks = this.artworks.filter((item) => item.id !== record.id);
      revokeURL(this.gridUrls.get(record.id));
      this.gridUrls.delete(record.id);
      const card = this.refs?.root.querySelector(`[data-artwork-id="${record.id}"]`);
      card?.remove();
      this.updateCounts();
      if (this.lightbox?.open) this.closeLightbox();
      this.setStatus(`Removed “${record.title}”.`);
    } catch (error) {
      button.disabled = false;
      button.dataset.confirm = 'false';
      button.classList.remove('is-confirming');
      button.textContent = 'Delete';
      button.setAttribute('aria-label', `Delete “${record.title}”`);
      this.setStatus(`${describeStoreError(error)} Nothing was removed.`, { error: true });
    }
  }

  /* ---------- object URLs ---------- */

  revokeGridUrls() {
    for (const url of this.gridUrls.values()) revokeURL(url);
    this.gridUrls.clear();
  }

  revokeLightboxUrls() {
    for (const url of this.lightboxUrls.values()) revokeURL(url);
    this.lightboxUrls.clear();
  }

  /* ---------- dialogs ---------- */

  ensureDialogs() {
    if (this.dialogsReady) return;
    const layer = document.getElementById('gallery-layer') || document.body;

    this.lightbox = this.buildLightbox();
    this.editor = this.buildEditor();
    layer.append(this.lightbox, this.editor);
    this.dialogsReady = true;
  }

  buildLightbox() {
    const dialog = el('dialog', {
      class: 'pb-lightbox',
      'aria-label': 'Artwork viewer',
      'data-gallery-lightbox': ''
    });

    const image = el('img', { class: 'pb-lightbox__image', 'data-lb-image': '', alt: '', decoding: 'async' });
    const title = el('strong', { class: 'pb-lightbox__title', 'data-lb-title': '' });
    const artist = el('span', { class: 'pb-lightbox__artist', 'data-lb-artist': '' });
    const badge = el('span', { class: 'pb-lightbox__badge', 'data-lb-badge': '' });
    const counter = el('span', { class: 'pb-lightbox__counter', 'data-lb-counter': '' });

    const panel = el('div', { class: 'pb-lightbox__panel' }, [
      el('header', { class: 'pb-lightbox__bar' }, [
        badge,
        counter,
        el('button', {
          class: 'pb-lightbox__close',
          type: 'button',
          'data-lb-close': '',
          'aria-label': 'Close the artwork viewer',
          title: 'Close'
        }, ['×'])
      ]),
      el('figure', { class: 'pb-lightbox__figure' }, [
        image,
        el('figcaption', { class: 'pb-lightbox__caption' }, [title, artist])
      ]),
      el('div', { class: 'pb-lightbox__nav' }, [
        el('button', {
          class: 'pb-lightbox__step',
          type: 'button',
          'data-lb-prev': '',
          'aria-label': 'Previous artwork'
        }, ['←']),
        el('button', {
          class: 'pb-lightbox__step',
          type: 'button',
          'data-lb-next': '',
          'aria-label': 'Next artwork'
        }, ['→'])
      ])
    ]);

    dialog.append(panel);

    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) this.closeLightbox();
    });
    dialog.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        this.moveLightbox(1);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        this.moveLightbox(-1);
      }
    });
    panel.querySelector('[data-lb-close]').addEventListener('click', () => this.closeLightbox());
    panel.querySelector('[data-lb-prev]').addEventListener('click', () => this.moveLightbox(-1));
    panel.querySelector('[data-lb-next]').addEventListener('click', () => this.moveLightbox(1));

    dialog.addEventListener('close', () => this.finishLightboxClose());

    this.lightboxImage = image;
    this.lightboxTitle = title;
    this.lightboxArtist = artist;
    this.lightboxBadge = badge;
    this.lightboxCounter = counter;
    return dialog;
  }

  buildEditor() {
    const dialog = el('dialog', {
      class: 'pb-editor',
      'aria-labelledby': 'pb-editor-title',
      'data-gallery-editor': ''
    });

    const titleInput = el('input', {
      type: 'text',
      name: 'title',
      maxlength: String(GALLERY_LIMITS.titleMax),
      required: true,
      autocomplete: 'off'
    });
    const artistInput = el('input', {
      type: 'text',
      name: 'artist',
      maxlength: String(GALLERY_LIMITS.artistMax),
      autocomplete: 'off'
    });
    const error = el('p', { class: 'pb-editor__error', 'data-editor-error': '', role: 'alert' });

    const form = el('form', { class: 'pb-editor__form', novalidate: true }, [
      el('header', { class: 'pb-editor__head' }, [
        el('p', { class: 'eyebrow', text: 'Your upload' }),
        el('h2', { id: 'pb-editor-title', text: 'Edit details' })
      ]),
      el('label', { class: 'pb-editor__field' }, [
        el('span', { text: 'Title' }),
        titleInput
      ]),
      el('label', { class: 'pb-editor__field' }, [
        el('span', {}, ['Artist', el('em', { text: ' optional' })]),
        artistInput
      ]),
      error,
      el('footer', { class: 'pb-editor__actions' }, [
        el('button', {
          class: 'btn btn--ghost',
          type: 'button',
          'data-editor-cancel': ''
        }, ['Cancel']),
        el('button', {
          class: 'btn btn--primary',
          type: 'submit',
          'data-editor-save': ''
        }, ['Save'])
      ])
    ]);

    dialog.append(form);

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      this.saveEditor();
    });
    form.querySelector('[data-editor-cancel]').addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => {
      this.editorId = null;
      error.textContent = '';
    });

    this.editorTitleInput = titleInput;
    this.editorArtistInput = artistInput;
    this.editorError = error;
    return dialog;
  }

  /* ---------- lightbox ---------- */

  buildSequence() {
    const seeds = (this.chapter?.galleryPlates || []).map((src, index) => {
      const isBloom = index === 0;
      const label = isBloom ? 'Bloom' : 'Relic';
      return {
        kind: 'seed',
        key: `seed-${index}`,
        src,
        title: `${label} plate`,
        subtitle: `Plate ${pad2(index + 1)}`,
        badge: 'Original plate',
        alt: `${label} plate for Chapter ${this.chapter.number}`
      };
    });

    const users = this.artworks.map((record) => {
      let url = this.lightboxUrls.get(record.id);
      if (!url) {
        url = createObjectURL(record.blob);
        if (url) this.lightboxUrls.set(record.id, url);
      }
      return {
        kind: 'user',
        key: `user-${record.id}`,
        id: record.id,
        src: url,
        title: record.title,
        subtitle: record.artist || 'Artist not set',
        badge: 'Fan-art',
        alt: `Fan art: ${record.title}`
      };
    });

    return [...seeds, ...users];
  }

  openLightbox(kind, value) {
    this.ensureDialogs();
    this.revokeLightboxUrls();
    this.lightboxSequence = this.buildSequence();
    if (!this.lightboxSequence.length) return;

    const key = kind === 'seed' ? `seed-${value}` : `user-${value}`;
    const found = this.lightboxSequence.findIndex((item) => item.key === key);
    this.lightboxIndex = found >= 0 ? found : 0;

    this.lightboxInvoker = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.renderLightbox();
    if (!this.lightbox.open) {
      try {
        this.lightbox.showModal();
      } catch {
        this.lightbox.setAttribute('open', '');
      }
    }
  }

  renderLightbox() {
    const item = this.lightboxSequence[this.lightboxIndex];
    if (!item) return;
    this.lightboxImage.src = item.src || '';
    this.lightboxImage.alt = item.alt || '';
    this.lightboxTitle.textContent = item.title;
    this.lightboxArtist.textContent = item.subtitle || '';
    this.lightboxBadge.textContent = item.badge;
    this.lightboxBadge.dataset.kind = item.kind;
    this.lightboxCounter.textContent = `${this.lightboxIndex + 1} / ${this.lightboxSequence.length}`;
  }

  moveLightbox(delta) {
    const total = this.lightboxSequence.length;
    if (!total) return;
    this.lightboxIndex = (this.lightboxIndex + delta + total) % total;
    this.renderLightbox();
  }

  closeLightbox({ restoreFocus = true, immediate = false } = {}) {
    if (!this.lightbox) return;
    if (this.lightbox.open) {
      try {
        this.lightbox.close();
      } catch {
        this.lightbox.removeAttribute('open');
      }
    }
    if (immediate) this.finishLightboxClose({ restoreFocus });
    else this.revokeLightboxUrls();
  }

  finishLightboxClose({ restoreFocus = true } = {}) {
    this.revokeLightboxUrls();
    if (this.lightboxImage) {
      this.lightboxImage.removeAttribute('src');
      this.lightboxImage.alt = '';
    }
    const invoker = this.lightboxInvoker;
    this.lightboxInvoker = null;
    if (restoreFocus && invoker && invoker.isConnected) {
      invoker.focus({ preventScroll: true });
    }
  }

  /* ---------- editor ---------- */

  openEditor(id) {
    this.ensureDialogs();
    const record = this.artworks.find((item) => item.id === id);
    if (!record) return;

    this.editorId = id;
    this.editorTitleInput.value = record.title || '';
    this.editorArtistInput.value = record.artist || '';
    this.editorError.textContent = '';

    if (!this.editor.open) {
      try {
        this.editor.showModal();
      } catch {
        this.editor.setAttribute('open', '');
      }
    }
    requestAnimationFrame(() => {
      this.editorTitleInput.focus({ preventScroll: true });
      this.editorTitleInput.select();
    });
  }

  async saveEditor() {
    if (this.editorId === null) return;
    const record = this.artworks.find((item) => item.id === this.editorId);
    if (!record) {
      this.editor.close();
      return;
    }

    const title = String(this.editorTitleInput.value || '').trim().slice(0, GALLERY_LIMITS.titleMax);
    const artist = String(this.editorArtistInput.value || '').trim().slice(0, GALLERY_LIMITS.artistMax);

    if (!title) {
      this.editorError.textContent = 'A title is required (up to 80 characters).';
      this.editorTitleInput.focus({ preventScroll: true });
      return;
    }

    const saveButton = this.editor.querySelector('[data-editor-save]');
    if (saveButton) saveButton.disabled = true;

    try {
      await this.store.update(record.id, { title, artist });
      record.title = title;
      record.artist = artist;
      this.updateCard(record);
      this.editor.close();
      this.setStatus(`Saved details for “${title}”.`);
    } catch (error) {
      this.editorError.textContent = describeStoreError(error);
    } finally {
      if (saveButton) saveButton.disabled = false;
    }
  }

  updateCard(record) {
    const card = this.refs?.root?.querySelector(`[data-artwork-id="${record.id}"]`);
    if (!card) return;
    const titleNode = card.querySelector('[data-artwork-title]');
    const artistNode = card.querySelector('[data-artwork-artist]');
    if (titleNode) titleNode.textContent = record.title;
    if (artistNode) artistNode.textContent = record.artist || 'Artist not set';

    const openButton = card.querySelector('[data-open]');
    if (openButton) {
      openButton.setAttribute('aria-label', `Open “${record.title}” in the viewer`);
      const image = openButton.querySelector('img');
      if (image) {
        image.alt = `Fan art: ${record.title}${record.artist ? ` by ${record.artist}` : ''}`;
      }
    }
    const editButton = card.querySelector('[data-edit]');
    if (editButton) editButton.setAttribute('aria-label', `Edit details for “${record.title}”`);
    const deleteButton = card.querySelector('[data-delete]');
    if (deleteButton) deleteButton.setAttribute('aria-label', `Delete “${record.title}”`);
  }
}

export function createGallery(story, options = {}) {
  const gallery = new Gallery(story, options);
  return {
    mount: (host, chapter) => gallery.mount(host, chapter),
    unmount: () => gallery.unmount(),
    isOverlayOpen: () => gallery.isOverlayOpen(),
    getState: () => gallery.getState()
  };
}
