# Oliver Run — The High Road Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a nearly-six-year-old a skill ceiling by adding hold-to-glide and an optional two-tier sky lane, while proving the ground lane is byte-for-byte unchanged.

**Architecture:** Hold detection is added to the shared input kit (`shared/kidkit.js`) because the kit owns input; the game consumes it. Glide clamps descent velocity only and can never gain height. Sky-lane platforms are one-way and draw all their randomness from a *separate* PRNG so the `Math.random()` stream stays identical, which makes the "unchanged for Emsile" claim an exact test rather than an opinion.

**Tech Stack:** Vanilla ES5/ES6 browser JavaScript, canvas 2D, WebAudio. No build step, no npm, no dependencies. Tests run under plain `node` via `test/harness.js`.

**Spec:** `docs/superpowers/specs/2026-07-29-oliver-run-high-road-design.md`

## Global Constraints

- **No build step, no npm, no dependencies, no framework.** Vanilla HTML + CSS + canvas 2D + WebAudio.
- **One button.** Any new ability maps onto the existing single input.
- **No fail states.** Nothing kills the player. No lives, no game over. Falling costs nothing.
- **`shared/kidkit.js` must stay ES5.** No `const`/`let`, no arrow functions, no `Set`/`Map`, no template literals, no default parameters in that file. Object-literal getters are permitted (the file already uses `get lastSource()`).
- **Never use `localStorage`/`sessionStorage` directly, and never `window.storage`.** Only `KidKit.storage`.
- **Relative paths only.** The site is served from `/family-arcade/`.
- **All sky-lane randomness uses the dedicated sky PRNG, never `Math.random()`** — including anything in the drawing code. Shimmer derives from the frame counter `t`.
- **Glide can never increase height.** It clamps descent only.
- **Tests must pass with `node test/smoke.js`** — no test framework, no dependencies.
- After any game change, bump `sw.js` `CACHE`.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `test/harness.js` | Modify | Add sustained `hold()`, split key/pointer press+release, add RNG `fingerprint()`, add `blur()` |
| `test/smoke.js` | Modify | Baseline regression test, then one test group per new mechanic |
| `shared/kidkit.js` | Modify | Add hold tracking + `onHold` + `.held` to `input.create()` |
| `games/oliver-run/index.html` | Modify | `TUNE` block, glide, platforms, gold stars, drawing |
| `sw.js` | Modify | Cache bump |

Task order matters: **Task 1 must land before any behaviour changes**, because it captures the pre-change fingerprint that every later task is measured against.

---

### Task 1: Harness input semantics and the ground-lane baseline

Nothing in the game changes here. This task makes the harness able to express a *sustained* hold, and records what the ground lane does today so later tasks can prove they didn't disturb it.

Two harness bugs are fixed as part of this: `tap()` and `key()` currently fire a press with no release. That is invisible today because kidkit ignores release events, but the moment Task 2 lands, an unreleased press would leave the game permanently held and silently corrupt every other test.

**Files:**
- Modify: `test/harness.js`
- Modify: `test/smoke.js`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `h.tap(id?)` → press **and release** a pointer on `id` (default `'stage'`)
  - `h.key(k)` → keydown **and** keyup for key `k`
  - `h.keyDown(k)` / `h.keyUp(k)` → individual key edges
  - `h.hold(on: boolean, id?)` → sustained pointer + gamepad-A hold, no auto-release
  - `h.blur()` → dispatch a window `blur` event
  - `h.fingerprint()` → `string` of the form `"<callCount>:<hex32sum>"` over every `Math.random()` the game consumed since load

- [ ] **Step 1: Add RNG fingerprinting to the harness**

In `test/harness.js`, in the `/* ---- RNG ---- */` block, add two cumulative counters next to the existing per-frame budget counter:

```js
  const RANDOM_BUDGET = opts.randomBudget || 2000000;
  const baseRandom = mulberry32(opts.seed == null ? 0xC0FFEE : opts.seed);
  let randomHook = null;
  let randomCalls = 0;
  let rngCalls = 0;                 // cumulative, never reset
  let rngSum = 0;                   // rolling 32-bit checksum of the raw stream
  function random() {
    if (++randomCalls > RANDOM_BUDGET) {
      throw new Error(
        `runaway RNG: over ${RANDOM_BUDGET} Math.random() calls in one frame ` +
        `(frame ${frameCount}). This is what a rejection-sampling loop looks ` +
        `like when the RNG is biased — see setRandomHook/bucket.`);
    }
    const v = baseRandom();
    rngCalls++;
    rngSum = (rngSum + Math.floor(v * 4294967296)) >>> 0;
    return randomHook ? randomHook(v) : v;
  }
```

The checksum is taken on the **raw** value before any hook, so it fingerprints the underlying stream rather than the test's biasing.

- [ ] **Step 2: Add the new input methods to the harness API**

In `test/harness.js`, replace the existing `tap` and `key` entries in the `api` object with:

```js
    /* --- input --- */
    tap(id) {
      const el = doc.getElementById(id || 'stage');
      el.dispatchEvent(makeEvent('pointerdown', el, { pointerId: 1, button: 0 }));
      el.dispatchEvent(makeEvent('pointerup', el, { pointerId: 1, button: 0 }));
      winDispatch(makeEvent('pointerup', el, { pointerId: 1, button: 0 }));
      return api;
    },
    click(id) { doc.getElementById(id).click(); return api; },
    keyDown(k) {
      winDispatch(makeEvent('keydown', doc.body, { key: k, code: k, repeat: false }));
      return api;
    },
    keyUp(k) {
      winDispatch(makeEvent('keyup', doc.body, { key: k, code: k }));
      return api;
    },
    key(k) { api.keyDown(k); api.keyUp(k); return api; },
    /* Sustained hold — unlike holdJump(), which deliberately presses and
       releases on a cadence to generate repeated jump edges. Do not use both
       at once. */
    hold(on, id) {
      const el = doc.getElementById(id || 'stage');
      if (on) {
        el.dispatchEvent(makeEvent('pointerdown', el, { pointerId: 1, button: 0 }));
      } else {
        el.dispatchEvent(makeEvent('pointerup', el, { pointerId: 1, button: 0 }));
        winDispatch(makeEvent('pointerup', el, { pointerId: 1, button: 0 }));
      }
      if (pads.length) {
        const b = pads[0].buttons[PAD_BUTTONS.a];
        b.pressed = !!on; b.value = on ? 1 : 0; b.touched = !!on;
      }
      return api;
    },
    blur() { winDispatch(makeEvent('blur', null, {})); return api; },
    fingerprint() { return rngCalls + ':' + (rngSum >>> 0).toString(16); },
```

Leave `pad`, `padPress`, `connectPad` and `padCount` exactly as they are.

- [ ] **Step 3: Run the existing suite to confirm nothing regressed**

Run: `node test/smoke.js`
Expected: `all 14 passed`. The release events are inert until Task 2, so every existing number must be unchanged.

- [ ] **Step 4: Print the baseline fingerprint**

Run:

```bash
node -e "const {createHarness}=require('./test/harness');const h=createHarness('oliver-run',{seed:20260729});h.tap();h.frames(9000);console.log(JSON.stringify({score:h.num('score'),level:h.text('lvlName'),trophies:h.text('trophies'),rng:h.fingerprint()}))"
```

Expected: a single JSON line. Copy it verbatim — it is pasted into the test in the next step.

- [ ] **Step 5: Write the baseline regression test**

In `test/smoke.js`, immediately after the `POWER_DURATIONS` constant, add the captured object and the test. **Replace the placeholder object below with the exact JSON printed in Step 4.**

```js
/* Captured from the pre-high-road build. A run with no jump and no hold input
   never leaves the ground, so it can never touch a platform or a gold star —
   which means the sky lane must not perturb this by so much as one RNG draw.
   If this test fails after a sky-lane change, the separate-PRNG rule was
   broken somewhere, most likely in drawing code calling Math.random(). */
const GROUND_BASELINE = { /* paste Step 4 output here */ };

test('ground lane is byte-identical (Emsile regression)', note => {
  const h = createHarness('oliver-run', { seed: 20260729 });
  h.tap();                       // starts the game; nothing jumps after this
  pump(h, 9000);
  const actual = {
    score: h.num('score'),
    level: h.text('lvlName'),
    trophies: h.text('trophies'),
    rng: h.fingerprint(),
  };
  note(JSON.stringify(actual));
  for (const k of Object.keys(GROUND_BASELINE)) {
    assert(actual[k] === GROUND_BASELINE[k],
      `${k} drifted: ${JSON.stringify(actual[k])} != ${JSON.stringify(GROUND_BASELINE[k])}`);
  }
  return h;
});
```

- [ ] **Step 6: Run the new test**

Run: `node test/smoke.js "byte-identical"`
Expected: `all 1 passed`.

- [ ] **Step 7: Run the whole suite**

Run: `node test/smoke.js`
Expected: `all 15 passed`.

- [ ] **Step 8: Commit**

```bash
git add test/harness.js test/smoke.js
git commit -m "test: add sustained hold, input release edges, and ground-lane fingerprint

Captures the pre-change RNG stream fingerprint so the sky lane can be proven
not to disturb the ground lane. Also fixes tap() and key() firing a press with
no release, which becomes load-bearing as soon as kidkit tracks held state."
```

---

### Task 2: Teach KidKit what "held" means

`KidKit.input.create()` returns only `{poll, padCount, lastSource}` and the input layer registers no release events at all. This adds hold tracking to the kit, where it belongs.

**Files:**
- Modify: `shared/kidkit.js:82-207` (the `input.create` function)
- Modify: `test/smoke.js`

**Interfaces:**
- Consumes: `h.hold`, `h.keyDown`, `h.keyUp`, `h.blur` from Task 1
- Produces:
  - `opts.onHold(down: boolean, source: string)` — fires only on change
  - `pads.held` → `boolean`, true while any jump-capable input is down

- [ ] **Step 1: Write the failing tests**

Add to `test/smoke.js`, after the baseline test:

```js
/* KidKit's input layer is shared by every game, so it gets tested directly
   rather than through Oliver Run's behaviour. */
test('KidKit tracks held state across key, pointer, pad and blur', note => {
  const h = createHarness('oliver-run', { seed: 5 });
  const seen = [];
  const pads = global.KidKit.input.create({
    element: h.document.getElementById('stage'),
    onHold: (down, src) => seen.push((down ? '+' : '-') + src),
  });
  assert(pads.held === false, 'should start unheld');

  h.keyDown('ArrowUp');
  assert(pads.held === true, 'keydown should hold');
  h.keyUp('ArrowUp');
  assert(pads.held === false, 'keyup should release');

  // two keys down, releasing one must NOT release the hold
  h.keyDown('a'); h.keyDown('b');
  h.keyUp('a');
  assert(pads.held === true, 'still held while a second key is down');
  h.keyUp('b');
  assert(pads.held === false, 'released once the last key is up');

  h.hold(true);
  assert(pads.held === true, 'pointer down should hold');
  h.hold(false);
  assert(pads.held === false, 'pointer up should release');

  // gamepad is edge-detected inside poll(), so it needs frames
  h.hold(true); pads.poll();
  assert(pads.held === true, 'pad button should hold');

  // the case that would otherwise glide forever
  h.blur();
  assert(pads.held === false, 'blur must force-release everything');

  note(seen.join(' '));
  assert(seen.length > 0, 'onHold should have fired');
  return h;
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node test/smoke.js "held state"`
Expected: FAIL — `should start unheld`, because `pads.held` is `undefined`.

- [ ] **Step 3: Add hold state to input.create**

In `shared/kidkit.js`, immediately after `var lastSource = 'touch';` (line ~92), insert:

```js
      var onHold   = opts.onHold || function () {};
      var keysDown = {};
      var pointerHeld = false, padHeld = false, wasHeld = false;

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
        syncHold(source || 'blur');
      }
```

- [ ] **Step 4: Track pointer press and release**

Replace the existing pointerdown handler (line ~100) with:

```js
      // --- touch & mouse ---
      el.addEventListener('pointerdown', function (e) {
        if (onInteractive(e)) return;
        lastSource = 'touch';
        pointerHeld = true;
        onPress('touch');
        syncHold('touch');
      });
      function pointerRelease() { pointerHeld = false; syncHold('touch'); }
      el.addEventListener('pointerup', pointerRelease);
      el.addEventListener('pointerleave', pointerRelease);
      // release on the window too: a finger lifted off-element still counts
      global.addEventListener('pointerup', pointerRelease);
      global.addEventListener('pointercancel', pointerRelease);
```

- [ ] **Step 5: Track keyboard press and release**

In the existing keydown handler, add the two marked lines just before `onPress('key')` at the end, so keys that return early (nav, Escape, ignored keys) never register as held:

```js
        if (e.preventDefault) e.preventDefault();
        lastSource = 'key';
        keysDown[e.key] = 1;          // <-- add
        onPress('key');
        syncHold('key');              // <-- add
      });

      global.addEventListener('keyup', function (e) {
        if (keysDown[e.key]) { delete keysDown[e.key]; syncHold('key'); }
      });

      global.addEventListener('blur', function () { releaseAll('blur'); });
```

- [ ] **Step 6: Track gamepad held state in poll()**

In `poll()`, add `var anyDown = false;` directly after `if (!pads) return;`. Inside the button loop, after the existing `if (down && !st.b[b]) { ... }` block and before `st.b[b] = down;`, add:

```js
            if (down && b !== BTN_X && b !== BTN_Y && b !== BTN_START &&
                b !== BTN_SELECT && b !== BTN_LEFT && b !== BTN_RIGHT) anyDown = true;
```

After the axis block, add `if (upNow) anyDown = true;`. Then immediately before the closing brace of `poll()`, add:

```js
        if (anyDown !== padHeld) { padHeld = anyDown; syncHold('pad'); }
```

- [ ] **Step 7: Expose `held` on the returned object**

Replace the return at line ~182:

```js
      return {
        poll: poll,
        padCount: padCount,
        get lastSource() { return lastSource; },
        get held() { return wasHeld; }
      };
```

- [ ] **Step 8: Bump the kit version**

Change line 18 from `var KidKit = { version: '1.0.0' };` to `var KidKit = { version: '1.1.0' };`

- [ ] **Step 9: Verify ES5 compliance**

Run: `node --check shared/kidkit.js`
Expected: no output.

Then confirm no ES6 crept in:

```bash
grep -nE "=>|\bconst \b|\blet \b|`" shared/kidkit.js || echo "ES5 clean"
```

Expected: `ES5 clean`.

- [ ] **Step 10: Run the tests**

Run: `node test/smoke.js "held state"`
Expected: `all 1 passed`.

Run: `node test/smoke.js`
Expected: `all 16 passed`, **including the ground-lane baseline**. The kit change adds no `Math.random()` calls, so the fingerprint must be untouched. If the baseline fails here, something in the new code is consuming randomness.

- [ ] **Step 11: Commit**

```bash
git add shared/kidkit.js test/smoke.js
git commit -m "feat(kidkit): track held input state across touch, keyboard and gamepad

Adds onHold(down, source) and a .held getter to input.create(). Purely
additive: a game that ignores both behaves exactly as before. Window blur
force-releases, otherwise a hold that ends off-window never terminates.
Bumps KidKit to 1.1.0."
```

---

### Task 3: The TUNE block and hold-to-glide

**Files:**
- Modify: `games/oliver-run/index.html:245` (add `TUNE` after the `W`/`H`/`GROUND` constants)
- Modify: `games/oliver-run/index.html:596-612` (input wiring)
- Modify: `games/oliver-run/index.html:936-945` (physics)
- Modify: `test/smoke.js`

**Interfaces:**
- Consumes: `pads.held` from Task 2
- Produces: `TUNE` object; `holding` boolean in game scope; `gliding` state on the hero

- [ ] **Step 1: Write the failing tests**

Add to `test/smoke.js`:

Glide has **no direct black-box observable** at this point in the build. The
hero's altitude is not written to the DOM, and oscillator counts cannot stand in
for jump events because the music engine emits oscillators continuously. So this
task asserts the two things that *are* exactly checkable now, and the
quantitative proof that glide works is deferred to Task 5, where gold stars make
altitude observable through the score.

```js
/* Glide only engages while airborne and descending. A run that never jumps
   must therefore be bit-for-bit identical whether or not the button is held —
   which is a far stronger claim than "the score looks similar". */
test('glide is inert while grounded', note => {
  const h = createHarness('oliver-run', { seed: 20260729 });
  h.tap();
  h.hold(true);               // held for the entire run, never jumping
  pump(h, 9000);
  const actual = {
    score: h.num('score'),
    level: h.text('lvlName'),
    trophies: h.text('trophies'),
    rng: h.fingerprint(),
  };
  note(JSON.stringify(actual));
  for (const k of Object.keys(GROUND_BASELINE)) {
    assert(actual[k] === GROUND_BASELINE[k],
      `holding changed ${k} on the ground: ${JSON.stringify(actual[k])} != ${JSON.stringify(GROUND_BASELINE[k])}`);
  }
  return h;
});

test('holding through a long run throws nothing', note => {
  const h = createHarness('oliver-run', { seed: 33 });
  h.tap();
  h.hold(true);
  for (let i = 0; i < 6000; i++) {
    if (i % 5 === 0) h.pad('a');   // jump into the glide repeatedly
    pump(h, 1);
  }
  assert(h.num('score') > 500, `run should have progressed, got ${h.num('score')}`);
  note(`score ${h.num('score')} over 6000 frames of hold + jump`);
  return h;
});
```

- [ ] **Step 2: Run to verify the second test fails**

Run: `node test/smoke.js "throws nothing"`
Expected: FAIL — `h.hold` is not a function until Task 1 is in place, and if Task 1 *is* in place this passes trivially. That is fine: the load-bearing test in this task is `glide is inert while grounded`, which is a guard that must keep passing after Step 5 changes the physics. Run it too:

Run: `node test/smoke.js "inert while grounded"`
Expected: PASS before the change (glide does not exist) and PASS after (glide never engages on the ground). A failure after Step 5 means the glide condition is wrong — most likely the `!hero.onGround` guard is missing.

- [ ] **Step 3: Add the TUNE block**

In `games/oliver-run/index.html`, directly after line 245 (`const W = 900, H = 450, GROUND = 366;`) insert:

```js
  /* Every number that changes how the high road feels. Tune these with a
     six-year-old sitting next to you; nothing else should need touching. */
  const TUNE = {
    glideVyMax:    2.4,          // max descent px/frame while the button is held
    tier1Y:        GROUND - 130, // low platform top surface (jump apex is ~152)
    tier2Y:        GROUND - 260, // high platform, only reachable from tier 1
    platWMin:      90,
    platWMax:      160,
    platThick:     16,
    clusterMin:    2,
    clusterMax:    4,
    clusterGapMin: 420,          // frames of plain ground between clusters
    clusterGapMax: 780,
    firstCluster:  480,          // frames into a run phase before the first one
    tier2Chance:   0.45,
    goldChance:    0.7,          // chance a given platform carries a gold star
    goldLift:      40,           // how far above the platform the star floats
    goldPoints:    50,           // a normal star is 10
    goldCharge:    5,            // a normal star is 2
    skySeed:       20260729,
  };
```

- [ ] **Step 4: Wire up the hold callback**

In the `KidKit.input.create({...})` call at line ~596, add a `holding` variable just above it and an `onHold` handler. Insert before `const gamepads = KidKit.input.create({`:

```js
  let holding = false;
```

and add this property to the options object, directly after the `onAction` line:

```js
    onHold: down => { holding = down; },
```

- [ ] **Step 5: Apply the glide in the physics step**

In `update(dt)`, replace lines 937-938:

```js
    hero.vy += lv.grav*dt;
    hero.y += hero.vy*dt;
```

with:

```js
    hero.vy += lv.grav*dt;
    // Hold to float: clamps descent only, so it can never gain height and
    // reaching a platform stays a matter of nailing the jump.
    const gliding = holding && hero.vy > 0 && !hero.onGround && !P('dog');
    if (gliding) hero.vy = Math.min(hero.vy, TUNE.glideVyMax);
    hero.y += hero.vy*dt;
```

- [ ] **Step 6: Record glide in the sister's trail**

Replace line 948:

```js
    trail.push({y:hero.y, run:hero.run, air:!hero.onGround});
```

with:

```js
    trail.push({y:hero.y, run:hero.run, air:!hero.onGround, glide:gliding});
```

- [ ] **Step 7: Run the tests**

Run: `node test/smoke.js glide`
Expected: `all 2 passed`.

- [ ] **Step 8: Run the whole suite**

Run: `node test/smoke.js`
Expected: all pass **including the ground-lane baseline** — glide adds no `Math.random()` calls and a no-input run never leaves the ground.

Note: the endurance and boss-rush tests use `holdJump()`, which alternates press/release every frame, so the glide flickers rather than engaging. Their score assertions are thresholds rather than exact values, so they should still pass. If boss rush now exceeds its frame cap, raise `CAP` in that test and note why.

- [ ] **Step 9: Commit**

```bash
git add games/oliver-run/index.html test/smoke.js
git commit -m "feat(oliver-run): hold to glide

Holding any input clamps descent to TUNE.glideVyMax while falling. It can
never gain height, so jump timing stays the real skill and no fuel meter is
needed. Inactive while riding the dog, where heroBase() is already overridden.
Adds the TUNE block holding every high-road feel value."
```

---

### Task 4: The sky lane

**Files:**
- Modify: `games/oliver-run/index.html` — state block (~line 531), `reset()` (~555), `tryJump()` (~587), `update()` (~939-951), `render()` (~2290)
- Modify: `test/smoke.js`

**Interfaces:**
- Consumes: `TUNE` from Task 3
- Produces: `platforms` array of `{x, y, w, star}`; `landingY(prevY)` → `number`; `spawnCluster()`; `drawPlatform(p)`

- [ ] **Step 1: Write the failing tests**

Add to `test/smoke.js`:

```js
test('sky lane: platforms appear only during the run phase', note => {
  const h = createHarness('oliver-run', { seed: 41 });
  h.click('rushBtn');          // Boss Rush has no run phase at all
  pump(h, 6000);
  assert(h.text('lvlName') === 'Boss Rush', 'should be in rush mode');
  note('rush mode completed 6000 frames with no run phase');
  return h;
});

test('sky lane: platforms survive a long run without incident', note => {
  const h = createHarness('oliver-run', { seed: 42 });
  h.tap();
  h.hold(true);
  for (let i = 0; i < 12000; i++) {
    if (i % 3 === 0) h.pad('a');     // climb around the clusters
    pump(h, 1);
  }
  assert(h.num('score') > 500, `run should have progressed, got ${h.num('score')}`);
  assert(h.hidden('startScreen'), 'game should still be in play');
  note(`score ${h.num('score')} after 12000 frames of climbing`);
  return h;
});
```

- [ ] **Step 2: Run to verify the suite is green before the change**

Run: `node test/smoke.js "sky lane"`
Expected: `all 2 passed` — these are guard tests that must keep passing, not red-first tests. The red-first test is Step 3.

- [ ] **Step 3: Write the red-first gold-star reachability test**

Add to `test/smoke.js`:

```js
test('sky lane: gold stars are unreachable without leaving the ground', note => {
  const grounded = createHarness('oliver-run', { seed: 43 });
  grounded.tap();
  pump(grounded, 9000);            // never jumps
  const flat = grounded.num('score');
  grounded.dispose();

  const climber = createHarness('oliver-run', { seed: 43 });
  climber.tap();
  climber.hold(true);
  for (let i = 0; i < 9000; i++) {
    if (i % 3 === 0) climber.pad('a');
    pump(climber, 1);
  }
  const climbed = climber.num('score');
  note(`grounded ${flat} vs climbing ${climbed}`);
  assert(climbed > flat * 1.15,
    `using the sky lane should pay noticeably better: ${flat} -> ${climbed}`);
  return climber;
});
```

Run: `node test/smoke.js "unreachable without"`
Expected: FAIL — with no sky lane the two scores are close, so the 1.15× margin is not met.

- [ ] **Step 4: Add the platform state and its own PRNG**

In `games/oliver-run/index.html`, after line 536 (`let trail = [];`) insert:

```js
  /* Sky lane. Its randomness comes from a dedicated PRNG so the Math.random()
     stream stays byte-identical for anyone who never leaves the ground —
     that is what makes the ground-lane regression test an exact equality. */
  let platforms = [], skyIn = 0;
  let skyRnd = rnd(TUNE.skySeed);
  const skyRange = (a, b) => a + skyRnd()*(b - a);
```

- [ ] **Step 5: Reset the sky lane on a new run**

In `reset()`, after line 563 (`trail = [];`) add:

```js
    platforms = []; skyIn = TUNE.firstCluster; skyRnd = rnd(TUNE.skySeed);
```

- [ ] **Step 6: Add cluster spawning**

Directly after the `spawnStar()` function (ends line 704) insert:

```js
  /* A cluster always opens on tier 1 so it is reachable from the ground;
     later platforms in the cluster may step up to tier 2. */
  function spawnCluster(){
    const n = Math.floor(skyRange(TUNE.clusterMin, TUNE.clusterMax + 1));
    let x = W + 80;
    for (let i=0;i<n;i++){
      const w = skyRange(TUNE.platWMin, TUNE.platWMax);
      const high = i > 0 && skyRnd() < TUNE.tier2Chance;
      const p = {x, y: high ? TUNE.tier2Y : TUNE.tier1Y, w, star:null};
      if (skyRnd() < TUNE.goldChance) p.star = {dx: w/2, got:false};
      platforms.push(p);
      x += w + skyRange(70, 150);
    }
    skyIn = skyRange(TUNE.clusterGapMin, TUNE.clusterGapMax);
  }
```

- [ ] **Step 7: Add the one-way landing surface**

Directly after `heroBase()` (line 745) insert:

```js
  /* The surface the hero would land on this frame. Platforms are one-way:
     they only catch a hero who was at or above the top edge last frame, so
     jumping up through one never collides. Uses foot position, not the body
     box — the body box is what caused the old hitbox-to-the-ground bug. */
  function landingY(prevY){
    let base = heroBase();
    if (P('dog')) return base;
    for (const p of platforms){
      if (hero.x < p.x - 6 || hero.x > p.x + p.w + 6) continue;
      if (prevY <= p.y + 2 && p.y < base) base = p.y;
    }
    return base;
  }
```

- [ ] **Step 8: Use the dynamic surface in the physics step**

In `update(dt)`, capture the pre-integration position and use `landingY`. Replace:

```js
    hero.vy += lv.grav*dt;
    const gliding = holding && hero.vy > 0 && !hero.onGround && !P('dog');
    if (gliding) hero.vy = Math.min(hero.vy, TUNE.glideVyMax);
    hero.y += hero.vy*dt;
    const base = heroBase();
```

with:

```js
    const prevY = hero.y;
    hero.vy += lv.grav*dt;
    const gliding = holding && hero.vy > 0 && !hero.onGround && !P('dog');
    if (gliding) hero.vy = Math.min(hero.vy, TUNE.glideVyMax);
    hero.y += hero.vy*dt;
    const base = landingY(prevY);
```

The existing `if (hero.y>=base){...} else if (hero.onGround){...}` block below needs no change: when a platform scrolls out from under the hero, `landingY` stops returning it, `hero.y < base` becomes true, and the hero simply falls. That is the no-fail rule holding automatically.

- [ ] **Step 9: Scroll and spawn platforms**

In `update(dt)`, replace line 951:

```js
    if (phase==='run'){ spawnIn -= dt; if (spawnIn<=0) spawn(); }
```

with:

```js
    if (phase==='run'){
      spawnIn -= dt; if (spawnIn<=0) spawn();
      skyIn -= dt;   if (skyIn<=0) spawnCluster();
    }
    for (const p of platforms) p.x -= speed*dt;
    platforms = platforms.filter(p => p.x + p.w > -120);
```

- [ ] **Step 10: Fix the jump particle origin**

In `tryJump()`, line 587-589 spawns dust at `heroBase()`, which is the ground even when jumping off a platform. Replace `const base = heroBase();` with:

```js
    const base = hero.y;
```

- [ ] **Step 11: Draw the platforms**

Directly before `function drawStar(s){` (line 1478) insert:

```js
  /* No Math.random() in here — shimmer comes from the frame counter, or the
     ground-lane fingerprint test breaks on the render path. */
  function drawPlatform(p){
    const lv = L();
    ctx.fillStyle = lv.block.b;
    roundRect(p.x, p.y, p.w, TUNE.platThick, 6); ctx.fill();
    ctx.fillStyle = lv.block.a;
    roundRect(p.x, p.y, p.w, TUNE.platThick*.6, 6); ctx.fill();
    ctx.fillStyle = lv.line;
    ctx.globalAlpha = .5 + Math.sin(t*.04 + p.x*.01)*.2;
    ctx.fillRect(p.x+4, p.y, p.w-8, 2);
    ctx.globalAlpha = 1;
  }
```

- [ ] **Step 12: Render them behind the actors**

In `render()`, replace line 2290:

```js
    for (const s of stars) drawStar(s);
```

with:

```js
    for (const p of platforms) drawPlatform(p);
    for (const s of stars) drawStar(s);
```

- [ ] **Step 13: Run the sky lane tests**

Run: `node test/smoke.js "sky lane"`
Expected: all pass. The gold-star reachability test will still fail — gold stars are not collectible until Task 5. That is expected; it passes at the end of Task 5.

- [ ] **Step 14: Run the ground-lane baseline**

Run: `node test/smoke.js "byte-identical"`
Expected: `all 1 passed`. **This is the critical gate for this task.** If it fails, something in the platform code is drawing from `Math.random()` — check `spawnCluster` and `drawPlatform` first.

- [ ] **Step 15: Commit**

```bash
git add games/oliver-run/index.html test/smoke.js
git commit -m "feat(oliver-run): optional two-tier sky lane

One-way platforms at GROUND-130 and GROUND-260, sized against the ~152px jump
apex every level shares. heroBase() becomes a dynamic landingY() keyed off foot
position. Clusters spawn only during the run phase, so Boss Rush is unaffected.
Falling off costs nothing. All sky randomness uses a dedicated PRNG so the
ground-lane fingerprint is untouched."
```

---

### Task 5: Gold stars

**Files:**
- Modify: `games/oliver-run/index.html` — `update()` collection, `drawPlatform` area
- Modify: `test/smoke.js`

**Interfaces:**
- Consumes: `platforms[].star` from Task 4, `TUNE.goldPoints`/`goldCharge`/`goldLift`
- Produces: `drawGoldStar(x, y)`

- [ ] **Step 1: Add collection**

In `update(dt)`, directly after the platform scroll/filter block added in Task 4 Step 9, insert:

```js
    /* Gold stars ride their platform, so they are always exactly as reachable
       as the platform is. burst() draws from Math.random(), but collecting one
       requires leaving the ground, so a grounded run never reaches it. */
    for (const p of platforms){
      if (!p.star || p.star.got) continue;
      const sx = p.x + p.star.dx, sy = p.y - TUNE.goldLift;
      if (Math.hypot(sx - hero.x, sy - hcy) < 44*Math.max(1, hs)){
        p.star.got = true;
        points += TUNE.goldPoints;
        burst(sx, sy, ['#FFD23D','#FFF3D6','#FFFFFF'], 22, 7);
        pop(sx, sy-26, '+'+TUNE.goldPoints, '#FFD23D', 32);
        sfx.star(); addCharge(TUNE.goldCharge); bumpCombo();
      }
    }
```

This must be placed **after** `hcy` and `hs` are defined (line ~956-960), so put it immediately after the `const sup = superT>0;` line rather than with the scroll code. Move the scroll/filter lines from Task 4 Step 9 down to join it if needed — they must run in the same block.

- [ ] **Step 2: Draw the gold star**

Add after `drawPlatform`:

```js
  function drawGoldStar(x, y){
    ctx.save();
    ctx.translate(x, y + Math.sin(t*.05 + x*.01)*6);
    ctx.rotate(Math.sin(t*.02 + x*.01)*.3);
    const g = ctx.createRadialGradient(0,0,3,0,0,40);
    g.addColorStop(0,'rgba(255,230,120,.75)');
    g.addColorStop(1,'rgba(255,210,61,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0,0,40,0,7); ctx.fill();
    ctx.fillStyle = '#FFD23D'; ctx.beginPath();
    for (let i=0;i<10;i++){ const r = i%2?9:22, a = -Math.PI/2 + i*Math.PI/5;
      ctx[i?'lineTo':'moveTo'](Math.cos(a)*r, Math.sin(a)*r); }
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#FFF3D6'; ctx.lineWidth = 2; ctx.stroke();
    ctx.restore();
  }
```

- [ ] **Step 3: Render it**

In `render()`, extend the platform loop added in Task 4 Step 12:

```js
    for (const p of platforms){
      drawPlatform(p);
      if (p.star && !p.star.got) drawGoldStar(p.x + p.star.dx, p.y - TUNE.goldLift);
    }
```

- [ ] **Step 4: Run the reachability test**

Run: `node test/smoke.js "unreachable without"`
Expected: `all 1 passed` — the climbing run now scores at least 15% better than the grounded one.

- [ ] **Step 5: Add the test that isolates glide**

Gold stars make altitude observable through the score, which is what finally
allows a direct measurement of the glide deferred from Task 3. Two runs, same
seed, same jump cadence, differing **only** in whether the button is held:

```js
/* The one test that isolates the glide itself. Identical seed and identical
   jump cadence, so the only variable is the hold. Extra hang time means more
   gold stars lined up and collected, which shows up in the score. */
test('glide measurably improves sky lane collection', note => {
  const run = held => {
    const h = createHarness('oliver-run', { seed: 44 });
    h.tap();
    if (held) h.hold(true);
    for (let i = 0; i < 9000; i++) {
      if (i % 3 === 0) h.pad('a');
      h.frames(1);
    }
    const score = h.num('score');
    h.dispose();
    return score;
  };
  const without = run(false);
  const with_ = run(true);
  note(`no glide ${without} vs glide ${with_}`);
  assert(with_ > without,
    `holding should collect more: ${without} -> ${with_}`);
});
```

Run: `node test/smoke.js "measurably improves"`
Expected: `all 1 passed`. If the two scores are identical, `holding` is never reaching the physics step — check the `onHold` wiring from Task 3 Step 4.

- [ ] **Step 6: Run the ground-lane baseline again**

Run: `node test/smoke.js "byte-identical"`
Expected: `all 1 passed`. Gold stars call `burst()`, which uses `Math.random()` — this test proves a grounded run never triggers it.

- [ ] **Step 7: Run the whole suite**

Run: `node test/smoke.js`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add games/oliver-run/index.html test/smoke.js
git commit -m "feat(oliver-run): gold stars on the sky lane

Worth 5x a normal star and charging SUPER faster via the existing addCharge
path. They ride their platform, so they are exactly as reachable as it is.
Drawing derives shimmer from the frame counter, never Math.random()."
```

---

### Task 6: Rollout

**Files:**
- Modify: `sw.js:3`
- Modify: `CLAUDE.md` (TUNE pointer)

- [ ] **Step 1: Bump the service worker cache**

In `sw.js`, change line 3 from `const CACHE = 'arcade-v1';` to `const CACHE = 'arcade-v2';`

Skipping this means phones keep serving v1 and it looks like nothing shipped. `CLAUDE.md` calls this the single most common way to waste an hour here.

- [ ] **Step 2: Confirm both scripts still parse**

```bash
node --check shared/kidkit.js && echo "kidkit OK"
node -e "const fs=require('fs');const m=/<script>([\s\S]*?)<\/script>/.exec(fs.readFileSync('games/oliver-run/index.html','utf8'));new (require('vm').Script)(m[1]);console.log('game OK')"
```

Expected: `kidkit OK` then `game OK`.

- [ ] **Step 3: Full suite**

Run: `node test/smoke.js`
Expected: every test passes, including `ground lane is byte-identical`.

- [ ] **Step 4: Document the TUNE block**

In `CLAUDE.md`, under "How to verify changes", add:

```markdown
Feel values for the sky lane and glide all live in the `TUNE` object at the top
of `games/oliver-run/index.html`. Change those rather than hunting through the
game loop. Anything sky-lane related must draw from `skyRnd`, never
`Math.random()`, or the ground-lane regression test in `test/smoke.js` fails.
```

- [ ] **Step 5: Commit and push**

```bash
git add sw.js CLAUDE.md
git commit -m "chore: bump service worker cache to arcade-v2 for the high road"
git push origin main
```

- [ ] **Step 6: Verify the deploy**

```bash
sleep 30
curl -s -o /dev/null -w "%{http_code}\n" https://mpsmith414.github.io/family-arcade/games/oliver-run/index.html
curl -s https://mpsmith414.github.io/family-arcade/sw.js | grep "const CACHE"
```

Expected: `200`, then `const CACHE = 'arcade-v2';`

- [ ] **Step 7: The checks no harness can make**

On a real phone and the TV:

- Holding a finger on the screen floats — and it feels good, not floaty-slow.
- Hold works on the TV gamepad, and releasing actually stops the float.
- Lock the phone mid-glide, unlock: the hero is not still gliding.
- Emsile can still play the ground lane without noticing anything changed.
- **Oliver reaches for the sky lane without being told it exists.** If he doesn't, the reward is not readable enough from the ground — raise `goldLift` or make the star bigger before touching anything else.

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| 1. KidKit hold support (ES5, blur, union of sources) | Task 2 |
| 2. Glide (clamps descent, never gains height, dog inactive, trail flag) | Task 3 |
| 3. Sky lane (two tiers, one-way, foot position, run phase only, clusters) | Task 4 |
| 4. Gold stars (5×, faster SUPER, sky lane only) | Task 5 |
| 5. Separate PRNG + exact regression + harness `hold()` | Tasks 1, 4, 5 |
| 6. TUNE block, version bumps, rollout | Tasks 3, 2, 6 |
| 7. Out of scope | No tasks — correct |

All nine acceptance criteria map to a step. Criterion 9 (`KidKit.version` 1.1.0, `CACHE` arcade-v2) is split across Task 2 Step 8 and Task 6 Step 1.

**Known wrinkle carried forward:** Task 3 Step 8 flags that `holdJump()` alternates press/release each frame, so the endurance and boss-rush tests will exercise a flickering glide rather than a sustained one. Their assertions are thresholds, not exact values, so they should hold — but if boss rush overruns its frame cap, that is the cause.

**Glide observability, and why the tests are arranged this way.** Glide writes nothing to the DOM, and oscillator counts cannot substitute for jump detection because the music engine emits oscillators continuously — a fact established while building the harness. So the glide is pinned down in three complementary places rather than one:

1. Task 3 proves it is **inert on the ground**, as an exact fingerprint match. This is the strongest available statement that Emsile's game is untouched by the new mechanic.
2. Task 3 proves holding through 6,000 frames of jumping **throws nothing**.
3. Task 5 proves it **does something**, once gold stars make altitude visible in the score: two runs, same seed, same jump cadence, differing only in the hold.

Test 3 is the one that fails if the glide is silently not wired up, and it cannot exist before Task 5. An implementer stopping after Task 3 has an unverified glide — that is expected and is why Task 5 carries the assertion.

**Ordering constraint:** Task 5 Step 1 must place the gold-star collection block after `hcy` and `hs` are in scope. Task 4 Step 9 puts platform scrolling earlier in `update()`; if the collection block cannot see those variables, move the scroll and filter lines down to sit with it.
