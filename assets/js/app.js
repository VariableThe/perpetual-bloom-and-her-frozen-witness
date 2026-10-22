/* Application entry: load the edition, wire landing, reader and history. */

import { loadStory } from './data.js';
import { initTheme } from './theme.js';
import { createParticleField } from './particles.js';
import { createAudio } from './audio.js';
import { initLanding } from './landing.js';
import { Reader } from './reader.js';
import { Router } from './router.js';

const ENDING_MESSAGE =
  'You have reached the final fold. The archive is complete — thank you for keeping these small things.';

const loadingScreen = document.getElementById('loading-screen');
const errorScreen = document.getElementById('error-screen');
const landingView = document.getElementById('landing-view');

function finishLoading() {
  if (!loadingScreen) return;
  loadingScreen.classList.add('is-done');
  window.setTimeout(() => {
    loadingScreen.hidden = true;
  }, 460);
}

function showFatalError(error) {
  console.error('Perpetual Bloom failed to start:', error);
  document.documentElement.dataset.appReady = 'error';
  if (landingView) landingView.setAttribute('inert', '');
  if (loadingScreen) loadingScreen.hidden = true;
  if (errorScreen) {
    errorScreen.hidden = false;
    errorScreen.querySelector('.error-screen__detail')?.remove();
    const detail = document.createElement('p');
    detail.className = 'error-screen__detail';
    detail.textContent = error instanceof Error ? error.message : String(error);
    errorScreen.append(detail);
  }
}

function boot() {
  initTheme();

  const particles = createParticleField(document.getElementById('petal-canvas'));
  let router = null;
  let landing = null;
  let reader = null;
  let audio = null;
  let pendingSection = null;
  let pendingEnding = null;

  function routeToLanding({ section = null, ending = null } = {}) {
    pendingSection = section;
    pendingEnding = ending;
    router.navigate('#/');
  }

  function handleRoute(route, meta = {}) {
    document.documentElement.dataset.route = route.view;

    if (route.view === 'reader') {
      landing?.hideEnding();
      landing?.setInert(true);
      audio?.setChapter(route.chapter);
      reader.show(route.chapter, route.pageToken, {
        animate: meta.source !== 'load' && meta.source !== 'history'
      });
      return;
    }

    if (route.view === 'anchor' && route.path.startsWith('#/')) {
      router.replace('#/');
      return;
    }

    const wasReading = Boolean(reader?.open);
    reader?.close();
    if (wasReading) audio?.pause({ silent: true });
    landing?.setInert(false);
    landing?.refreshProgress();

    if (pendingSection) {
      const section = pendingSection;
      pendingSection = null;
      requestAnimationFrame(() => landing?.scrollToSection(section));
    }

    if (pendingEnding) {
      const message = pendingEnding;
      pendingEnding = null;
      requestAnimationFrame(() => {
        landing?.scrollToTop();
        landing?.showEnding(message);
      });
    }

    /* Landing anchors are real history entries. A Back from the reader to
       #chapters must close the reader and place the archive back on screen. */
    if (route.view === 'anchor') {
      const anchorId = route.path.slice(1);
      requestAnimationFrame(() => {
        if (anchorId === 'top') landing?.scrollToTop();
        else landing?.scrollToSection(anchorId, { smooth: meta.source !== 'load' });
      });
    }
  }

  loadStory()
    .then((story) => {
      router = new Router(handleRoute);
      audio = createAudio(story);
      audio.mountDock(document.getElementById('audio-bar'));
      audio.mountTrackDrawer(document.getElementById('track-drawer'));
      window.__pbAudio = Object.freeze({ getState: () => audio.getState() });

      landing = initLanding(story, {
        navigate: (path) => router.navigate(path),
        audio
      });

      reader = new Reader(story, {
        particles,
        onOpen() {
          landing?.setInert(true);
        },
        onPageChange(chapter, token, { replace = false } = {}) {
          router.updateUrl(`#/read/${chapter}/${token}`, { replace });
        },
        onNavigate(path) {
          router.navigate(path);
        },
        onBackToChapters() {
          routeToLanding({ section: 'chapters' });
        },
        onExit() {
          routeToLanding();
        },
        onEnd() {
          routeToLanding({ section: 'top', ending: ENDING_MESSAGE });
        },
        onInvalidRoute() {
          router.replace('#/');
        }
      });

      router.start();
      finishLoading();
      document.documentElement.dataset.appReady = 'true';
    })
    .catch(showFatalError);
}

boot();
