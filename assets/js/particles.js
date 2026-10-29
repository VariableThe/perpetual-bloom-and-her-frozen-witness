/* Ambient petals and frost on a single fixed canvas. */

import { getSettings, prefersReducedMotion, clamp, debounce } from './utils.js';
import { THEME_EVENT } from './theme.js';

function paletteFor(theme) {
  if (theme === 'dark') {
    return [
      'rgba(255, 182, 193, 0.34)',
      'rgba(226, 205, 255, 0.28)',
      'rgba(255, 255, 255, 0.2)',
      'rgba(199, 155, 255, 0.24)'
    ];
  }
  return [
    'rgba(215, 108, 155, 0.28)',
    'rgba(255, 182, 193, 0.42)',
    'rgba(255, 255, 255, 0.7)',
    'rgba(167, 139, 250, 0.22)'
  ];
}

export function createParticleField(canvas) {
  if (!canvas) {
    return {
      setEnabled() {},
      pause() {},
      resume() {},
      burst() {},
      destroy() {},
      get enabled() { return false; }
    };
  }

  const context = canvas.getContext('2d', { alpha: true });
  if (!context) {
    return {
      setEnabled() {},
      pause() {},
      resume() {},
      burst() {},
      destroy() {},
      get enabled() { return false; }
    };
  }

  const DUST_COLORS = [
  'rgba(255, 226, 176, %s)',
  'rgba(255, 196, 152, %s)',
  'rgba(255, 182, 203, %s)',
  'rgba(255, 255, 255, %s)',
  'rgba(233, 221, 246, %s)'
];

function makeDust(index, rect, direction) {
  const spine = direction === 'prev' ? rect.right : rect.left;
  const x = rect.left + Math.random() * rect.width;
  const fromSpine = Math.abs(x - spine) / Math.max(rect.width, 1);
  return {
    x,
    y: rect.top + Math.random() * rect.height,
    r: 0.8 + Math.random() * 1.9,
    /* The dust peels from the spine outward, trailing the turning leaf. */
    delay: fromSpine * (420 + Math.random() * 260),
    life: 1500 + Math.random() * 800,
    age: 0,
    vy: -(5 + Math.random() * 13),
    drift: (spine === rect.left ? 1 : -1) * (2 + Math.random() * 6),
    swayAmp: 4 + Math.random() * 10,
    phase: Math.random() * Math.PI * 2,
    phaseSpeed: 0.0011 + Math.random() * 0.0022,
    twinkle: Math.random() * Math.PI * 2,
    twinkleSpeed: 0.004 + Math.random() * 0.007,
    baseAlpha: 0.45 + Math.random() * 0.45,
    color: DUST_COLORS[index % DUST_COLORS.length],
    star: Math.random() > 0.78
  };
}

const reduceQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  let enabled = getSettings().particles !== false;
  let reduced = prefersReducedMotion();
  /* Suspended while the passcode gate is up: the lock screen keeps the
     static crystal backdrop, and the particle loop starts on unlock. */
  let suspended = false;
  let running = false;
  let rafId = 0;
  let lastTime = 0;
  let width = 0;
  let height = 0;
  let dpr = 1;
  let particles = [];
  let dust = [];
  let palette = paletteFor(document.documentElement.dataset.theme);

  function makeParticle(index = 0) {
    const isFrost = Math.random() > 0.72;
    return {
      x: Math.random() * width,
      y: Math.random() * height,
      r: isFrost ? 1.1 + Math.random() * 2.1 : 3 + Math.random() * 7,
      fall: 3.5 + Math.random() * 10,
      drift: -5 + Math.random() * 10,
      phase: Math.random() * Math.PI * 2,
      phaseSpeed: 0.00016 + Math.random() * 0.00032,
      rotation: Math.random() * Math.PI * 2,
      spin: -0.00018 + Math.random() * 0.00036,
      alpha: 0.32 + Math.random() * 0.55,
      color: palette[index % palette.length],
      frost: isFrost
    };
  }

  function rebuild() {
    const target = Math.round(clamp((width * height) / 42000, 14, 42));
    particles = Array.from({ length: target }, (_, index) => makeParticle(index));
  }

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (particles.length === 0) rebuild();
    else {
      for (const particle of particles) {
        particle.x = clamp(particle.x, 0, width);
        particle.y = clamp(particle.y, 0, height);
      }
      const target = Math.round(clamp((width * height) / 42000, 14, 42));
      while (particles.length < target) particles.push(makeParticle(particles.length));
      if (particles.length > target) particles.length = target;
    }
    draw(0);
  }

  function draw(delta) {
    context.clearRect(0, 0, width, height);
    if (!enabled || reduced) return;

    const step = Math.min(delta, 50);

    for (const particle of particles) {
      particle.phase += particle.phaseSpeed * step;
      particle.y += (particle.fall * step) / 1000;
      particle.x += (Math.sin(particle.phase) * particle.drift * step) / 1000;
      particle.rotation += particle.spin * step;

      if (particle.y > height + 24) {
        particle.y = -24;
        particle.x = Math.random() * width;
      }
      if (particle.x < -30) particle.x = width + 24;
      if (particle.x > width + 30) particle.x = -24;

      context.save();
      context.translate(particle.x, particle.y);
      context.rotate(particle.rotation);
      context.globalAlpha = particle.alpha;
      context.fillStyle = particle.color;

      if (particle.frost) {
        context.beginPath();
        context.arc(0, 0, particle.r, 0, Math.PI * 2);
        context.fill();
        context.globalAlpha = particle.alpha * 0.55;
        context.strokeStyle = 'rgba(255, 255, 255, 0.6)';
        context.lineWidth = 0.7;
        context.beginPath();
        context.moveTo(-particle.r * 1.8, 0);
        context.lineTo(particle.r * 1.8, 0);
        context.moveTo(0, -particle.r * 1.8);
        context.lineTo(0, particle.r * 1.8);
        context.stroke();
      } else {
        context.beginPath();
        context.ellipse(0, 0, particle.r, particle.r * 0.6, 0, 0, Math.PI * 2);
        context.fill();
        context.globalAlpha = particle.alpha * 0.36;
        context.beginPath();
        context.ellipse(particle.r * 0.32, -particle.r * 0.16, particle.r * 0.52, particle.r * 0.27, 0, 0, Math.PI * 2);
        context.fill();
      }

      context.restore();
    }

    /* Fairy dust shed by a turning page: born inside the page rect, peels
       from the spine, drifts upward with a gentle sway and a twinkle, then
       eases out. Slower and softer than the ambient petals. */
    if (dust.length) {
      const alive = [];
      for (const mote of dust) {
        mote.age += step;
        if (mote.age < mote.delay) {
          alive.push(mote);
          continue;
        }
        const lived = mote.age - mote.delay;
        if (lived > mote.life) continue;

        mote.phase += mote.phaseSpeed * step;
        mote.twinkle += mote.twinkleSpeed * step;
        mote.x += ((mote.drift + Math.sin(mote.phase) * mote.swayAmp) * step) / 1000;
        mote.y += (mote.vy * step) / 1000;

        const fadeIn = Math.min(lived / 160, 1);
        const fadeOut = Math.max(1 - (lived - mote.life * 0.58) / (mote.life * 0.42), 0);
        const twinkle = 0.55 + 0.45 * Math.sin(mote.twinkle);
        const alpha = mote.baseAlpha * fadeIn * fadeOut * fadeOut * twinkle;
        if (alpha <= 0.01) continue;

        context.save();
        context.globalAlpha = alpha;
        context.fillStyle = mote.color.replace('%s', '1');
        context.beginPath();
        context.arc(mote.x, mote.y, mote.r, 0, Math.PI * 2);
        context.fill();

        if (mote.star) {
          const reach = mote.r * (2.2 + Math.sin(mote.twinkle * 1.7));
          context.strokeStyle = mote.color.replace('%s', '1');
          context.lineWidth = 0.55;
          context.beginPath();
          context.moveTo(mote.x - reach, mote.y);
          context.lineTo(mote.x + reach, mote.y);
          context.moveTo(mote.x, mote.y - reach);
          context.lineTo(mote.x, mote.y + reach);
          context.stroke();
        }
        context.restore();

        alive.push(mote);
      }
      dust = alive;
    }
  }

  function frame(now) {
    if (!running) return;
    const delta = lastTime ? now - lastTime : 16;
    lastTime = now;
    draw(delta);
    rafId = requestAnimationFrame(frame);
  }

  function start() {
    if (suspended || running || !enabled || reduced || document.hidden) {
      if (!enabled || reduced) context.clearRect(0, 0, width, height);
      return;
    }
    running = true;
    lastTime = 0;
    rafId = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  function setEnabled(value) {
    enabled = Boolean(value);
    if (enabled) start();
    else {
      stop();
      dust = [];
      context.clearRect(0, 0, width, height);
    }
  }

  /* A page is turning: shed fairy dust from the page rect. Direction says
     which edge is the spine ("next" turns around the left edge, "prev"
     around the right). Honors the particles setting and reduced motion. */
  function burst(rect, { direction = 'next' } = {}) {
    if (!enabled || reduced || suspended || !rect || rect.width <= 0) return;
    const count = Math.round(clamp((rect.width * rect.height) / 9000, 70, 170));
    const offset = dust.length;
    for (let index = 0; index < count; index += 1) {
      dust.push(makeDust(offset + index, rect, direction));
    }
    if (dust.length > 600) dust.splice(0, dust.length - 600);
  }

  /* Gate the animation loop without touching the user's particles setting. */
  function pause() {
    suspended = true;
    stop();
  }

  function resume() {
    suspended = false;
    start();
  }

  function onVisibility() {
    if (document.hidden) stop();
    else start();
  }

  function onReducedMotion(event) {
    reduced = event.matches;
    if (reduced) {
      stop();
      dust = [];
      context.clearRect(0, 0, width, height);
    } else {
      start();
    }
  }

  function onTheme() {
    palette = paletteFor(document.documentElement.dataset.theme);
    for (let index = 0; index < particles.length; index += 1) {
      particles[index].color = palette[index % palette.length];
    }
  }

  const onResize = debounce(resize, 170);

  window.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener(THEME_EVENT, onTheme);
  if (reduceQuery) {
    if (reduceQuery.addEventListener) reduceQuery.addEventListener('change', onReducedMotion);
    else if (reduceQuery.addListener) reduceQuery.addListener(onReducedMotion);
  }

  resize();
  if (enabled && !reduced) start();

  return {
    setEnabled,
    burst,
    pause,
    resume,
    destroy() {
      stop();
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener(THEME_EVENT, onTheme);
      if (reduceQuery) {
        if (reduceQuery.removeEventListener) reduceQuery.removeEventListener('change', onReducedMotion);
        else if (reduceQuery.removeListener) reduceQuery.removeListener(onReducedMotion);
      }
    },
    get enabled() {
      return enabled;
    }
  };
}
