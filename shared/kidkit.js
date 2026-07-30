/* ============================================================================
   KidKit — shared bits for the family arcade.
   Drop-in, no build step, no dependencies. Include it before your game:

     <script src="../../shared/kidkit.js"></script>

   What it gives you:
     KidKit.storage           save/load that works everywhere
     KidKit.input.create()    touch + mouse + keyboard + GAMEPAD, one handler
     KidKit.input.create({steer:true})
                              …plus held/analog steering: .axis() and .pointer()
     KidKit.audio             unlock-safe WebAudio, blips, noise
     KidKit.audio.music()     chiptune loop player
     KidKit.kidLock()         fullscreen / no-accidental-exit lock
     KidKit.version
   ========================================================================== */
(function (global) {
  'use strict';

  var KidKit = { version: '1.2.0' };

  /* ------------------------------------------------------------------ *
   * storage — localStorage, falling back to memory if it's unavailable
   * (private browsing, file:// on some browsers, TV browsers, etc.)
   * ------------------------------------------------------------------ */
  var mem = {};
  var lsOK = (function () {
    try { localStorage.setItem('__kk', '1'); localStorage.removeItem('__kk'); return true; }
    catch (e) { return false; }
  })();

  KidKit.storage = {
    available: lsOK,
    get: function (key, fallback) {
      try {
        if (lsOK) { var v = localStorage.getItem(key); return v === null ? fallback : v; }
      } catch (e) {}
      return (key in mem) ? mem[key] : fallback;
    },
    set: function (key, val) {
      var s = String(val);
      mem[key] = s;
      try { if (lsOK) localStorage.setItem(key, s); } catch (e) {}
    },
    getNumber: function (key, fallback) {
      var n = parseFloat(KidKit.storage.get(key, ''));
      return isFinite(n) ? n : fallback;
    },
    getJSON: function (key, fallback) {
      try { var v = JSON.parse(KidKit.storage.get(key, 'null')); return v === null ? fallback : v; }
      catch (e) { return fallback; }
    },
    setJSON: function (key, obj) {
      try { KidKit.storage.set(key, JSON.stringify(obj)); } catch (e) {}
    },
    remove: function (key) {
      delete mem[key];
      try { if (lsOK) localStorage.removeItem(key); } catch (e) {}
    }
  };

  /* ------------------------------------------------------------------ *
   * input — one place for every way a kid might press "go"
   *   onPress(source)  primary action (jump / confirm)
   *   onAction(source) secondary action (X / Y on a pad, or your own key)
   *   onNav(dir)       'left' 'right' 'up' 'down' — for TV remote menus
   *   onPause(source)  Start / Escape
   * Call .poll() once per animation frame so gamepads get read.
   * ------------------------------------------------------------------ */
  var IGNORE_KEYS = {
    Tab: 1, Shift: 1, Control: 1, Alt: 1, Meta: 1, CapsLock: 1,
    F1: 1, F5: 1, F11: 1, F12: 1, ContextMenu: 1, Dead: 1
  };
  var NAV_KEYS = {
    ArrowLeft: 'left', ArrowRight: 'right', ArrowDown: 'down',
    Left: 'left', Right: 'right', Down: 'down'
  };

  /* Held-direction keys, for games that steer instead of jump. Arrows and
     WASD both, and both cases of the letters — a five-year-old leaves caps
     lock on for weeks at a time. */
  var STEER_KEYS = {
    ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
    Left: [-1, 0], Right: [1, 0], Up: [0, -1], Down: [0, 1],
    a: [-1, 0], d: [1, 0], w: [0, -1], s: [0, 1],
    A: [-1, 0], D: [1, 0], W: [0, -1], S: [0, 1]
  };

  // standard gamepad mapping
  var BTN_X = 2, BTN_Y = 3, BTN_SELECT = 8, BTN_START = 9;
  var BTN_UP = 12, BTN_DOWN = 13, BTN_LEFT = 14, BTN_RIGHT = 15;
  var AXIS = 0.55;
  var STICK_DEAD = 0.22;             // generous: cheap pads drift a long way

  KidKit.input = {
    create: function (opts) {
      opts = opts || {};
      var el       = opts.element || global.document.body;
      var onPress  = opts.onPress  || function () {};
      var onAction = opts.onAction || function () {};
      var onNav    = opts.onNav    || function () {};
      var onPause  = opts.onPause  || function () {};
      var padState = {};
      var padsLive = 0;
      var lastSource = 'touch';
      // Set true by releaseAll('blur'). A pad that already existed in
      // padState gets latched via the loop below, but a pad poll() has never
      // seen yet gets no entry to latch — this flag is the initial value
      // handed to any padState entry created AFTER a blur, so a pad
      // discovered for the first time post-blur (reconnected, or simply
      // never polled before blur) still starts suppressed instead of
      // reporting held straight from its first observation. Never reset:
      // a newly discovered pad that is quiet on its very first poll clears
      // its own suppression on that same poll (see the per-pad clearing
      // logic below), so leaving this latched costs nothing.
      var suppressNewPads = false;

      var onHold   = opts.onHold || function () {};
      var keysDown = {};
      var pointerHeld = false, padHeld = false, wasHeld = false;
      // Suppression is latched per pad (on padState[p.index].suppressed), not
      // globally: with two controllers, a stale held button on pad A must not
      // block pad B's fresh press from clearing B's own latch. Each pad's
      // suppression stays true (forcing that pad's contribution to padHeld
      // false) until poll() observes THAT pad with nothing pressed — i.e. a
      // genuine release for that pad.

      function heldNow() {
        var k;
        for (k in keysDown) { if (keysDown[k]) return true; }
        return pointerHeld || padHeld;
      }
      function syncHold(source) {
        var now = heldNow();
        if (now === wasHeld) return;
        wasHeld = now;
        onHold(now, source);
      }
      function releaseAll(source) {
        keysDown = {}; pointerHeld = false; padHeld = false;
        suppressNewPads = true;
        var pk;
        for (pk in padState) { if (padState.hasOwnProperty(pk)) padState[pk].suppressed = true; }
        syncHold(source || 'blur');
      }

      /* --- steering state (only live when opts.steer) ---------------- *
       * keyVec  which direction keys are held down right now
       * padVec  left stick + d-pad, refreshed by poll()
       * ptr     where a finger is being held, 0..1 across `el`
       * ------------------------------------------------------------- */
      var steer = !!opts.steer;
      var keyHeld = {};
      var padVec = { x: 0, y: 0 };
      var ptr = { active: false, id: null, nx: 0.5, ny: 0.5 };

      function onInteractive(e) {
        var t = e.target;
        return !!(t && t.closest && t.closest('button,a,input,select,textarea'));
      }

      function keyVec() {
        var x = 0, y = 0;
        for (var k in keyHeld) {
          if (!Object.prototype.hasOwnProperty.call(keyHeld, k)) continue;
          var v = STEER_KEYS[k];
          if (v) { x += v[0]; y += v[1]; }
        }
        return { x: x, y: y };
      }

      function trackPointer(e) {
        var r;
        try { r = el.getBoundingClientRect(); } catch (er) { return; }
        if (!r || !r.width || !r.height) return;
        ptr.nx = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
        ptr.ny = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
      }

      // --- touch & mouse ---
      el.addEventListener('pointerdown', function (e) {
        if (onInteractive(e)) return;
        lastSource = 'touch';
        pointerHeld = true;
        if (steer) {
          ptr.active = true;
          ptr.id = e.pointerId;
          trackPointer(e);
        }
        onPress('touch');
        syncHold('touch');
      });
      function pointerRelease() { pointerHeld = false; syncHold('touch'); }
      el.addEventListener('pointerup', pointerRelease);
      el.addEventListener('pointerleave', pointerRelease);
      // release on the window too: a finger lifted off-element still counts
      global.addEventListener('pointerup', pointerRelease);
      global.addEventListener('pointercancel', pointerRelease);

      if (steer) {
        el.addEventListener('pointermove', function (e) {
          if (!ptr.active || (ptr.id !== null && e.pointerId !== ptr.id)) return;
          lastSource = 'touch';
          trackPointer(e);
        });
        // release listens on the window as well: a finger that slides off the
        // canvas mid-drag never sends pointerup to the element, and the kid
        // would keep running into the wall forever.
        ['pointerup', 'pointercancel'].forEach(function (ev) {
          el.addEventListener(ev, endPointer);
          global.addEventListener(ev, endPointer);
        });
        global.addEventListener('blur', clearHeld);
        global.addEventListener('keyup', function (e) { delete keyHeld[e.key]; });
        try {
          global.document.addEventListener('visibilitychange', function () {
            if (global.document.hidden) clearHeld();
          });
        } catch (e) {}
      }

      function endPointer() { ptr.active = false; ptr.id = null; }
      function clearHeld() { keyHeld = {}; endPointer(); }

      // --- keyboard: almost any key jumps, so TV remotes just work ---
      global.addEventListener('keydown', function (e) {
        if (e.repeat) return;
        if (IGNORE_KEYS[e.key]) return;

        // If a button has focus, let Enter/Space activate it natively.
        var a = global.document.activeElement;
        var onBtn = a && a.tagName === 'BUTTON';
        if (onBtn && (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar')) return;

        // Held direction keys feed axis() as well as doing whatever they
        // already did, so ArrowUp still starts a game that waits on onPress.
        if (steer && STEER_KEYS[e.key]) { lastSource = 'key'; keyHeld[e.key] = 1; }

        if (NAV_KEYS[e.key]) {
          // arrows navigate menus but still jump during play
          lastSource = 'key';
          onNav(NAV_KEYS[e.key]);
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') return;
        }
        if (e.key === 'Escape') { onPause('key'); return; }

        if (e.preventDefault) e.preventDefault();
        lastSource = 'key';
        keysDown[e.key] = 1;
        onPress('key');
        syncHold('key');
      });

      global.addEventListener('keyup', function (e) {
        if (keysDown[e.key]) { delete keysDown[e.key]; syncHold('key'); }
      });

      global.addEventListener('blur', function () { releaseAll('blur'); });

      // --- gamepad ---
      global.addEventListener('gamepadconnected', function (e) {
        padsLive++;
        if (opts.onGamepad) opts.onGamepad(true, e.gamepad && e.gamepad.id);
      });
      global.addEventListener('gamepaddisconnected', function () {
        padsLive = Math.max(0, padsLive - 1);
        if (opts.onGamepad) opts.onGamepad(false);
      });

      function poll() {
        var pads;
        padVec.x = 0; padVec.y = 0;      // no pad, no push — never stick on
        try { pads = global.navigator && global.navigator.getGamepads ? global.navigator.getGamepads() : null; }
        catch (e) { return; }
        if (!pads) return;
        var held = false;

        for (var i = 0; i < pads.length; i++) {
          var p = pads[i];
          if (!p || !p.buttons) continue;
          var st = padState[p.index] || (padState[p.index] = { b: [], ax: {}, suppressed: suppressNewPads });
          var padDown = false;

          for (var b = 0; b < p.buttons.length; b++) {
            var btn = p.buttons[b];
            var down = btn === true || (btn && (btn.pressed || btn.value > 0.5));
            if (down && !st.b[b]) {
              lastSource = 'pad';
              if (b === BTN_X || b === BTN_Y) onAction('pad');
              else if (b === BTN_START || b === BTN_SELECT) onPause('pad');
              else if (b === BTN_LEFT) { onNav('left'); }
              else if (b === BTN_RIGHT) { onNav('right'); }
              else onPress('pad');           // A, B, bumpers, triggers, d-pad up/down
            }
            if (down && b !== BTN_X && b !== BTN_Y && b !== BTN_START &&
                b !== BTN_SELECT && b !== BTN_LEFT && b !== BTN_RIGHT) padDown = true;
            st.b[b] = down;
          }

          // analogue stick: up = jump, left/right = menu nav
          var ax = p.axes || [];
          var upNow = ax[1] < -AXIS, lNow = ax[0] < -AXIS, rNow = ax[0] > AXIS;
          if (upNow && !st.ax.up) { lastSource = 'pad'; onPress('pad'); }
          if (lNow && !st.ax.l) onNav('left');
          if (rNow && !st.ax.r) onNav('right');
          if (upNow) padDown = true;
          st.ax.up = upNow; st.ax.l = lNow; st.ax.r = rNow;

          if (st.suppressed) {
            // Force this pad off until it's observed with nothing pressed —
            // only then is its suppression genuinely satisfied and lifted.
            if (!padDown) st.suppressed = false;
            padDown = false;
          }
          if (padDown) held = true;

          if (steer) {
            var sx = Math.abs(ax[0] || 0) > STICK_DEAD ? ax[0] : 0;
            var sy = Math.abs(ax[1] || 0) > STICK_DEAD ? ax[1] : 0;
            if (st.b[BTN_LEFT]) sx -= 1;
            if (st.b[BTN_RIGHT]) sx += 1;
            if (st.b[BTN_UP]) sy -= 1;
            if (st.b[BTN_DOWN]) sy += 1;
            // several pads plugged in: whichever one is being pushed wins
            if (Math.abs(sx) + Math.abs(sy) > Math.abs(padVec.x) + Math.abs(padVec.y)) {
              padVec.x = sx; padVec.y = sy;
            }
            if (sx || sy) lastSource = 'pad';
          }
        }

        if (held !== padHeld) { padHeld = held; syncHold('pad'); }
      }

      /* Keys and stick added together, then clamped to a unit circle so a
         diagonal is not faster than a straight line. */
      function axis() {
        var k = keyVec();
        var x = k.x + padVec.x, y = k.y + padVec.y;
        var m = Math.sqrt(x * x + y * y);
        if (m > 1) { x /= m; y /= m; m = 1; }
        return { x: x, y: y, mag: m };
      }

      function padCount() {
        var pads, n = 0;
        try { pads = global.navigator && global.navigator.getGamepads ? global.navigator.getGamepads() : []; }
        catch (e) { return padsLive; }
        for (var i = 0; i < pads.length; i++) if (pads[i]) n++;
        return n;
      }

      return {
        poll: poll,
        padCount: padCount,
        axis: axis,
        /* Where a finger is being held, 0..1 across the element. `active`
           false means nobody is touching — not "touching the top left". */
        pointer: function () { return { active: ptr.active, nx: ptr.nx, ny: ptr.ny }; },
        releaseSteer: clearHeld,
        get lastSource() { return lastSource; },
        get held() { return wasHeld; }
      };
    },

    /* Focus helper for TV remotes / d-pads: move focus between buttons. */
    moveFocus: function (dir, scope) {
      var doc = global.document;
      var list = [].slice.call((scope || doc).querySelectorAll('button:not([disabled])'))
        .filter(function (b) { return b.offsetParent !== null || b.getClientRects === undefined; });
      if (!list.length) return;
      var i = list.indexOf(doc.activeElement);
      if (i === -1) { list[0].focus(); return; }
      var next = dir === 'left' || dir === 'up' ? i - 1 : i + 1;
      list[(next + list.length) % list.length].focus();
    },

    /* Click whatever is focused; returns true if something was clicked. */
    activateFocused: function () {
      var a = global.document.activeElement;
      if (a && a.tagName === 'BUTTON' && !a.disabled) { a.click(); return true; }
      return false;
    }
  };

  /* ------------------------------------------------------------------ *
   * audio — WebAudio that actually starts on iOS
   * ------------------------------------------------------------------ */
  var ctx = null, unlocked = false, noiseBuf = null;

  try {
    if (global.navigator && global.navigator.audioSession) {
      global.navigator.audioSession.type = 'playback';   // ignore iOS silent switch
    }
  } catch (e) {}

  function ensure() {
    try {
      if (!ctx) {
        var AC = global.AudioContext || global.webkitAudioContext;
        if (!AC) return false;
        ctx = new AC();
      }
      if (ctx.state !== 'running' && ctx.resume) ctx.resume();
      if (!unlocked) {
        var b = ctx.createBuffer(1, 1, 22050);
        var s = ctx.createBufferSource();
        s.buffer = b; s.connect(ctx.destination); s.start(0);
        unlocked = true;
      }
      return true;
    } catch (e) { return false; }
  }

  // any interaction anywhere counts as the unlocking gesture
  ['pointerdown', 'touchend', 'click', 'keydown'].forEach(function (ev) {
    try { global.addEventListener(ev, ensure, { passive: true }); }
    catch (e) { global.addEventListener(ev, ensure); }
  });
  try {
    global.document.addEventListener('visibilitychange', function () {
      if (!global.document.hidden && ctx && ctx.state !== 'running') { try { ctx.resume(); } catch (e) {} }
    });
  } catch (e) {}

  function getNoise() {
    if (!noiseBuf) {
      var n = Math.floor(ctx.sampleRate * 0.3);
      noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
      var ch = noiseBuf.getChannelData(0);
      for (var i = 0; i < n; i++) ch[i] = Math.random() * 2 - 1;
    }
    return noiseBuf;
  }

  KidKit.audio = {
    ensure: ensure,
    get ctx() { return ctx; },
    get running() { return !!ctx && ctx.state === 'running'; },

    tone: function (f, d, type, v, slide) {
      if (!ensure()) return;
      try {
        var o = ctx.createOscillator(), g = ctx.createGain();
        o.type = type || 'square';
        o.frequency.setValueAtTime(f, ctx.currentTime);
        if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, f + slide), ctx.currentTime + d);
        g.gain.setValueAtTime(v == null ? 0.05 : v, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + d);
        o.connect(g); g.connect(ctx.destination);
        o.start(); o.stop(ctx.currentTime + d);
      } catch (e) {}
    },

    noise: function (d, v) {
      if (!ensure()) return;
      try {
        var n = Math.floor(ctx.sampleRate * d);
        var buf = ctx.createBuffer(1, n, ctx.sampleRate), ch = buf.getChannelData(0);
        for (var i = 0; i < n; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / n);
        var s = ctx.createBufferSource(), g = ctx.createGain();
        s.buffer = buf; g.gain.value = v == null ? 0.06 : v;
        s.connect(g); g.connect(ctx.destination); s.start();
      } catch (e) {}
    },

    /* ---------------------------------------------------------------- *
     * music(tracks) — chiptune loop player.
     * Each track: { bpm, wave, drums:'light'|'soft'|'heavy',
     *               lead:[midi or -1 ...], bass:[midi or -1 ...] }
     * Returns { play(name), stop(), setEnabled(bool), enabled, current }
     * ---------------------------------------------------------------- */
    music: function (tracks, opts) {
      opts = opts || {};
      var bus = null, timer = null, cur = null, step = 0, nextAt = 0;
      var enabled = opts.enabled !== false;
      var vol = opts.volume == null ? 0.55 : opts.volume;

      function m2f(n) { return 440 * Math.pow(2, (n - 69) / 12); }

      function note(n, at, dur, type, v) {
        var o = ctx.createOscillator(), g = ctx.createGain();
        o.type = type; o.frequency.setValueAtTime(m2f(n), at);
        g.gain.setValueAtTime(0.0001, at);
        g.gain.linearRampToValueAtTime(v, at + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
        o.connect(g); g.connect(bus); o.start(at); o.stop(at + dur + 0.03);
      }

      function drum(kind, at) {
        if (kind === 'kick') {
          var o = ctx.createOscillator(), g = ctx.createGain();
          o.type = 'sine';
          o.frequency.setValueAtTime(150, at);
          o.frequency.exponentialRampToValueAtTime(42, at + 0.13);
          g.gain.setValueAtTime(0.5, at);
          g.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
          o.connect(g); g.connect(bus); o.start(at); o.stop(at + 0.18);
        } else {
          var s = ctx.createBufferSource(), gg = ctx.createGain(), f = ctx.createBiquadFilter();
          s.buffer = getNoise();
          f.type = 'highpass'; f.frequency.value = kind === 'hat' ? 7000 : 1600;
          var dur = kind === 'hat' ? 0.035 : 0.13;
          gg.gain.setValueAtTime(kind === 'hat' ? 0.11 : 0.3, at);
          gg.gain.exponentialRampToValueAtTime(0.0001, at + dur);
          s.connect(f); f.connect(gg); gg.connect(bus);
          s.start(at); s.stop(at + dur + 0.02);
        }
      }

      function doStep(i, at, tr) {
        var eighth = 60 / tr.bpm / 2;
        var n = tr.lead[i];
        if (n !== -1 && n !== undefined) note(n, at, eighth * 1.5, tr.wave || 'square', 0.085);
        var b = tr.bass[i % tr.bass.length];
        if (b !== -1 && b !== undefined) note(b, at, eighth * 0.9, 'triangle', 0.13);

        if (tr.drums === 'heavy') {
          if (i % 4 === 0 || i % 8 === 3) drum('kick', at);
          if (i % 8 === 4) drum('snare', at);
          drum('hat', at);
        } else if (tr.drums === 'soft') {
          if (i % 8 === 0) drum('kick', at);
          if (i % 4 === 2) drum('hat', at);
        } else {
          if (i % 8 === 0 || i % 8 === 6) drum('kick', at);
          if (i % 8 === 4) drum('snare', at);
          if (i % 2 === 1) drum('hat', at);
        }
      }

      function tick() {
        if (!ctx || !cur || !enabled) return;
        var tr = tracks[cur];
        if (!tr) return;
        var eighth = 60 / tr.bpm / 2;
        if (nextAt < ctx.currentTime) nextAt = ctx.currentTime + 0.05;
        while (nextAt < ctx.currentTime + 0.18) {
          try { doStep(step, nextAt, tr); } catch (e) {}
          nextAt += eighth;
          step = (step + 1) % tr.lead.length;
        }
      }

      return {
        get current() { return cur; },
        get enabled() { return enabled; },
        play: function (name) {
          if (name === cur) return;
          cur = name; step = 0;
          if (!enabled || !name || !ensure()) return;
          if (!bus) { bus = ctx.createGain(); bus.gain.value = vol; bus.connect(ctx.destination); }
          nextAt = ctx.currentTime + 0.06;
          if (!timer) timer = setInterval(tick, 30);
        },
        stop: function () {
          cur = null;
          if (timer) { clearInterval(timer); timer = null; }
        },
        setEnabled: function (on) {
          enabled = !!on;
          if (bus) bus.gain.value = enabled ? vol : 0;
          if (!enabled) { if (timer) { clearInterval(timer); timer = null; } }
          else if (cur) { var n = cur; cur = null; this.play(n); }
        }
      };
    }
  };

  /* ------------------------------------------------------------------ *
   * kidLock(button, opts) — makes it hard for small hands to bail out.
   * Tap to lock. Hold `holdMs` to unlock.
   * ------------------------------------------------------------------ */
  KidKit.kidLock = function (btn, opts) {
    opts = opts || {};
    var doc = global.document;
    var HOLD = opts.holdMs || 3000;
    var onChange = opts.onChange || function () {};
    var locked = false, wake = null, iv = null, held = 0;
    var BLOCK = ['contextmenu', 'selectstart', 'dragstart', 'gesturestart', 'gesturechange', 'dblclick'];

    function stop(e) { if (e.preventDefault) e.preventDefault(); }
    function onPop() { if (locked) { try { global.history.pushState({ kidlock: 1 }, ''); } catch (e) {} } }
    function onBye(e) { if (locked) { e.preventDefault(); e.returnValue = ''; return ''; } }

    function grabWake() {
      try {
        if (global.navigator && global.navigator.wakeLock && !wake) {
          global.navigator.wakeLock.request('screen').then(function (w) {
            wake = w;
            if (w.addEventListener) w.addEventListener('release', function () { wake = null; });
          }, function () {});
        }
      } catch (e) {}
    }

    function on() {
      locked = true;
      try { doc.body.classList.add('kk-locked'); } catch (e) {}
      try {
        var d = doc.documentElement;
        var rf = d.requestFullscreen || d.webkitRequestFullscreen || d.msRequestFullscreen;
        if (rf) { var r = rf.call(d); if (r && r.catch) r.catch(function () {}); }
      } catch (e) {}
      grabWake();
      try { global.history.pushState({ kidlock: 1 }, ''); } catch (e) {}
      global.addEventListener('popstate', onPop);
      global.addEventListener('beforeunload', onBye);
      BLOCK.forEach(function (ev) { doc.addEventListener(ev, stop, { passive: false }); });
      onChange(true);
    }

    function off() {
      locked = false;
      try { doc.body.classList.remove('kk-locked'); } catch (e) {}
      try {
        var ef = doc.exitFullscreen || doc.webkitExitFullscreen;
        if (ef && (doc.fullscreenElement || doc.webkitFullscreenElement)) ef.call(doc);
      } catch (e) {}
      try { if (wake) { wake.release(); wake = null; } } catch (e) {}
      global.removeEventListener('popstate', onPop);
      global.removeEventListener('beforeunload', onBye);
      BLOCK.forEach(function (ev) { doc.removeEventListener(ev, stop); });
      onChange(false);
    }

    function holdStart(e) {
      if (e) { if (e.preventDefault) e.preventDefault(); if (e.stopPropagation) e.stopPropagation(); }
      if (!locked) { on(); return; }
      held = 0;
      clearInterval(iv);
      iv = setInterval(function () {
        held += 50;
        var pct = Math.min(100, held / HOLD * 100);
        if (opts.onHold) opts.onHold(pct);
        if (held >= HOLD) { holdEnd(); off(); }
      }, 50);
    }
    function holdEnd(e) {
      if (e) { if (e.preventDefault) e.preventDefault(); if (e.stopPropagation) e.stopPropagation(); }
      clearInterval(iv); iv = null;
      if (opts.onHold) opts.onHold(0);
    }

    if (btn) {
      btn.addEventListener('pointerdown', holdStart);
      ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) {
        btn.addEventListener(ev, holdEnd);
      });
      // remote/keyboard users get a plain toggle
      btn.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); locked ? off() : on(); }
      });
    }
    try {
      doc.addEventListener('visibilitychange', function () {
        if (!doc.hidden && locked) grabWake();
      });
    } catch (e) {}

    return { on: on, off: off, get locked() { return locked; } };
  };

  global.KidKit = KidKit;
})(typeof window !== 'undefined' ? window : this);
