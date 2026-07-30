/* ============================================================================
   Headless test harness for the family arcade.

   Stubs just enough of a browser that a game's real loop can be driven from
   Node, then pumps frames by hand. No dependencies, no build step — run it
   with plain `node`.

     const { createHarness } = require('./harness');
     const h = createHarness('oliver-run');
     h.tap();                 // start the game
     h.frames(600);           // pump 600 frames of the real update+render
     h.text('score');         // read the score straight off the stub DOM

   Works for any folder under games/: the loader walks the game's <script>
   tags in order, evals `src=` ones off disk (that's how shared/kidkit.js
   gets in) and evals the inline one. Nothing is game-specific in here.

   Gotchas this file exists to remember, all of them learned the hard way:

   - Node has a built-in read-only `navigator`. A plain `global.navigator = {}`
     silently does nothing and every gamepad mock sees zero pads. It has to go
     in via Object.defineProperty.
   - `ctx` is a Proxy of no-ops, but createLinearGradient / createRadialGradient
     must return something with addColorStop or the sky never draws.
   - setInterval callbacks are collected and run off a virtual clock — that's
     what drives the music scheduler, and it's the only reason the chiptune
     code gets exercised at all.
   - Time is virtual. setTimeout(…, 1500) inside saveBest() will not fire
     unless frames are pumped past it, which is exactly what makes the
     high-score persistence test meaningful.
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const GAMES_DIR = path.join(ROOT, 'games');
const FRAME_MS = 1000 / 60;

/* ---------------------------------------------------------------- *
 * deterministic RNG — same seed, same run, so failures reproduce
 * ---------------------------------------------------------------- */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------------------------------------------------------------- *
 * element stub
 * ---------------------------------------------------------------- */
class StubElement {
  constructor(id, tagName, attrs) {
    this.id = id || '';
    this.tagName = (tagName || 'DIV').toUpperCase();
    this.textContent = '';
    this.innerHTML = '';
    this.hidden = false;
    this.disabled = false;
    this.value = '';
    this.style = new Proxy({}, {
      get(t, k) {
        if (k === 'setProperty') return (n, v) => { t[n] = v; };
        if (k === 'removeProperty') return n => { delete t[n]; };
        return k in t ? t[k] : '';
      },
      set(t, k, v) { t[k] = v; return true; },
    });
    this.classList = makeClassList(attrs && attrs.class);
    this.attributes = Object.assign({}, attrs);
    this.children = [];
    this.offsetParent = {};          // moveFocus() treats null as "hidden"
    this._listeners = new Map();
    this._doc = null;
  }

  addEventListener(type, fn) {
    if (typeof fn !== 'function') return;
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push(fn);
  }
  removeEventListener(type, fn) {
    const l = this._listeners.get(type);
    if (!l) return;
    const i = l.indexOf(fn);
    if (i >= 0) l.splice(i, 1);
  }
  dispatchEvent(ev) {
    ev.target = ev.target || this;
    ev.currentTarget = this;
    const l = this._listeners.get(ev.type);
    if (l) for (const fn of l.slice()) fn.call(this, ev);
    return !ev.defaultPrevented;
  }

  click() { this.dispatchEvent(makeEvent('click', this)); }
  focus() { if (this._doc) this._doc.activeElement = this; }
  blur() { if (this._doc && this._doc.activeElement === this) this._doc.activeElement = null; }

  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; }
  removeAttribute(k) { delete this.attributes[k]; }
  hasAttribute(k) { return k in this.attributes; }

  /* Selector support is deliberately shallow: the only selectors the kit
     actually uses are a tag-name list and 'button:not([disabled])'. */
  closest(sel) {
    const tags = sel.split(',').map(s => s.trim().toUpperCase());
    return tags.includes(this.tagName) ? this : null;
  }
  querySelectorAll(sel) {
    if (!this._doc) return [];
    const wantButton = /button/i.test(sel);
    const noDisabled = /:not\(\[disabled\]\)/.test(sel);
    return this._doc.allElements().filter(e =>
      (!wantButton || e.tagName === 'BUTTON') && (!noDisabled || !e.disabled));
  }
  getClientRects() { return [{ width: 10, height: 10 }]; }
  getBoundingClientRect() { return { x: 0, y: 0, top: 0, left: 0, right: 10, bottom: 10, width: 10, height: 10 }; }
  appendChild(c) { this.children.push(c); return c; }
  removeChild(c) {
    const i = this.children.indexOf(c);
    if (i >= 0) this.children.splice(i, 1);
    return c;
  }
}

function makeClassList(initial) {
  const set = new Set(String(initial || '').split(/\s+/).filter(Boolean));
  return {
    add: (...c) => c.forEach(x => set.add(x)),
    remove: (...c) => c.forEach(x => set.delete(x)),
    contains: c => set.has(c),
    toggle: (c, force) => {
      const on = force === undefined ? !set.has(c) : !!force;
      if (on) set.add(c); else set.delete(c);
      return on;
    },
    get length() { return set.size; },
    toString: () => [...set].join(' '),
    _set: set,
  };
}

function makeEvent(type, target, extra) {
  const ev = {
    type,
    target: target || null,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() {},
    stopImmediatePropagation() {},
  };
  return Object.assign(ev, extra);
}

/* ---------------------------------------------------------------- *
 * canvas 2D context
 * ---------------------------------------------------------------- */
function makeGradient() {
  return { addColorStop() {}, _gradient: true };
}

function makeCtx(canvas) {
  const noop = function () {};
  const store = {
    canvas,
    fillStyle: '#000', strokeStyle: '#000',
    globalAlpha: 1, globalCompositeOperation: 'source-over',
    lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', miterLimit: 10,
    lineDashOffset: 0, font: '10px sans-serif',
    textAlign: 'start', textBaseline: 'alphabetic', direction: 'ltr',
    shadowBlur: 0, shadowColor: 'rgba(0,0,0,0)', shadowOffsetX: 0, shadowOffsetY: 0,
    filter: 'none', imageSmoothingEnabled: true, imageSmoothingQuality: 'low',
  };
  const special = {
    createLinearGradient: makeGradient,
    createRadialGradient: makeGradient,
    createConicGradient: makeGradient,
    createPattern: () => ({ setTransform() {} }),
    measureText: text => ({
      width: String(text == null ? '' : text).length * 8,
      actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2,
      actualBoundingBoxLeft: 0, actualBoundingBoxRight: String(text || '').length * 8,
    }),
    getImageData: (x, y, w, h) => ({
      width: w | 0, height: h | 0,
      data: new Uint8ClampedArray(Math.max(0, (w | 0) * (h | 0) * 4)),
    }),
    createImageData: (w, h) => ({
      width: w | 0, height: h | 0,
      data: new Uint8ClampedArray(Math.max(0, (w | 0) * (h | 0) * 4)),
    }),
    getLineDash: () => [],
    isPointInPath: () => false,
    isPointInStroke: () => false,
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
  };
  return new Proxy(store, {
    get(t, k) {
      if (k in t) return t[k];
      if (k in special) return special[k];
      if (typeof k === 'symbol') return undefined;
      // Unknown member: hand back a cached no-op so drawing code just runs.
      t[k] = noop;
      return noop;
    },
    set(t, k, v) { t[k] = v; return true; },
    has() { return true; },
  });
}

/* ---------------------------------------------------------------- *
 * WebAudio
 * ---------------------------------------------------------------- */
function makeAudioParam(v) {
  const p = {
    value: v == null ? 0 : v,
    setValueAtTime() { return p; },
    linearRampToValueAtTime() { return p; },
    exponentialRampToValueAtTime() { return p; },
    setTargetAtTime() { return p; },
    setValueCurveAtTime() { return p; },
    cancelScheduledValues() { return p; },
    cancelAndHoldAtTime() { return p; },
  };
  return p;
}

function makeAudioContext(clock, stats) {
  const node = extra => Object.assign({
    connect() { return this; },
    disconnect() {},
  }, extra);

  const ctx = {
    sampleRate: 44100,
    state: 'running',
    get currentTime() { return clock.now / 1000; },
    destination: node({}),
    resume() { ctx.state = 'running'; return Promise.resolve(); },
    suspend() { ctx.state = 'suspended'; return Promise.resolve(); },
    close() { ctx.state = 'closed'; return Promise.resolve(); },
    createGain: () => node({ gain: makeAudioParam(1) }),
    createOscillator: () => {
      stats.oscillators++;
      return node({
        type: 'sine',
        frequency: makeAudioParam(440),
        detune: makeAudioParam(0),
        start() {}, stop() {},
        onended: null,
      });
    },
    createBufferSource: () => {
      stats.sources++;
      return node({ buffer: null, playbackRate: makeAudioParam(1), loop: false, start() {}, stop() {} });
    },
    createBuffer: (channels, length, rate) => ({
      numberOfChannels: channels, length, sampleRate: rate,
      duration: length / rate,
      getChannelData: () => new Float32Array(Math.max(0, length | 0)),
    }),
    createBiquadFilter: () => node({
      type: 'lowpass',
      frequency: makeAudioParam(350),
      Q: makeAudioParam(1),
      gain: makeAudioParam(0),
      detune: makeAudioParam(0),
    }),
    createDynamicsCompressor: () => node({
      threshold: makeAudioParam(-24), knee: makeAudioParam(30), ratio: makeAudioParam(12),
      attack: makeAudioParam(0.003), release: makeAudioParam(0.25),
    }),
    createStereoPanner: () => node({ pan: makeAudioParam(0) }),
    createDelay: () => node({ delayTime: makeAudioParam(0) }),
    createConvolver: () => node({ buffer: null }),
    createWaveShaper: () => node({ curve: null }),
    createAnalyser: () => node({ fftSize: 2048, frequencyBinCount: 1024 }),
    addEventListener() {}, removeEventListener() {},
  };
  return ctx;
}

/* ---------------------------------------------------------------- *
 * gamepad
 * ---------------------------------------------------------------- */
const PAD_BUTTONS = {
  a: 0, b: 1, x: 2, y: 3,
  lb: 4, rb: 5, lt: 6, rt: 7,
  select: 8, start: 9, l3: 10, r3: 11,
  up: 12, down: 13, left: 14, right: 15, home: 16,
};

function makePad(index) {
  return {
    index,
    id: 'Harness Test Pad (STANDARD GAMEPAD)',
    connected: true,
    mapping: 'standard',
    timestamp: 0,
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
    axes: [0, 0, 0, 0],
  };
}

/* ---------------------------------------------------------------- *
 * script extraction
 * ---------------------------------------------------------------- */
const SCRIPT_RE = /<script([^>]*)>([\s\S]*?)<\/script>/gi;

/* Returns the game's <script> tags in document order. Each is either
   {kind:'src', file} or {kind:'inline', code, line}. */
function extractScripts(html, gameDir) {
  const out = [];
  let m;
  SCRIPT_RE.lastIndex = 0;
  while ((m = SCRIPT_RE.exec(html)) !== null) {
    const attrs = m[1] || '';
    const srcMatch = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(attrs);
    if (srcMatch) {
      const src = srcMatch[1];
      if (/^(https?:)?\/\//i.test(src)) continue;   // no network in tests
      out.push({ kind: 'src', file: path.resolve(gameDir, src), tag: src });
    } else {
      const body = m[2];
      if (!body.trim()) continue;
      // line number of the first line of script body, for honest stack traces
      const before = html.slice(0, m.index + m[0].indexOf('>') + 1);
      out.push({ kind: 'inline', code: body, line: before.split('\n').length - 1 });
    }
  }
  return out;
}

/* Scan the markup so stub elements get the right tagName. Without this,
   activateFocused() never fires because nothing reports as a BUTTON. */
function scanElements(html) {
  const map = new Map();
  const re = /<([a-zA-Z][\w-]*)\b([^>]*)>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const tag = m[1];
    const attrs = m[2] || '';
    const idm = /\bid\s*=\s*["']([^"']+)["']/.exec(attrs);
    if (!idm) continue;
    const parsed = {};
    const are = /([a-zA-Z-]+)(?:\s*=\s*["']([^"']*)["'])?/g;
    let a;
    while ((a = are.exec(attrs)) !== null) parsed[a[1]] = a[2] === undefined ? '' : a[2];
    map.set(idm[1], { tag, attrs: parsed });
  }
  return map;
}

/* Every live harness, oldest first. A test that throws part-way through
   never gets to clean up after itself, and the next test would then inherit
   half-stubbed globals and fail for the wrong reason — so the runner can
   just call disposeAll() and know the slate is clean. */
const live = [];

function disposeAll() {
  while (live.length) live[live.length - 1].dispose();
}

/* ---------------------------------------------------------------- *
 * the harness
 * ---------------------------------------------------------------- */
function createHarness(gameName, options) {
  const opts = options || {};
  const gameDir = path.join(GAMES_DIR, gameName);
  const indexPath = path.join(gameDir, 'index.html');
  if (!fs.existsSync(indexPath)) {
    throw new Error(`no such game: ${gameName} (looked for ${indexPath})`);
  }
  const html = fs.readFileSync(indexPath, 'utf8');
  const knownEls = scanElements(html);

  const clock = { now: 0 };
  const store = opts.store || {};           // survives reload()
  const audioStats = { oscillators: 0, sources: 0 };

  /* ---- timers -------------------------------------------------- */
  let timerId = 1;
  const timers = new Map();
  const intervals = [];                     // kept for introspection

  function setTimeoutStub(fn, delay) {
    const id = timerId++;
    timers.set(id, { fn, at: clock.now + (delay || 0), every: null, args: [].slice.call(arguments, 2) });
    return id;
  }
  function setIntervalStub(fn, delay) {
    const id = timerId++;
    const every = Math.max(1, delay || 0);
    const rec = { fn, at: clock.now + every, every, args: [].slice.call(arguments, 2) };
    timers.set(id, rec);
    intervals.push(rec);
    return id;
  }
  function clearTimerStub(id) { timers.delete(id); }

  function runDueTimers() {
    let guard = 0;
    for (;;) {
      let due = null, dueId = -1;
      for (const [id, t] of timers) {
        if (t.at <= clock.now && (due === null || t.at < due.at)) { due = t; dueId = id; }
      }
      if (!due) break;
      if (++guard > 10000) throw new Error('timer storm: >10000 callbacks in one frame');
      if (due.every === null) timers.delete(dueId);
      else due.at = clock.now + due.every;
      due.fn.apply(null, due.args);
    }
  }

  /* ---- storage ------------------------------------------------- */
  const localStorageStub = {
    getItem: k => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    key: i => Object.keys(store)[i] ?? null,
    get length() { return Object.keys(store).length; },
  };

  /* ---- document ------------------------------------------------ */
  const elements = new Map();
  const doc = {
    hidden: false,
    activeElement: null,
    fullscreenElement: null,
    _listeners: new Map(),
    allElements: () => [...elements.values()],
    getElementById(id) {
      if (elements.has(id)) return elements.get(id);
      const known = knownEls.get(id);
      const e = new StubElement(id, known ? known.tag : 'div', known ? known.attrs : null);
      e._doc = doc;
      if (known && 'hidden' in known.attrs) e.hidden = true;
      if (e.tagName === 'CANVAS') {
        e.width = 900; e.height = 450;
        const c = makeCtx(e);
        e.getContext = () => c;
      }
      elements.set(id, e);
      return e;
    },
    createElement(tag) {
      const e = new StubElement('', tag, null);
      e._doc = doc;
      if (String(tag).toUpperCase() === 'CANVAS') {
        e.width = 300; e.height = 150;
        const c = makeCtx(e);
        e.getContext = () => c;
      }
      return e;
    },
    querySelectorAll(sel) { return StubElement.prototype.querySelectorAll.call({ _doc: doc }, sel); },
    querySelector(sel) { return doc.querySelectorAll(sel)[0] || null; },
    addEventListener(type, fn) {
      if (typeof fn !== 'function') return;
      if (!doc._listeners.has(type)) doc._listeners.set(type, []);
      doc._listeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const l = doc._listeners.get(type);
      if (!l) return;
      const i = l.indexOf(fn);
      if (i >= 0) l.splice(i, 1);
    },
    dispatchEvent(ev) {
      const l = doc._listeners.get(ev.type);
      if (l) for (const fn of l.slice()) fn.call(doc, ev);
      return true;
    },
    exitFullscreen() { doc.fullscreenElement = null; return Promise.resolve(); },
  };
  doc.body = new StubElement('', 'body', null);
  doc.body._doc = doc;
  doc.documentElement = new StubElement('', 'html', null);
  doc.documentElement._doc = doc;
  doc.documentElement.requestFullscreen = () => {
    doc.fullscreenElement = doc.documentElement;
    return Promise.resolve();
  };

  /* ---- window / global ----------------------------------------- */
  const winListeners = new Map();
  function winAdd(type, fn) {
    if (typeof fn !== 'function') return;
    if (!winListeners.has(type)) winListeners.set(type, []);
    winListeners.get(type).push(fn);
  }
  function winRemove(type, fn) {
    const l = winListeners.get(type);
    if (!l) return;
    const i = l.indexOf(fn);
    if (i >= 0) l.splice(i, 1);
  }
  function winDispatch(ev) {
    const l = winListeners.get(ev.type);
    if (l) for (const fn of l.slice()) fn.call(global, ev);
    return true;
  }

  /* ---- animation frames ---------------------------------------- */
  let pendingFrame = null;
  let rafId = 1;
  function requestAnimationFrameStub(cb) { pendingFrame = cb; return rafId++; }
  function cancelAnimationFrameStub() { pendingFrame = null; }

  /* ---- gamepads ------------------------------------------------ */
  const pads = opts.gamepad === false ? [] : [makePad(0)];
  function getGamepads() { return pads.length ? [pads[0], null, null, null] : [null, null, null, null]; }

  /* ---- RNG ----------------------------------------------------- */
  /* A busy frame legitimately burns ~14k draws when a boss explodes, so the
     ceiling sits far above that. Its only job is to turn a spun-out loop
     into a failed test instead of a run that hangs until someone notices. */
  const RANDOM_BUDGET = opts.randomBudget || 2000000;
  const baseRandom = mulberry32(opts.seed == null ? 0xC0FFEE : opts.seed);
  let randomHook = null;
  let randomCalls = 0;
  function random() {
    if (++randomCalls > RANDOM_BUDGET) {
      throw new Error(
        `runaway RNG: over ${RANDOM_BUDGET} Math.random() calls in one frame ` +
        `(frame ${frameCount}). This is what a rejection-sampling loop looks ` +
        `like when the RNG is biased — see setRandomHook/bucket.`);
    }
    const v = baseRandom();
    return randomHook ? randomHook(v) : v;
  }

  /* ---- install globals ----------------------------------------- */
  const saved = {};
  function put(name, value) {
    saved[name] = Object.getOwnPropertyDescriptor(global, name);
    Object.defineProperty(global, name, { value, writable: true, configurable: true });
  }

  function install() {
    // Node's built-in navigator is read-only; a plain assignment is a no-op
    // and every gamepad mock silently sees zero pads. This is the fix.
    put('navigator', {
      userAgent: 'harness',
      getGamepads,
      audioSession: {},
      wakeLock: { request: () => Promise.resolve({ release() {}, addEventListener() {} }) },
    });
    put('document', doc);
    put('localStorage', localStorageStub);
    put('sessionStorage', localStorageStub);
    put('AudioContext', function AudioContextStub() { return makeAudioContext(clock, audioStats); });
    put('webkitAudioContext', global.AudioContext);
    put('requestAnimationFrame', requestAnimationFrameStub);
    put('cancelAnimationFrame', cancelAnimationFrameStub);
    put('setTimeout', setTimeoutStub);
    put('setInterval', setIntervalStub);
    put('clearTimeout', clearTimerStub);
    put('clearInterval', clearTimerStub);
    put('performance', { now: () => clock.now });
    put('devicePixelRatio', 1);
    put('addEventListener', winAdd);
    put('removeEventListener', winRemove);
    put('dispatchEvent', winDispatch);
    put('history', { pushState() {}, replaceState() {}, back() {}, go() {}, state: null });
    put('location', { href: 'http://localhost/games/' + gameName + '/index.html', origin: 'http://localhost', reload() {} });
    put('matchMedia', q => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
    put('getComputedStyle', () => new Proxy({}, { get: () => '' }));
    put('innerWidth', 900);
    put('innerHeight', 450);
    put('alert', () => {});
    put('window', global);
    saved.__mathRandom = Math.random;
    Math.random = random;
  }

  function uninstall() {
    for (const name of Object.keys(saved)) {
      if (name === '__mathRandom') { Math.random = saved.__mathRandom; continue; }
      const d = saved[name];
      if (d) Object.defineProperty(global, name, d);
      else delete global[name];
    }
  }

  install();

  /* ---- load the game ------------------------------------------- */
  const scripts = extractScripts(html, gameDir);
  const loaded = [];
  for (const s of scripts) {
    if (s.kind === 'src') {
      if (!fs.existsSync(s.file)) throw new Error(`<script src="${s.tag}"> not found at ${s.file}`);
      const code = fs.readFileSync(s.file, 'utf8');
      vm.runInThisContext(code, { filename: path.relative(ROOT, s.file).replace(/\\/g, '/') });
      loaded.push(path.relative(ROOT, s.file).replace(/\\/g, '/'));
    } else {
      const name = path.relative(ROOT, indexPath).replace(/\\/g, '/');
      vm.runInThisContext(s.code, { filename: name, lineOffset: s.line });
      loaded.push(`${name} (inline, from line ${s.line + 1})`);
    }
  }

  /* ---- frame pumping ------------------------------------------- */
  let frameCount = 0;
  let heldJump = false;

  /* A press has to be down for exactly one poll() to read as an edge: hold it
     across the coming frame, then let go once that frame has been polled.
     Holding it longer is what a real stuck button looks like — one jump. */
  let pendingRelease = [];

  function step() {
    clock.now += FRAME_MS;
    randomCalls = 0;
    runDueTimers();
    if (heldJump && frameCount % 2 === 0) pressPadButton('a');
    const cb = pendingFrame;
    pendingFrame = null;
    if (cb) cb(clock.now);
    frameCount++;
    if (pendingRelease.length) {
      for (const release of pendingRelease) release();
      pendingRelease = [];
    }
  }

  function pressPadButton(name) {
    if (!pads.length) return;
    const i = typeof name === 'number' ? name : PAD_BUTTONS[name];
    if (i == null) throw new Error(`unknown gamepad button: ${name}`);
    const b = pads[0].buttons[i];
    b.pressed = true; b.value = 1; b.touched = true;
    pads[0].timestamp = clock.now;
    pendingRelease.push(() => { b.pressed = false; b.value = 0; b.touched = false; });
  }

  const api = {
    game: gameName,
    dir: gameDir,
    loaded,
    store,
    audioStats,
    get frameCount() { return frameCount; },
    get now() { return clock.now; },
    get timerCount() { return timers.size; },

    /* --- driving --- */
    frames(n, each) {
      for (let i = 0; i < n; i++) {
        step();
        if (each) each(i, api);
      }
      return api;
    },
    /* Pump until pred() is truthy. Returns frames used; throws on timeout. */
    until(pred, max, label) {
      const cap = max || 20000;
      for (let i = 0; i < cap; i++) {
        if (pred(api)) return i;
        api.frames(1);
      }
      throw new Error(`timed out after ${cap} frames waiting for ${label || 'condition'}`);
    },
    holdJump(on) { heldJump = !!on; return api; },

    /* --- input --- */
    tap(id) {
      const el = doc.getElementById(id || 'stage');
      el.dispatchEvent(makeEvent('pointerdown', el, { pointerId: 1, button: 0 }));
      return api;
    },
    click(id) { doc.getElementById(id).click(); return api; },
    key(k) {
      winDispatch(makeEvent('keydown', doc.body, { key: k, code: k, repeat: false }));
      return api;
    },
    /* Queue a press for the next frame; the caller pumps it. */
    pad(button) { pressPadButton(button); return api; },
    /* Press, let one frame poll it, then one clear frame so the next
       press reads as a fresh edge. */
    padPress(button) { pressPadButton(button); step(); step(); return api; },
    connectPad() {
      winDispatch(makeEvent('gamepadconnected', null, { gamepad: pads[0] }));
      return api;
    },
    padCount: () => pads.length,

    /* --- reading --- */
    el: id => doc.getElementById(id),
    text: id => String(doc.getElementById(id).textContent),
    num(id) {
      const n = parseFloat(String(doc.getElementById(id).textContent).replace(/[^\d.\-]/g, ''));
      return isFinite(n) ? n : 0;
    },
    hidden: id => !!doc.getElementById(id).hidden,
    styleOf: (id, prop) => doc.getElementById(id).style[prop],
    hasClass: (id, c) => doc.getElementById(id).classList.contains(c),
    document: doc,

    /* --- RNG control --- */
    setRandomHook(fn) { randomHook = fn; return api; },
    /* Force every Math.floor(random()*n) to land on `k`, while leaving the
       value varying inside its bucket. Used to make a specific power-up come
       up on demand instead of waiting on chance.

       CAUTION: this biases the whole stream, not one draw, so any rejection
       sampling in the game can no longer escape. oliver-run has exactly one
       such loop — the "pick a different backdrop" retry at index.html:894,
       which only runs in Boss Rush — so keep bucket() to adventure mode.
       If you get it wrong the RANDOM_BUDGET guard fails the test rather than
       letting it hang. */
    bucket(k, n) {
      randomHook = v => (k + v) / n;
      return api;
    },
    unbucket() { randomHook = null; return api; },

    /* --- lifecycle --- */
    reload(extra) {
      api.dispose();
      return createHarness(gameName, Object.assign({}, opts, extra, { store }));
    },
    dispose() {
      const i = live.indexOf(api);
      if (i === -1) return;              // already disposed
      live.splice(i, 1);
      uninstall();
    },
  };

  live.push(api);
  return api;
}

module.exports = { createHarness, disposeAll, PAD_BUTTONS, GAMES_DIR, FRAME_MS };
