/* Generative chapter soundtrack: a small WebAudio score plus its player UI.

   Nothing is streamed. Every pad, bass note, chime and breath of air is
   synthesised in the browser from the palette in data/story.config.json.
   The AudioContext is only created from a play gesture. */

import {
  el,
  clear,
  clamp,
  safeRead,
  safeWrite,
  createFocusTrap,
  announce,
  actLabel
} from './utils.js';

const AUDIO_STORAGE_KEY = 'pb.audio.v1';
const DEFAULT_VOLUME = 0.52;
const DEFAULT_LOOP = true;
const CROSSFADE = 1.4;
const INTRO_FADE = 1.2;
const LOOKAHEAD = 0.7;
const SCHEDULER_INTERVAL = 120;
const MAX_VOICES = 28;
const ARC_CHORDS = 8;

const MODE_INTERVALS = Object.freeze({
  ionian: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  majorPentatonic: [0, 2, 4, 7, 9],
  minorPentatonic: [0, 3, 5, 7, 10]
});

function pad2(number) {
  return String(number).padStart(2, '0');
}

function midiToHz(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function randomFactory(seed = 0x2f6e2b1) {
  let state = seed >>> 0;
  return function random() {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function holdParam(param, now) {
  if (!param) return;
  if (typeof param.cancelAndHoldAtTime === 'function') {
    param.cancelAndHoldAtTime(now);
  } else {
    param.cancelScheduledValues(now);
    param.setValueAtTime(Math.max(0.0001, param.value), now);
  }
}

function createImpulse(context) {
  const seconds = 3.4;
  const length = Math.max(1, Math.floor(context.sampleRate * seconds));
  const impulse = context.createBuffer(2, length, context.sampleRate);
  const random = randomFactory(0x51f15e);
  for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < length; i += 1) {
      const taper = Math.pow(1 - i / length, 2.7);
      const early = i < context.sampleRate * 0.08 ? 0.6 : 1;
      data[i] = (random() * 2 - 1) * taper * early * (channel === 0 ? 1 : 0.92);
    }
  }
  return impulse;
}

function createNoise(context) {
  const length = Math.max(1, Math.floor(context.sampleRate * 2.4));
  const noise = context.createBuffer(2, length, context.sampleRate);
  const random = randomFactory(0x7a1c3d);
  for (let channel = 0; channel < noise.numberOfChannels; channel += 1) {
    const data = noise.getChannelData(channel);
    for (let i = 0; i < length; i += 1) {
      data[i] = random() * 2 - 1;
    }
  }
  return noise;
}

function scaleTone(root, mode, step, octave = 0) {
  const intervals = MODE_INTERVALS[mode] || MODE_INTERVALS.ionian;
  const octaveShift = Math.floor(step / intervals.length) + octave;
  const index = ((step % intervals.length) + intervals.length) % intervals.length;
  return root + intervals[index] + octaveShift * 12;
}

function chordTones(track, degree) {
  return [
    scaleTone(track.root, track.mode, degree, 1),
    scaleTone(track.root, track.mode, degree + 2, 1),
    scaleTone(track.root, track.mode, degree + 4, 1)
  ];
}

function leadVoicing(notes, previous) {
  return notes.map((note, index) => {
    let next = note;
    if (previous && Number.isFinite(previous[index])) {
      while (next - previous[index] > 6) next -= 12;
      while (previous[index] - next > 6) next += 12;
      if (next < 45) next += 12;
      if (next > 88) next -= 12;
    }
    return next;
  });
}

const ICONS = Object.freeze({
  play: '<svg viewBox="0 0 24 24" width="16" height="16" focusable="false" aria-hidden="true"><path d="M8 5.2v13.6L19 12z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24" width="16" height="16" focusable="false" aria-hidden="true"><path d="M7.2 5h3.2v14H7.2zM13.6 5h3.2v14h-3.2z" fill="currentColor"/></svg>',
  previous: '<svg viewBox="0 0 24 24" width="16" height="16" focusable="false" aria-hidden="true"><path d="M6.5 5v14M18.5 6l-8.5 6 8.5 6z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/></svg>',
  next: '<svg viewBox="0 0 24 24" width="16" height="16" focusable="false" aria-hidden="true"><path d="M17.5 5v14M5.5 6l8.5 6-8.5 6z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/></svg>',
  volume: '<svg viewBox="0 0 24 24" width="17" height="17" focusable="false" aria-hidden="true"><path d="M5 9h4l5-4v14l-5-4H5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M17 9.2a4 4 0 0 1 0 5.6M19.6 6.6a8 8 0 0 1 0 10.8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  muted: '<svg viewBox="0 0 24 24" width="17" height="17" focusable="false" aria-hidden="true"><path d="M5 9h4l5-4v14l-5-4H5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="m16.5 9 5 5m0-5-5 5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  loop: '<svg viewBox="0 0 24 24" width="17" height="17" focusable="false" aria-hidden="true"><path d="M6 8h9a3 3 0 0 1 3 3v2M18 16H9a3 3 0 0 1-3-3v-2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="m15 5 3 3-3 3M9 19l-3-3 3-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  list: '<svg viewBox="0 0 24 24" width="17" height="17" focusable="false" aria-hidden="true"><path d="M4.5 6.5h15M4.5 12h15M4.5 17.5h15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="2" cy="6.5" r="0.9" fill="currentColor"/><circle cx="2" cy="12" r="0.9" fill="currentColor"/><circle cx="2" cy="17.5" r="0.9" fill="currentColor"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" width="14" height="14" focusable="false" aria-hidden="true"><path d="M6 12h12M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>'
});

function icon(name) {
  const node = document.createElement('span');
  node.className = 'audio-icon';
  node.setAttribute('aria-hidden', 'true');
  node.innerHTML = ICONS[name] || ICONS.play;
  return node;
}

function equalizer(className) {
  return el('span', { class: className, 'aria-hidden': 'true' }, [
    el('span'),
    el('span'),
    el('span'),
    el('span')
  ]);
}

function setIcon(button, name) {
  if (!button) return;
  const node = button.querySelector('.audio-icon');
  if (node) node.innerHTML = ICONS[name] || ICONS.play;
}

class AudioDirector {
  constructor(story, options = {}) {
    this.story = story;
    this.options = options;
    this.chapters = Array.isArray(story.chapters) ? story.chapters : [];
    this.tracks = Array.isArray(story.tracks) ? story.tracks : this.chapters.map((chapter) => chapter.track);
    this.chaptersByNumber = story.chaptersByNumber || new Map(this.chapters.map((chapter) => [chapter.number, chapter]));
    this.trackById = new Map(this.tracks.map((track) => [track.id, track]));
    this.trackByNumber = new Map(this.tracks.map((track) => [track.number, track]));
    this.trackChapter = new Map();
    for (const chapter of this.chapters) {
      if (chapter.trackId) this.trackChapter.set(chapter.trackId, chapter);
      if (chapter.track?.id && !this.trackChapter.has(chapter.track.id)) {
        this.trackChapter.set(chapter.track.id, chapter);
      }
    }

    const saved = safeRead(AUDIO_STORAGE_KEY, {}) || {};
    const savedVolume = Number(saved.volume);
    this.volume = Number.isFinite(savedVolume) ? clamp(savedVolume, 0, 1) : DEFAULT_VOLUME;
    this.muted = saved.muted === true;
    this.loop = saved.loop !== false;

    this.supported = Boolean(
      typeof window !== 'undefined' &&
      (window.AudioContext || window.webkitAudioContext)
    );
    this.engineError = null;
    this.context = null;
    this.masterGain = null;
    this.transportGain = null;
    this.reverb = null;
    this.noiseBuffer = null;
    this.groups = new Set();
    this.playingGroup = null;
    this.activeTrackId = null;
    this.activeTrackNumber = null;
    this.activeChapterNumber = null;
    this.isPlaying = false;
    this.schedulerTicks = 0;
    this.schedulerTimer = 0;
    this.suspendTimer = 0;
    this.voiceCount = 0;
    this.serial = 0;
    this.listeners = new Set();
    this.landing = null;
    this.dock = null;
    this.trackDrawer = null;
    this.trackDrawerList = null;
    this.trackButton = null;
    this.drawerOpen = false;
    this.drawerTrap = null;
    this.destroyed = false;

    this.statusNode = document.getElementById('audio-status');
    if (!this.statusNode && document.body) {
      this.statusNode = document.createElement('p');
      this.statusNode.id = 'audio-status';
      this.statusNode.className = 'sr-only';
      this.statusNode.setAttribute('aria-live', 'polite');
      document.body.append(this.statusNode);
    }

    this.onLandingClick = (event) => this.handleLandingClick(event);
    this.onDockClick = (event) => this.handleDockClick(event);
    this.onDrawerClick = (event) => this.handleDrawerClick(event);
    this.onDocumentKeydown = (event) => this.handleGlobalKeydown(event);
    this.onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') this.pause({ silent: true });
    };
    this.onPageHide = () => this.pause({ silent: true });

    document.addEventListener('keydown', this.onDocumentKeydown, true);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    window.addEventListener('pagehide', this.onPageHide);
  }

  /* ------------------------------------------------------------------ */
  /* Public state and transport                                          */
  /* ------------------------------------------------------------------ */

  getState() {
    return Object.freeze({
      supported: this.supported,
      contextState: this.context ? this.context.state : 'uninitialized',
      engineError: this.engineError,
      isPlaying: this.isPlaying,
      activeTrackId: this.activeTrackId,
      activeTrackNumber: this.activeTrackNumber,
      activeChapterNumber: this.activeChapterNumber,
      muted: this.muted,
      volume: this.volume,
      loop: this.loop,
      schedulerTicks: this.schedulerTicks
    });
  }

  subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit() {
    if (this.destroyed) return;
    const state = this.getState();
    for (const listener of this.listeners) {
      try {
        listener(state);
      } catch (error) {
        console.error('Audio subscriber failed:', error);
      }
    }
    this.syncLanding();
    this.syncDock();
    this.syncDrawer();
  }

  speak(message, { force = false } = {}) {
    if (!message) return;
    if (this.options.announce && typeof this.options.announce === 'function' && !force) {
      this.options.announce(message);
    } else {
      announce(this.statusNode, message);
    }
  }

  resolveTrack(value) {
    if (value && typeof value === 'object' && value.id) return value;
    if (typeof value === 'number') return this.trackByNumber.get(value) || null;
    if (typeof value === 'string') {
      if (/^\d+$/.test(value)) return this.trackByNumber.get(Number(value)) || null;
      return this.trackById.get(value) || null;
    }
    return null;
  }

  chapterForTrack(track) {
    if (!track) return null;
    return this.trackChapter.get(track.id) || null;
  }

  currentTrack() {
    return this.activeTrackId ? this.trackById.get(this.activeTrackId) || null : null;
  }

  ensureContext() {
    if (this.destroyed) return null;
    if (this.context && this.context.state !== 'closed') return this.context;
    if (!this.supported) {
      this.engineError = 'unsupported';
      return null;
    }

    const Constructor = window.AudioContext || window.webkitAudioContext;
    let context;
    try {
      context = new Constructor({ latencyHint: 'interactive' });
    } catch (error) {
      try {
        context = new Constructor();
      } catch (fallbackError) {
        console.error('Could not create the audio context:', fallbackError);
        this.supported = false;
        this.engineError = 'context';
        this.emit();
        return null;
      }
    }

    this.context = context;
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -20;
    compressor.knee.value = 22;
    compressor.ratio.value = 3.2;
    compressor.attack.value = 0.008;
    compressor.release.value = 0.28;

    const master = context.createGain();
    master.gain.value = this.muted ? 0.0001 : Math.max(0.0001, this.volume);

    const transport = context.createGain();
    transport.gain.value = this.isPlaying ? 1 : 0;

    const convolver = context.createConvolver();
    convolver.buffer = createImpulse(context);

    const wet = context.createGain();
    wet.gain.value = 0.34;

    transport.connect(master);
    master.connect(compressor);
    compressor.connect(context.destination);
    convolver.connect(wet);
    wet.connect(transport);

    this.masterGain = master;
    this.transportGain = transport;
    this.reverb = convolver;
    this.noiseBuffer = createNoise(context);

    context.onstatechange = () => {
      if (!this.destroyed) this.emit();
    };

    this.schedulerTimer = window.setInterval(() => this.schedulerTick(), SCHEDULER_INTERVAL);
    this.emit();
    return context;
  }

  async resumeContext() {
    const context = this.context;
    if (!context) return false;
    if (context.state === 'suspended' || context.state === 'interrupted') {
      try {
        await context.resume();
      } catch (error) {
        console.warn('The soundtrack could not resume:', error);
      }
    }
    return context.state === 'running';
  }

  setTransport(enabled, duration = INTRO_FADE) {
    if (!this.context || !this.transportGain) return;
    const gain = this.transportGain.gain;
    const now = this.context.currentTime;
    holdParam(gain, now);
    const target = enabled ? 1 : 0.0001;
    const fade = Math.max(0.05, duration);
    gain.linearRampToValueAtTime(target, now + fade);
  }

  playTrack(value) {
    const track = this.resolveTrack(value);
    if (!track) return false;
    const chapter = this.chapterForTrack(track);
    if (!chapter) return false;

    this.activeTrackId = track.id;
    this.activeTrackNumber = track.number;
    this.activeChapterNumber = chapter.number;

    const context = this.ensureContext();
    if (!context) {
      this.speak('The soundtrack is unavailable in this browser.');
      this.emit();
      return false;
    }

    window.clearTimeout(this.suspendTimer);
    this.resumeContext();
    this.isPlaying = true;
    this.setTransport(true, INTRO_FADE);

    if (this.playingGroup && !this.playingGroup.dead && this.playingGroup.track.id === track.id) {
      this.emit();
      this.speak(`Playing Track ${pad2(track.number)}, ${track.title}, for Chapter ${chapter.number}.`);
      return true;
    }

    this.startTrack(track, chapter, { intro: INTRO_FADE, crossfade: this.playingGroup ? CROSSFADE : INTRO_FADE });
    this.emit();
    this.speak(`Playing Track ${pad2(track.number)}, ${track.title}, for Chapter ${chapter.number}.`);
    return true;
  }

  play() {
    if (this.isPlaying) return true;
    let track = this.currentTrack();
    if (!track) {
      const chapter = this.chaptersByNumber.get(this.activeChapterNumber || 1) || this.chapters[0];
      track = chapter?.track || this.tracks[0] || null;
      if (!track) return false;
      const chapterForTrack = this.chapterForTrack(track);
      this.activeTrackId = track.id;
      this.activeTrackNumber = track.number;
      this.activeChapterNumber = chapterForTrack?.number || chapter?.number || 1;
    }
    const chapter = this.chapterForTrack(track) || this.chaptersByNumber.get(this.activeChapterNumber);
    if (!chapter) return false;

    const context = this.ensureContext();
    if (!context) {
      this.speak('The soundtrack is unavailable in this browser.');
      this.emit();
      return false;
    }

    window.clearTimeout(this.suspendTimer);
    this.resumeContext();
    this.isPlaying = true;
    this.setTransport(true, INTRO_FADE);

    if (this.playingGroup && !this.playingGroup.dead && this.playingGroup.track.id === track.id) {
      this.emit();
      this.speak(`Resuming Track ${pad2(track.number)}, ${track.title}.`);
      return true;
    }

    this.startTrack(track, chapter, { intro: INTRO_FADE, crossfade: this.playingGroup ? CROSSFADE : INTRO_FADE });
    this.emit();
    this.speak(`Playing Track ${pad2(track.number)}, ${track.title}, for Chapter ${chapter.number}.`);
    return true;
  }

  pause({ silent = false } = {}) {
    if (!this.isPlaying) return false;
    this.isPlaying = false;
    this.setTransport(false, 0.38);
    if (this.context) {
      window.clearTimeout(this.suspendTimer);
      const context = this.context;
      this.suspendTimer = window.setTimeout(() => {
        if (this.isPlaying || this.destroyed) return;
        if (context.state === 'running') context.suspend().catch(() => {});
      }, 440);
    }
    this.emit();
    if (!silent) this.speak('Soundtrack paused.');
    return true;
  }

  pauseSilently() {
    return this.pause({ silent: true });
  }

  toggle() {
    return this.isPlaying ? this.pause() : this.play();
  }

  setChapter(number, { autoplay = false } = {}) {
    const chapter = this.chaptersByNumber.get(Number(number));
    if (!chapter || !chapter.track) return false;
    const track = chapter.track;
    const changed = this.activeTrackId !== track.id || this.activeChapterNumber !== chapter.number;

    this.activeTrackId = track.id;
    this.activeTrackNumber = track.number;
    this.activeChapterNumber = chapter.number;

    if (!changed) {
      if (autoplay && !this.isPlaying) this.play();
      else this.emit();
      return true;
    }

    if (this.isPlaying) {
      this.startTrack(track, chapter, { crossfade: CROSSFADE, intro: CROSSFADE });
      this.emit();
      this.speak(`Now scoring Chapter ${chapter.number}, ${track.title}.`);
      return true;
    }

    this.disposeGroups();
    if (autoplay) this.play();
    else this.emit();
    return true;
  }

  nextTrack() {
    const ordered = this.tracks.slice().sort((a, b) => a.number - b.number);
    if (!ordered.length) return false;
    const index = ordered.findIndex((track) => track.id === this.activeTrackId);
    const next = ordered[(index + 1 + ordered.length) % ordered.length] || ordered[0];
    return this.playTrack(next.id);
  }

  previousTrack() {
    const ordered = this.tracks.slice().sort((a, b) => a.number - b.number);
    if (!ordered.length) return false;
    const index = ordered.findIndex((track) => track.id === this.activeTrackId);
    const previous = index <= 0 ? ordered[ordered.length - 1] : ordered[index - 1];
    return this.playTrack(previous.id);
  }

  setVolume(value) {
    this.volume = clamp(Number(value) || 0, 0, 1);
    if (this.masterGain && this.context) {
      const now = this.context.currentTime;
      holdParam(this.masterGain.gain, now);
      this.masterGain.gain.linearRampToValueAtTime(
        this.muted ? 0.0001 : Math.max(0.0001, this.volume),
        now + 0.08
      );
    }
    safeWrite(AUDIO_STORAGE_KEY, { volume: this.volume, muted: this.muted, loop: this.loop });
    this.emit();
    return this.volume;
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.masterGain && this.context) {
      const now = this.context.currentTime;
      holdParam(this.masterGain.gain, now);
      this.masterGain.gain.linearRampToValueAtTime(
        this.muted ? 0.0001 : Math.max(0.0001, this.volume),
        now + 0.12
      );
    }
    safeWrite(AUDIO_STORAGE_KEY, { volume: this.volume, muted: this.muted, loop: this.loop });
    this.emit();
    this.speak(this.muted ? 'Soundtrack muted.' : 'Soundtrack unmuted.');
    return this.muted;
  }

  toggleLoop() {
    this.loop = !this.loop;
    if (this.loop && this.playingGroup) this.playingGroup.arcEndTime = 0;
    safeWrite(AUDIO_STORAGE_KEY, { volume: this.volume, muted: this.muted, loop: this.loop });
    this.emit();
    this.speak(this.loop ? 'Track repeats enabled.' : 'Track will play one arc and stop.');
    return this.loop;
  }

  /* ------------------------------------------------------------------ */
  /* Engine: tracks, scheduling and voices                               */
  /* ------------------------------------------------------------------ */

  startTrack(track, chapter, { intro = INTRO_FADE, crossfade = CROSSFADE } = {}) {
    if (!this.context || !this.transportGain) return null;
    if (this.playingGroup) this.fadeOutGroup(this.playingGroup, crossfade);

    const context = this.context;
    const input = context.createGain();
    input.gain.value = 1;
    const output = context.createGain();
    output.gain.value = 0.0001;
    const send = context.createGain();
    const brightness = clamp(Number(track.brightness) || 1600, 900, 2400);
    send.gain.value = 0.22 + (brightness / 2400) * 0.24;

    input.connect(output);
    output.connect(this.transportGain);
    output.connect(send);
    send.connect(this.reverb);

    const barDuration = (60 / clamp(Number(track.tempo) || 58, 40, 90)) * 4;
    const group = {
      serial: ++this.serial,
      track,
      chapter,
      input,
      output,
      send,
      voices: new Set(),
      voiceCount: 0,
      previousPad: null,
      chordIndex: 0,
      scheduledChords: 0,
      nextChordTime: context.currentTime + 0.08,
      arcEndTime: 0,
      barDuration,
      dead: false,
      disposeTimer: 0
    };

    this.groups.add(group);
    this.playingGroup = group;

    const now = context.currentTime;
    output.gain.cancelScheduledValues(now);
    output.gain.setValueAtTime(0.0001, now);
    output.gain.exponentialRampToValueAtTime(0.92, now + Math.max(0.2, intro));

    this.pumpGroup(group, now);
    return group;
  }

  fadeOutGroup(group, duration = CROSSFADE) {
    if (!group || group.dead) return;
    group.dead = true;
    if (this.playingGroup === group) this.playingGroup = null;
    if (!this.context) {
      this.disposeGroup(group);
      return;
    }
    const now = this.context.currentTime;
    const gain = group.output.gain;
    holdParam(gain, now);
    gain.exponentialRampToValueAtTime(0.0001, now + Math.max(0.1, duration));
    group.disposeTimer = window.setTimeout(() => this.disposeGroup(group), (duration + 0.35) * 1000);
  }

  finishGroup(group) {
    if (!group || group.dead) return;
    group.dead = true;
    if (this.playingGroup === group) this.playingGroup = null;
    const now = this.context ? this.context.currentTime : 0;
    if (this.context) {
      const gain = group.output.gain;
      holdParam(gain, now);
      gain.exponentialRampToValueAtTime(0.0001, now + 1.1);
      group.disposeTimer = window.setTimeout(() => this.disposeGroup(group), 1500);
    } else {
      this.disposeGroup(group);
    }
    if (this.isPlaying) {
      this.isPlaying = false;
      this.emit();
      this.speak('The track has finished its arc.');
    }
  }

  disposeGroup(group) {
    if (!group || group.disposed) return;
    group.disposed = true;
    window.clearTimeout(group.disposeTimer);
    for (const voice of group.voices) {
      if (!voice.done) {
        voice.done = true;
        this.voiceCount = Math.max(0, this.voiceCount - 1);
        group.voiceCount = Math.max(0, group.voiceCount - 1);
        try {
          if (voice.source) voice.source.stop();
        } catch (error) {
          /* already stopped */
        }
        for (const node of voice.nodes) {
          try {
            node.disconnect();
          } catch (error) {
            /* already disconnected */
          }
        }
      }
    }
    group.voices.clear();
    for (const node of [group.input, group.output, group.send]) {
      try {
        node.disconnect();
      } catch (error) {
        /* already disconnected */
      }
    }
    this.groups.delete(group);
  }

  disposeGroups() {
    for (const group of Array.from(this.groups)) this.disposeGroup(group);
    this.playingGroup = null;
    this.groups.clear();
    this.voiceCount = 0;
  }

  schedulerTick() {
    if (this.destroyed || !this.context) return;
    if (this.context.state !== 'running' || !this.isPlaying) return;
    this.schedulerTicks += 1;
    const now = this.context.currentTime;
    for (const group of Array.from(this.groups)) {
      if (group.dead) continue;
      if (group.arcEndTime && now >= group.arcEndTime) {
        this.finishGroup(group);
        continue;
      }
      this.pumpGroup(group, now);
    }
  }

  pumpGroup(group, now) {
    if (!this.context || group.dead) return;
    if (group.nextChordTime < now - 0.25) group.nextChordTime = now + 0.05;
    const horizon = now + LOOKAHEAD;
    let guard = 0;
    while (!group.dead && group.nextChordTime < horizon && guard < 4) {
      if (!this.loop && group.scheduledChords >= ARC_CHORDS) {
        if (!group.arcEndTime) group.arcEndTime = group.nextChordTime + 1.6;
        break;
      }
      this.scheduleChord(group, group.chordIndex, group.nextChordTime);
      group.scheduledChords += 1;
      group.chordIndex = (group.chordIndex + 1) % 4;
      group.nextChordTime += group.barDuration;
      guard += 1;
    }
    if (!this.loop && !group.arcEndTime && group.scheduledChords >= ARC_CHORDS) {
      group.arcEndTime = group.nextChordTime + 1.6;
    }
  }

  scheduleChord(group, chordIndex, time) {
    const track = group.track;
    const progression = Array.isArray(track.chordProgression) && track.chordProgression.length
      ? track.chordProgression
      : [0, 5, 3, 4];
    const degree = progression[chordIndex % progression.length];
    const tones = chordTones(track, degree);
    const pad = leadVoicing(tones, group.previousPad);
    group.previousPad = pad;

    const panSpread = [-0.34, 0.04, 0.38];
    for (let index = 0; index < pad.length; index += 1) {
      this.spawnPad(group, pad[index], time, panSpread[index], index);
    }

    const bassRoot = scaleTone(track.root, track.mode, degree, -1);
    this.spawnTone(group, {
      midi: bassRoot,
      wave: 'sine',
      gain: 0.1,
      attack: 1.0,
      duration: group.barDuration * 1.08,
      release: 2.2,
      pan: 0,
      detune: 0,
      time
    });
    this.spawnTone(group, {
      midi: bassRoot,
      wave: 'triangle',
      gain: 0.035,
      attack: 1.2,
      duration: group.barDuration * 1.04,
      release: 2,
      pan: 0,
      detune: 4,
      time
    });

    const bells = clamp(Number(track.bells) || 0, 0, 1);
    if (bells > 0.12) {
      const count = (Number(track.density) || 0.2) > 0.3 ? 2 : 1;
      for (let index = 0; index < count; index += 1) {
        const note = clamp(pad[(index + chordIndex) % pad.length] + 12, 64, 88);
        const offset = index === 0 ? 0.05 : group.barDuration * 0.56;
        this.spawnChime(group, note, time + offset, index === 0 ? -0.58 : 0.62, bells);
      }
    }

    const air = clamp(Number(track.air) || 0, 0, 0.32);
    if (air > 0.045) this.spawnAir(group, time, air, chordIndex);
  }

  spawnPad(group, midi, time, pan, index) {
    const track = group.track;
    const wave = track.padWave === 'triangle' ? 'triangle' : 'sine';
    const duration = group.barDuration * 1.04;
    this.spawnTone(group, {
      midi,
      wave,
      gain: 0.036,
      attack: 1.55 + index * 0.12,
      duration,
      release: 2.9,
      pan,
      detune: -5 - index,
      time
    });
    this.spawnTone(group, {
      midi: midi + 12,
      wave,
      gain: 0.013,
      attack: 1.9 + index * 0.1,
      duration,
      release: 3.1,
      pan: -pan * 0.72,
      detune: 5 + index,
      time
    });
  }

  spawnChime(group, midi, time, pan, bells) {
    const track = group.track;
    const wave = track.chimeWave === 'triangle' ? 'triangle' : 'sine';
    this.spawnTone(group, {
      midi,
      wave,
      gain: 0.028 + bells * 0.035,
      attack: 0.012,
      duration: 0.7,
      release: 2.1,
      pan,
      detune: 0,
      time
    });
    this.spawnTone(group, {
      midi: midi + 12.03,
      wave: 'sine',
      gain: 0.008 + bells * 0.012,
      attack: 0.008,
      duration: 0.45,
      release: 1.5,
      pan: pan * 0.8,
      detune: 3,
      time
    });
  }

  spawnAir(group, time, air, chordIndex) {
    if (!this.context || !this.noiseBuffer) return;
    if (this.voiceCount >= MAX_VOICES) return;
    const context = this.context;
    const start = this.startTime(time);
    const duration = group.barDuration * 0.92;
    const release = 2.4;
    const end = start + duration + release;
    const source = context.createBufferSource();
    source.buffer = this.noiseBuffer;
    source.loop = true;
    const filter = context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = clamp(Number(group.track.brightness) * 0.5 || 900, 380, 1800);
    filter.Q.value = 0.72 + (chordIndex % 2) * 0.08;
    const gain = context.createGain();
    const peak = 0.02 + air * 0.11;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), start + 2.1);
    gain.gain.setValueAtTime(Math.max(0.0002, peak), start + duration);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    const panner = context.createStereoPanner ? context.createStereoPanner() : null;
    if (panner) panner.pan.value = chordIndex % 2 === 0 ? -0.44 : 0.44;
    source.connect(filter);
    filter.connect(gain);
    if (panner) {
      gain.connect(panner);
      panner.connect(group.input);
    } else {
      gain.connect(group.input);
    }
    source.start(start);
    source.stop(end + 0.05);

    const voice = {
      source,
      nodes: [source, filter, gain, panner].filter(Boolean),
      done: false
    };
    this.voiceCount += 1;
    group.voiceCount += 1;
    group.voices.add(voice);
    source.onended = () => this.completeVoice(group, voice);
  }

  spawnTone(group, options) {
    if (!this.context || !group || group.dead) return null;
    if (this.voiceCount >= MAX_VOICES) return null;
    const context = this.context;
    const start = this.startTime(options.time ?? this.context.currentTime);
    const duration = Math.max(0.05, options.duration || 1);
    const release = Math.max(0.05, options.release || 1);
    const end = start + duration + release + 0.08;
    const gainValue = Math.max(0.0002, options.gain || 0.01);

    const oscillator = context.createOscillator();
    oscillator.type = options.wave || 'sine';
    oscillator.frequency.setValueAtTime(midiToHz(options.midi), start);
    if (options.detune) oscillator.detune.value = options.detune;

    const amplifier = context.createGain();
    amplifier.gain.setValueAtTime(0.0001, start);
    amplifier.gain.exponentialRampToValueAtTime(gainValue, start + Math.max(0.01, options.attack || 0.2));
    amplifier.gain.setValueAtTime(gainValue, start + duration);
    amplifier.gain.exponentialRampToValueAtTime(0.0001, end);

    const panner = context.createStereoPanner ? context.createStereoPanner() : null;
    if (panner) panner.pan.value = clamp(Number(options.pan) || 0, -1, 1);

    oscillator.connect(amplifier);
    if (panner) {
      amplifier.connect(panner);
      panner.connect(group.input);
    } else {
      amplifier.connect(group.input);
    }

    oscillator.start(start);
    oscillator.stop(end + 0.02);

    const voice = {
      source: oscillator,
      nodes: [oscillator, amplifier, panner].filter(Boolean),
      done: false
    };
    this.voiceCount += 1;
    group.voiceCount += 1;
    group.voices.add(voice);
    oscillator.onended = () => this.completeVoice(group, voice);
    return voice;
  }

  startTime(time) {
    if (!this.context) return 0;
    return Math.max(Number(time) || 0, this.context.currentTime + 0.025);
  }

  completeVoice(group, voice) {
    if (!voice || voice.done) return;
    voice.done = true;
    this.voiceCount = Math.max(0, this.voiceCount - 1);
    if (group) group.voiceCount = Math.max(0, group.voiceCount - 1);
    if (group) group.voices.delete(voice);
    for (const node of voice.nodes) {
      try {
        node.disconnect();
      } catch (error) {
        /* already disconnected */
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Landing soundtrack                                                  */
  /* ------------------------------------------------------------------ */

  mountLanding(host, { navigate } = {}) {
    if (this.landing?.host && this.landing.host !== host) {
      this.landing.host.removeEventListener('click', this.onLandingClick);
    }
    this.landing = { host, navigate: typeof navigate === 'function' ? navigate : null };
    if (!host) return;
    host.removeEventListener('click', this.onLandingClick);
    host.addEventListener('click', this.onLandingClick);
    this.renderLanding();
  }

  renderLanding() {
    const host = this.landing?.host;
    if (!host) return;
    clear(host);

    const toggle = el('button', {
      class: 'soundtrack-play',
      type: 'button',
      'data-audio-landing-toggle': '',
      'aria-label': 'Play the chapter soundtrack'
    }, [icon('play'), equalizer('soundtrack-eq')]);

    const now = el('div', { class: 'soundtrack-now' }, [
      toggle,
      el('div', { class: 'soundtrack-now__copy' }, [
        el('span', { class: 'soundtrack-now__eyebrow', text: 'Now playing' }),
        el('strong', { class: 'soundtrack-now__title', 'data-audio-landing-title': '' }),
        el('span', { class: 'soundtrack-now__meta', 'data-audio-landing-meta': '' })
      ]),
      el('span', { class: 'soundtrack-now__state', 'data-audio-landing-state': '' })
    ]);

    const intro = el('div', { class: 'soundtrack-intro' }, [
      el('p', { class: 'eyebrow soundtrack-intro__eyebrow', text: 'A listening companion' }),
      el('h3', { class: 'soundtrack-intro__title' }, ['One palette for every ', el('em', { text: 'chapter' })]),
      el('p', {
        class: 'soundtrack-intro__lead',
        text: 'Twenty-one generative WebAudio movements, each tuned to the light of its chapter. Begin here, or start a chapter and let the reader carry the score with you.'
      }),
      el('div', { class: 'soundtrack-disc', 'aria-hidden': 'true' }, [
        el('span', { class: 'soundtrack-disc__label', text: '21 live cuts' })
      ]),
      now,
      el('p', { class: 'soundtrack-intro__note' }, [
        el('strong', { text: 'Synthesised in your browser. ' }),
        'No audio files, no downloads. Volume, mute and looping stay on this device.'
      ]),
      el('p', {
        class: 'soundtrack-unsupported',
        'data-audio-unsupported': '',
        hidden: true,
        text: 'This browser does not support WebAudio, so the soundtrack cannot start. Every chapter remains fully readable.'
      })
    ]);

    const tracks = el('div', { class: 'soundtrack-tracks' });
    for (const act of this.story.acts || []) {
      const group = el('section', {
        class: 'track-act',
        'aria-label': `${actLabel(act)} soundtrack`
      });
      group.append(el('header', { class: 'track-act__head' }, [
        el('span', { class: 'track-act__title', text: actLabel(act) }),
        el('span', { class: 'track-act__count', text: `${act.chapters.length} tracks` })
      ]));

      for (const chapter of act.chapters) {
        const track = chapter.track;
        if (!track) continue;
        const play = el('button', {
          class: 'track-row__play',
          type: 'button',
          'data-track-id': track.id,
          'aria-label': `Play Track ${pad2(track.number)}, ${track.title}, for Chapter ${chapter.number}`,
          'aria-pressed': 'false'
        }, [icon('play'), equalizer('track-row__eq')]);

        const link = el('a', {
          class: 'track-row__link',
          href: `#/read/${chapter.number}/0`,
          'aria-label': `Read Chapter ${chapter.number}: ${chapter.title}`
        }, ['Read chapter', icon('arrow')]);

        const row = el('article', {
          class: 'track-row',
          'data-track-row': track.id
        }, [
          play,
          el('span', { class: 'track-row__num', 'aria-hidden': 'true', text: pad2(track.number) }),
          el('span', { class: 'track-row__main' }, [
            el('span', { class: 'track-row__title', text: track.title }),
            el('span', { class: 'track-row__mood', text: track.mood })
          ]),
          el('span', { class: 'track-row__chapter' }, [
            el('span', { class: 'track-row__chapter-num', text: `Chapter ${chapter.number}` }),
            el('strong', { text: chapter.title })
          ]),
          el('span', { class: 'track-row__actions' }, [
            el('span', { class: 'track-row__status', text: 'Now playing' }),
            link
          ])
        ]);
        group.append(row);
      }
      tracks.append(group);
    }

    host.append(el('div', { class: 'soundtrack-panel' }, [intro, tracks]));
    this.syncLanding();
  }

  handleLandingClick(event) {
    const toggle = event.target.closest('[data-audio-landing-toggle]');
    if (toggle) {
      if (!this.supported) {
        this.speak('The soundtrack is unavailable in this browser.');
        return;
      }
      const track = this.currentTrack() || this.tracks[0];
      if (!track) return;
      if (this.activeTrackId === track.id) this.toggle();
      else this.playTrack(track.id);
      return;
    }

    const button = event.target.closest('[data-track-id]');
    if (!button) return;
    if (!this.supported) {
      this.speak('The soundtrack is unavailable in this browser.');
      return;
    }
    const trackId = button.dataset.trackId;
    if (this.activeTrackId === trackId) {
      if (this.isPlaying) this.pause();
      else this.play();
    } else {
      this.playTrack(trackId);
    }
  }

  syncLanding() {
    const host = this.landing?.host;
    if (!host) return;
    const state = this.getState();
    const track = this.currentTrack();
    const chapter = track ? this.chapterForTrack(track) : null;
    const panel = host.querySelector('.soundtrack-panel');
    panel?.classList.toggle('is-unsupported', !state.supported);

    const toggle = host.querySelector('[data-audio-landing-toggle]');
    if (toggle) {
      toggle.disabled = !state.supported;
      setIcon(toggle, state.isPlaying ? 'pause' : 'play');
      toggle.setAttribute('aria-label', state.isPlaying
        ? 'Pause the chapter soundtrack'
        : 'Play the chapter soundtrack');
      toggle.classList.toggle('is-playing', state.isPlaying);
    }

    const eq = host.querySelector('.soundtrack-eq');
    eq?.classList.toggle('is-live', state.isPlaying);

    const title = host.querySelector('[data-audio-landing-title]');
    const meta = host.querySelector('[data-audio-landing-meta]');
    const label = host.querySelector('[data-audio-landing-state]');
    if (!state.supported) {
      if (title) title.textContent = 'WebAudio unavailable';
      if (meta) meta.textContent = 'The archive is still fully readable.';
      if (label) label.textContent = 'Sound off';
    } else if (track) {
      if (title) title.textContent = track.title;
      if (meta && chapter) meta.textContent = `Chapter ${chapter.number} · ${chapter.title}`;
      if (label) label.textContent = state.isPlaying ? 'Playing' : 'Paused';
    } else {
      if (title) title.textContent = 'Choose a chapter';
      if (meta) meta.textContent = 'Twenty-one palettes, waiting for a first note.';
      if (label) label.textContent = 'Ready';
    }

    const unsupported = host.querySelector('[data-audio-unsupported]');
    if (unsupported) unsupported.hidden = state.supported;
    if (!state.supported) {
      for (const button of host.querySelectorAll('.track-row__play')) button.disabled = true;
    }

    for (const row of host.querySelectorAll('[data-track-row]')) {
      const active = row.dataset.trackRow === state.activeTrackId;
      row.classList.toggle('is-active', active);
      row.classList.toggle('is-playing', active && state.isPlaying);
      const button = row.querySelector('.track-row__play');
      if (button) {
        button.disabled = !state.supported;
        button.setAttribute('aria-pressed', String(active && state.isPlaying));
        setIcon(button, active && state.isPlaying ? 'pause' : 'play');
        const trackForRow = this.trackById.get(row.dataset.trackRow);
        const chapterForRow = trackForRow ? this.chapterForTrack(trackForRow) : null;
        if (trackForRow && chapterForRow) {
          button.setAttribute('aria-label', active && state.isPlaying
            ? `Pause Track ${pad2(trackForRow.number)}, ${trackForRow.title}`
            : `Play Track ${pad2(trackForRow.number)}, ${trackForRow.title}, for Chapter ${chapterForRow.number}`);
        }
      }
      const status = row.querySelector('.track-row__status');
      if (status) status.textContent = state.isPlaying ? 'Now playing' : 'Paused';
    }
  }

  /* ------------------------------------------------------------------ */
  /* Reader dock                                                         */
  /* ------------------------------------------------------------------ */

  mountDock(host) {
    if (!host) return;
    if (this.dock && this.dock !== host) this.dock.removeEventListener('click', this.onDockClick);
    this.dock = host;
    clear(host);
    host.classList.add('audio-bar');
    host.removeEventListener('click', this.onDockClick);

    const previous = el('button', {
      class: 'audio-bar__button audio-bar__step',
      type: 'button',
      'data-audio-action': 'previous',
      'aria-label': 'Previous track',
      title: 'Previous track'
    }, [icon('previous')]);

    const toggle = el('button', {
      class: 'audio-bar__button audio-bar__play',
      type: 'button',
      'data-audio-action': 'toggle',
      'aria-label': 'Play the chapter soundtrack'
    }, [icon('play')]);

    const next = el('button', {
      class: 'audio-bar__button audio-bar__step',
      type: 'button',
      'data-audio-action': 'next',
      'aria-label': 'Next track',
      title: 'Next track'
    }, [icon('next')]);

    const meta = el('div', { class: 'audio-bar__meta' }, [
      el('span', { class: 'audio-bar__eyebrow', text: 'Chapter soundtrack' }),
      el('strong', { class: 'audio-bar__title', 'data-audio-title': '', text: 'Soundtrack' }),
      el('span', { class: 'audio-bar__chapter', 'data-audio-chapter': '', text: 'Open a chapter to set the score' })
    ]);

    const mute = el('button', {
      class: 'audio-bar__button audio-bar__mute',
      type: 'button',
      'data-audio-action': 'mute',
      'aria-label': 'Mute soundtrack',
      'aria-pressed': 'false',
      title: 'Mute soundtrack'
    }, [icon('volume')]);

    const volume = el('input', {
      class: 'audio-bar__volume-range',
      type: 'range',
      min: '0',
      max: '100',
      step: '1',
      value: String(Math.round(this.volume * 100)),
      'data-audio-volume': '',
      'aria-label': 'Soundtrack volume'
    });

    const loop = el('button', {
      class: 'audio-bar__button audio-bar__loop',
      type: 'button',
      'data-audio-action': 'loop',
      'aria-label': 'Turn track looping off',
      'aria-pressed': String(this.loop),
      title: 'Loop track'
    }, [icon('loop')]);

    const list = el('button', {
      class: 'audio-bar__button audio-bar__tracks',
      type: 'button',
      'data-audio-action': 'tracks',
      'aria-label': 'Open the track list',
      'aria-expanded': 'false',
      'aria-controls': 'track-drawer',
      title: 'Track list'
    }, [icon('list'), el('span', { class: 'audio-bar__label', text: 'Tracks' })]);

    const inner = el('div', { class: 'audio-bar__inner' }, [
      el('div', { class: 'audio-bar__transport' }, [previous, toggle, next]),
      meta,
      el('div', { class: 'audio-bar__actions' }, [
        equalizer('audio-eq audio-bar__eq'),
        el('div', { class: 'audio-bar__volume' }, [mute, volume]),
        loop,
        list
      ])
    ]);

    host.append(inner);
    host.addEventListener('click', this.onDockClick);
    volume.addEventListener('input', () => this.setVolume(Number(volume.value) / 100));
    this.syncDock();
  }

  handleDockClick(event) {
    const button = event.target.closest('[data-audio-action]');
    if (!button) return;
    const action = button.dataset.audioAction;
    if (action === 'tracks') {
      this.toggleTrackDrawer();
      return;
    }
    if (!this.supported) {
      this.speak('The soundtrack is unavailable in this browser.');
      return;
    }
    if (action === 'toggle') this.toggle();
    else if (action === 'previous') this.previousTrack();
    else if (action === 'next') this.nextTrack();
    else if (action === 'mute') this.toggleMute();
    else if (action === 'loop') this.toggleLoop();
  }

  syncDock() {
    const host = this.dock;
    if (!host) return;
    const state = this.getState();
    const track = this.currentTrack();
    const chapter = track ? this.chapterForTrack(track) : null;

    host.classList.toggle('is-playing', state.isPlaying);
    host.classList.toggle('is-muted', state.muted);
    host.classList.toggle('is-unsupported', !state.supported);

    const title = host.querySelector('[data-audio-title]');
    const chapterNode = host.querySelector('[data-audio-chapter]');
    if (!state.supported) {
      if (title) title.textContent = 'Soundtrack unavailable';
      if (chapterNode) chapterNode.textContent = 'This browser does not support WebAudio';
    } else if (track) {
      if (title) title.textContent = `Track ${pad2(track.number)} · ${track.title}`;
      if (chapterNode && chapter) chapterNode.textContent = `Chapter ${chapter.number} · ${chapter.title}`;
    } else {
      if (title) title.textContent = 'Chapter soundtrack';
      if (chapterNode) chapterNode.textContent = 'Choose a chapter to set the score';
    }

    const toggle = host.querySelector('[data-audio-action="toggle"]');
    if (toggle) {
      toggle.disabled = !state.supported;
      toggle.setAttribute('aria-label', state.isPlaying ? 'Pause the chapter soundtrack' : 'Play the chapter soundtrack');
      toggle.setAttribute('aria-pressed', String(state.isPlaying));
      setIcon(toggle, state.isPlaying ? 'pause' : 'play');
    }

    const previous = host.querySelector('[data-audio-action="previous"]');
    const next = host.querySelector('[data-audio-action="next"]');
    for (const button of [previous, next]) {
      if (button) button.disabled = !state.supported || !track;
    }

    const mute = host.querySelector('[data-audio-action="mute"]');
    if (mute) {
      mute.disabled = !state.supported;
      mute.setAttribute('aria-pressed', String(state.muted));
      mute.setAttribute('aria-label', state.muted ? 'Unmute soundtrack' : 'Mute soundtrack');
      mute.title = state.muted ? 'Unmute soundtrack' : 'Mute soundtrack';
      setIcon(mute, state.muted ? 'muted' : 'volume');
    }

    const volume = host.querySelector('[data-audio-volume]');
    if (volume) {
      volume.disabled = !state.supported;
      volume.value = String(Math.round(state.volume * 100));
      volume.setAttribute('aria-valuetext', `${Math.round(state.volume * 100)} percent`);
    }

    const loop = host.querySelector('[data-audio-action="loop"]');
    if (loop) {
      loop.disabled = !state.supported;
      loop.setAttribute('aria-pressed', String(state.loop));
      loop.setAttribute('aria-label', state.loop ? 'Turn track looping off' : 'Turn track looping on');
      loop.classList.toggle('is-on', state.loop);
    }

    const list = host.querySelector('[data-audio-action="tracks"]');
    if (list) list.setAttribute('aria-expanded', String(this.drawerOpen));

    const eq = host.querySelector('.audio-bar__eq');
    eq?.classList.toggle('is-live', state.isPlaying);
  }

  /* ------------------------------------------------------------------ */
  /* Track list drawer                                                   */
  /* ------------------------------------------------------------------ */

  mountTrackDrawer(drawer = document.getElementById('track-drawer')) {
    if (!drawer) {
      const panel = el('aside', {
        class: 'drawer__panel',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 'track-drawer-title',
        tabindex: '-1'
      }, [
        el('header', { class: 'drawer__head' }, [
          el('div', {}, [
            el('p', { class: 'eyebrow', text: 'The soundtrack' }),
            el('h2', { class: 'display', id: 'track-drawer-title', text: 'All tracks' })
          ]),
          el('button', {
            class: 'reader-icon-button',
            id: 'track-drawer-close',
            type: 'button',
            'aria-label': 'Close track list',
            title: 'Close'
          }, [el('span', { 'aria-hidden': 'true', text: '×' })])
        ]),
        el('div', { class: 'drawer__body track-drawer__body', id: 'track-drawer-list' })
      ]);
      drawer = el('div', {
        id: 'track-drawer',
        class: 'drawer track-drawer',
        hidden: true
      }, [
        el('div', { class: 'drawer__backdrop', 'data-track-drawer-close': '' }),
        panel
      ]);
      document.body.append(drawer);
    }

    if (this.trackDrawer === drawer) {
      this.renderTrackDrawer();
      return;
    }

    this.trackDrawer = drawer;
    this.trackDrawerList = drawer.querySelector('#track-drawer-list');
    this.trackDrawerClose = drawer.querySelector('#track-drawer-close');
    this.trackDrawerPanel = drawer.querySelector('.drawer__panel');
    const backdrop = drawer.querySelector('[data-track-drawer-close]');

    this.trackDrawerClose?.addEventListener('click', () => this.closeTrackDrawer());
    backdrop?.addEventListener('click', () => this.closeTrackDrawer());
    this.trackDrawerList?.addEventListener('click', this.onDrawerClick);
    this.renderTrackDrawer();
  }

  renderTrackDrawer() {
    const list = this.trackDrawerList;
    if (!list) return;
    clear(list);

    for (const act of this.story.acts || []) {
      const section = el('section', { class: 'track-drawer__act' });
      section.append(el('header', { class: 'track-drawer__act-head' }, [
        el('span', { class: 'track-drawer__act-title', text: actLabel(act) }),
        el('span', { class: 'track-drawer__act-count', text: `${act.chapters.length} tracks` })
      ]));

      for (const chapter of act.chapters) {
        const track = chapter.track;
        if (!track) continue;
        const play = el('button', {
          class: 'track-drawer__play',
          type: 'button',
          'data-track-id': track.id,
          'aria-label': `Play Track ${pad2(track.number)}, ${track.title}`,
          'aria-pressed': 'false'
        }, [icon('play'), equalizer('track-drawer__eq')]);

        const link = el('a', {
          class: 'track-drawer__link',
          href: `#/read/${chapter.number}/0`,
          'data-track-drawer-link': '',
          'aria-label': `Go to Chapter ${chapter.number}: ${chapter.title}`
        }, [`Ch. ${chapter.number}`, icon('arrow')]);

        const row = el('div', {
          class: 'track-drawer__row',
          'data-track-row': track.id,
          'data-track-chapter': String(chapter.number)
        }, [
          play,
          el('span', { class: 'track-drawer__main' }, [
            el('span', { class: 'track-drawer__kicker' }, [
              el('span', { text: `Track ${pad2(track.number)}` }),
              el('span', { text: track.mood })
            ]),
            el('strong', { class: 'track-drawer__title', text: track.title }),
            el('span', { class: 'track-drawer__chapter', text: `Chapter ${chapter.number} · ${chapter.title}` })
          ]),
          el('span', { class: 'track-drawer__current', text: 'Playing' }),
          link
        ]);
        section.append(row);
      }
      list.append(section);
    }
    this.syncDrawer();
  }

  handleDrawerClick(event) {
    const link = event.target.closest('[data-track-drawer-link]');
    if (link) {
      this.closeTrackDrawer({ restoreFocus: false });
      return;
    }
    const button = event.target.closest('[data-track-id]');
    if (!button) return;
    if (!this.supported) {
      this.speak('The soundtrack is unavailable in this browser.');
      return;
    }
    const trackId = button.dataset.trackId;
    if (this.activeTrackId === trackId) {
      if (this.isPlaying) this.pause();
      else this.play();
    } else {
      this.playTrack(trackId);
    }
  }

  syncDrawer() {
    const list = this.trackDrawerList;
    if (!list) return;
    const state = this.getState();
    for (const row of list.querySelectorAll('[data-track-row]')) {
      const active = row.dataset.trackRow === state.activeTrackId;
      row.classList.toggle('is-active', active);
      row.classList.toggle('is-playing', active && state.isPlaying);
      const play = row.querySelector('.track-drawer__play');
      if (play) {
        play.disabled = !state.supported;
        play.setAttribute('aria-pressed', String(active && state.isPlaying));
        setIcon(play, active && state.isPlaying ? 'pause' : 'play');
      }
      const current = row.querySelector('.track-drawer__current');
      if (current) current.textContent = state.isPlaying ? 'Playing' : 'Active';
      const link = row.querySelector('[data-track-drawer-link]');
      if (link) {
        if (active) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
      }
    }
  }

  openTrackDrawer() {
    if (!this.trackDrawer || this.drawerOpen) return;
    this.drawerOpen = true;
    this.trackDrawer.hidden = false;
    this.dock?.querySelector('[data-audio-action="tracks"]')?.setAttribute('aria-expanded', 'true');
    if (!this.drawerTrap) {
      this.drawerTrap = createFocusTrap(this.trackDrawerPanel || this.trackDrawer, this.trackDrawerClose);
    }
    this.drawerTrap.activate();
    this.syncDrawer();
    const active = this.trackDrawerList?.querySelector('.is-active');
    if (active) {
      requestAnimationFrame(() => active.scrollIntoView({ block: 'center', behavior: 'auto' }));
    }
  }

  closeTrackDrawer({ restoreFocus = true } = {}) {
    if (!this.drawerOpen) return;
    this.drawerOpen = false;
    if (this.trackDrawer) this.trackDrawer.hidden = true;
    this.dock?.querySelector('[data-audio-action="tracks"]')?.setAttribute('aria-expanded', 'false');
    if (this.drawerTrap) {
      const trap = this.drawerTrap;
      this.drawerTrap = null;
      trap.deactivate({ restoreFocus });
    }
  }

  toggleTrackDrawer() {
    if (this.drawerOpen) this.closeTrackDrawer();
    else this.openTrackDrawer();
  }

  handleGlobalKeydown(event) {
    if (!this.drawerOpen) return;
    if (event.key === 'Tab') return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.closeTrackDrawer();
      return;
    }
    event.stopImmediatePropagation();
  }

  /* ------------------------------------------------------------------ */
  /* Lifecycle                                                           */
  /* ------------------------------------------------------------------ */

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.closeTrackDrawer({ restoreFocus: false });
    window.clearInterval(this.schedulerTimer);
    window.clearTimeout(this.suspendTimer);
    document.removeEventListener('keydown', this.onDocumentKeydown, true);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    window.removeEventListener('pagehide', this.onPageHide);
    this.landing?.host?.removeEventListener('click', this.onLandingClick);
    this.dock?.removeEventListener('click', this.onDockClick);
    this.trackDrawerList?.removeEventListener('click', this.onDrawerClick);
    this.disposeGroups();
    this.listeners.clear();
    if (this.context && this.context.state !== 'closed') {
      this.context.close().catch(() => {});
    }
    this.context = null;
    this.playingGroup = null;
    this.isPlaying = false;
  }
}

export function createAudio(story, options = {}) {
  return new AudioDirector(story, options);
}
