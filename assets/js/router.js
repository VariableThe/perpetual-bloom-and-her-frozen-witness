/* Tiny hash router. Updates history without reloading and supports back/forward. */

const READER_PATTERN = /^#\/read\/(\d+)(?:\/(gallery|\d+))?\/?$/;

export class Router {
  constructor(onRoute) {
    this.onRoute = onRoute;
    this.lastHref = '';
    this.handleClick = this.handleClick.bind(this);
    this.handleLocation = this.handleLocation.bind(this);
  }

  parse(href = window.location.href) {
    const url = new URL(href);
    const hash = url.hash || '#/';

    if (!hash || hash === '#' || hash === '#/') {
      return { view: 'landing', path: '#/' };
    }

    const match = READER_PATTERN.exec(hash);
    if (match) {
      return {
        view: 'reader',
        path: hash,
        chapter: Number(match[1]),
        pageToken: match[2] || '0'
      };
    }

    return { view: 'anchor', path: hash };
  }

  start() {
    document.addEventListener('click', this.handleClick);
    window.addEventListener('popstate', this.handleLocation);
    window.addEventListener('hashchange', this.handleLocation);
    this.lastHref = window.location.href;
    this.onRoute(this.parse(), { source: 'load' });
  }

  handleClick(event) {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    const anchor = event.target.closest('a[href]');
    if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return;

    const href = anchor.getAttribute('href');
    if (!href || !href.startsWith('#/')) return;

    event.preventDefault();
    this.navigate(href);
  }

  handleLocation() {
    if (window.location.href === this.lastHref) return;
    this.lastHref = window.location.href;
    this.onRoute(this.parse(), { source: 'history' });
  }

  navigate(path, { replace = false } = {}) {
    const next = path.startsWith('#') ? path : `#/${path.replace(/^\/+/, '')}`;
    if (window.location.hash === next && !replace) {
      this.onRoute(this.parse(), { source: 'navigate' });
      return;
    }

    if (replace) {
      window.history.replaceState(null, '', next);
    } else {
      window.history.pushState(null, '', next);
    }

    this.lastHref = window.location.href;
    this.onRoute(this.parse(), { source: 'navigate' });
  }

  replace(path) {
    this.navigate(path, { replace: true });
  }

  /* Update the URL without asking the app to re-render. Used for page turns. */
  updateUrl(path, { replace = false } = {}) {
    const next = path.startsWith('#') ? path : `#/${path.replace(/^\/+/, '')}`;
    if (window.location.hash === next) {
      this.lastHref = window.location.href;
      return;
    }

    if (replace) {
      window.history.replaceState(null, '', next);
    } else {
      window.history.pushState(null, '', next);
    }
    this.lastHref = window.location.href;
  }
}
