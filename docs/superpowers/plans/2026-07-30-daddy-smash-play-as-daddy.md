# Play as Daddy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Daddy a third swappable character in Daddy Smash, so you can chase the kids instead of running from them, with the existing smash set piece firing automatically on a catch.

**Architecture:** `playerIdx` widens from `0 | 1` to `0 | 1 | 2`, where 2 is Daddy, and the `daddy` object gains a `def` of the same shape the kids carry so the HUD, storage and swap button work for all three unchanged. `updateDaddy()` splits into a steering source (AI or human) and a shared mode machine; the wind-up, lunge, catch test and near-miss stay common to both, so a human Daddy catches kids the same way the AI does.

**Tech Stack:** Vanilla HTML + CSS + canvas 2D + WebAudio. No build, no npm, no dependencies. Tests are `node test/smoke.js` against the stub-DOM harness in `test/harness.js`.

**Spec:** `docs/superpowers/specs/2026-07-30-daddy-smash-play-as-daddy-design.md`

**Repo:** `C:\Users\Matt\Documents\_Code\Projects\KidsGamesApp` (the `family-arcade` repo). All paths below are relative to that root.

## Global Constraints

Copied from the spec and `CLAUDE.md`. Every task's requirements implicitly include these.

- **Daddy Smash has no buttons at all, only steering.** Nothing in this change may become a button. The lunge fires automatically.
- **No fail states.** Nothing kills anybody; there is no game over.
- **A kid who mashes or flails is never worse off than one who doesn't.**
- **No build step, no npm, no dependencies, no framework.** Vanilla HTML/CSS/canvas/WebAudio.
- **Never use `localStorage`/`sessionStorage` directly** — go through `KidKit.storage`.
- **Never use `window.storage`** — Claude-artifact-only API, fails silently in real browsers.
- **Relative paths only** — the site is served from `/family-arcade/`.
- **`shared/kidkit.js` stays ES5-safe.** This change does not touch it; keep it that way.
- **Scoring is unchanged.** Same `slams` counter, same shared `daddy-smash-best` key. Do **not** add a second record key.
- **`sw.js` `CACHE` → `arcade-v7`** before shipping (Task 7).
- Existing daddy tests must pass unmodified, with exactly one exception: `daddy: swapping which kid you are` (Task 5). Any other failing daddy test is a defect in the change, not a test to update.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `games/daddy-smash/index.html` | Modify | The whole game — markup, CSS, and the inline game script. This game is one file by project convention; do not split it. |
| `test/smoke.js` | Modify | Add six tests to the daddy block; rewrite one existing swap test. |
| `sw.js` | Modify | Cache version bump, Task 7. |

No new files. `shared/kidkit.js` and `test/harness.js` are **not** touched — everything needed already exists in both.

---

### Task 1: Daddy is a person the game can name

Gives `daddy` a `def` object and widens `playerIdx` to three, so Daddy can be chosen on the menu and remembered. After this task Daddy is selectable but still AI-driven — the game plays itself while you watch, which is a valid intermediate state and must not throw.

**Files:**
- Modify: `games/daddy-smash/index.html` (markup ~239-242, CSS ~174, script 432-433, 448-455, 476-479, 528-538, 822-832, 839-848)
- Test: `test/smoke.js` (daddy block, insert after the `daddy: choosing Emsile on the menu sticks across a reload` test, ~line 1178)

**Interfaces:**
- Produces: `DADDY_DEF` (`{id:'daddy', name:'Daddy', face:'🧔'}`); `PICKS` (`['oliver','emsile','daddy']`); `atIdx(i)` → entity; `player()` → entity; `nextIdx()` → `0|1|2`. Removes `other()`.
- Consumes: nothing from earlier tasks.

- [ ] **Step 1: Write the failing test**

In `test/smoke.js`, after the `daddy: choosing Emsile on the menu sticks across a reload` test:

```js
test('daddy: choosing Daddy on the menu sticks across a reload', note => {
  let h = createHarness('daddy-smash', { seed: 9 });
  h.click('pickDaddy');
  h.click('startBtn');
  pump(h, 30);
  assert(h.text('kidTag') === 'Daddy', `picking Daddy did not take, got "${h.text('kidTag')}"`);
  assert(h.store['daddy-smash-kid'] === 'daddy', `storage says "${h.store['daddy-smash-kid']}"`);

  h = h.reload();
  assert(h.text('kidTag') === 'Daddy', `after reload the game forgot, showing "${h.text('kidTag')}"`);
  assert(!h.hidden('startScreen'), 'reload should land back on the menu');
  note('Daddy remembered across a reload');
  return h;
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node test/smoke.js daddy
```

Expected: FAIL on the new test — the harness cannot find `pickDaddy` because the button does not exist yet.

- [ ] **Step 3: Add the third pick button and let the picker wrap**

In `games/daddy-smash/index.html`, replace the picker markup:

```html
    <div class="picker">
      <button class="pick" id="pickOliver" aria-pressed="true" aria-label="Play as Oliver"><b>🧒</b><span>Oliver</span></button>
      <button class="pick" id="pickEmsile" aria-pressed="false" aria-label="Play as Emsile"><b>👧</b><span>Emsile</span></button>
    </div>
```

with:

```html
    <div class="picker">
      <button class="pick" id="pickOliver" aria-pressed="true" aria-label="Play as Oliver"><b>🧒</b><span>Oliver</span></button>
      <button class="pick" id="pickEmsile" aria-pressed="false" aria-label="Play as Emsile"><b>👧</b><span>Emsile</span></button>
      <button class="pick" id="pickDaddy" aria-pressed="false" aria-label="Play as Daddy and chase the kids"><b>🧔</b><span>Daddy</span></button>
    </div>
```

Three buttons can overflow a narrow phone, so let them wrap. Replace the CSS rule:

```css
  .picker{display:flex;gap:14px;margin-top:4px}
```

with:

```css
  .picker{display:flex;gap:14px;margin-top:4px;flex-wrap:wrap;justify-content:center}
```

- [ ] **Step 4: Give Daddy a `def`**

After the `DADDY` palette constant:

```js
  const DADDY = { skin:'#EEB88A', hair:'#4A3524', shirt:'#4FD16A', shirt2:'#2C8C4E',
                  legs:'#3B4A6B', shoe:'#5A3B22' };
```

add:

```js
  /* Daddy carries the same `def` shape the kids do, so the HUD, the swap
     button, the landmark tag and the storage write all work for all three
     without any of them knowing who is who. */
  const DADDY_DEF = { id:'daddy', name:'Daddy', face:'🧔' };
```

- [ ] **Step 5: Put `def` and `hop` on the daddy object**

Replace the `daddy` literal in `resetCast()`:

```js
    daddy = {
      x:50, z:34, vx:0, vz:0, dir:1, run:0, r:DAD_R,
      mode:'walk', timer:0, lungeCd:70, lx:0, lz:1, stomp:0, flop:0,
      chase:null, chaseCd:0, prefer:0,
    };
```

with:

```js
    daddy = {
      def:DADDY_DEF, x:50, z:34, vx:0, vz:0, dir:1, run:0, r:DAD_R,
      mode:'walk', timer:0, lungeCd:70, lx:0, lz:1, stomp:0, flop:0,
      chase:null, chaseCd:0, prefer:0, hop:0,
    };
```

`hop:0` is required, not cosmetic: `press()` tests `p.hop <= 0`, and `undefined <= 0` is `false`, so without the field a tap while playing as Daddy would silently do nothing. Task 6 draws it.

- [ ] **Step 6: Widen the cast lookup**

Replace:

```js
  const savedKid = KidKit.storage.get('daddy-smash-kid', 'oliver');
  playerIdx = Math.max(0, KIDS.findIndex(k => k.id === savedKid));
  const player = () => kids[playerIdx];
  const other  = () => kids[1 - playerIdx];
```

with:

```js
  /* Index 2 is Daddy. `player()` stays a function because resetCast() rebuilds
     the kids array on every startGame() — a cached entity would go stale. */
  const PICKS = [KIDS[0].id, KIDS[1].id, DADDY_DEF.id];
  const savedKid = KidKit.storage.get('daddy-smash-kid', 'oliver');
  playerIdx = Math.max(0, PICKS.indexOf(savedKid));
  const atIdx   = i => i === 2 ? daddy : kids[i];
  const player  = () => atIdx(playerIdx);
  const nextIdx = () => (playerIdx + 1) % 3;
```

`Math.max(0, …)` keeps the existing fall-back-to-Oliver behaviour on an unrecognised stored value.

- [ ] **Step 7: Point the HUD at the new helpers**

`other()` no longer exists. In `updateHud()`, replace:

```js
    el.kidTag.textContent = player().def.name;
    el.swapFace.textContent = other().def.face;
    el.swap.setAttribute('aria-label', 'Play as ' + other().def.name + ' instead');
```

with:

```js
    const next = atIdx(nextIdx());
    el.kidTag.textContent = player().def.name;
    el.swapFace.textContent = next.def.face;
    el.swap.setAttribute('aria-label', 'Play as ' + next.def.name + ' instead');
```

- [ ] **Step 8: Wire the third pick button**

Replace:

```js
  document.getElementById('pickOliver').addEventListener('click', e => { e.stopPropagation(); pickKid(0); });
  document.getElementById('pickEmsile').addEventListener('click', e => { e.stopPropagation(); pickKid(1); });
  function pickKid(i){
    playerIdx = i;
    KidKit.storage.set('daddy-smash-kid', KIDS[i].id);
    document.getElementById('pickOliver').setAttribute('aria-pressed', String(i === 0));
    document.getElementById('pickEmsile').setAttribute('aria-pressed', String(i === 1));
    sfx.swap();
    updateHud();
  }
```

with:

```js
  document.getElementById('pickOliver').addEventListener('click', e => { e.stopPropagation(); pickKid(0); });
  document.getElementById('pickEmsile').addEventListener('click', e => { e.stopPropagation(); pickKid(1); });
  document.getElementById('pickDaddy').addEventListener('click', e => { e.stopPropagation(); pickKid(2); });
  function pickKid(i){
    playerIdx = i;
    KidKit.storage.set('daddy-smash-kid', PICKS[i]);
    document.getElementById('pickOliver').setAttribute('aria-pressed', String(i === 0));
    document.getElementById('pickEmsile').setAttribute('aria-pressed', String(i === 1));
    document.getElementById('pickDaddy').setAttribute('aria-pressed', String(i === 2));
    sfx.swap();
    updateHud();
  }
```

- [ ] **Step 9: Stop `startGame()` preferring a player who isn't a kid**

`daddy.prefer` is an index into `kids`, and means "come for the player first". Replace in `startGame()`:

```js
    daddy.prefer = playerIdx;                 // he comes for the player first
```

with:

```js
    // he comes for the player first — unless the player is him
    daddy.prefer = playerIdx === 2 ? 0 : playerIdx;
```

- [ ] **Step 10: Run the test to verify it passes**

```bash
node test/smoke.js daddy
```

Expected: PASS, all daddy tests green including the new one.

- [ ] **Step 11: Commit**

```bash
git add games/daddy-smash/index.html test/smoke.js && git commit -m "feat(daddy-smash): Daddy is a third pick on the menu"
```

---

### Task 2: Steering Daddy

Hands Daddy's walking to the player. The lunge still aims at the AI's committed target — Task 3 fixes that. After this task you can walk Daddy round the room.

**Files:**
- Modify: `games/daddy-smash/index.html` (script 915-992, `updateDaddy`)
- Test: `test/smoke.js` (daddy block)

**Interfaces:**
- Consumes: `playerIdx`, `player()` from Task 1.
- Produces: a `human` local inside `updateDaddy()` (`playerIdx === 2 && state === 'play'`), used again in Task 3.

- [ ] **Step 1: Write the failing test**

In `test/smoke.js`, in the daddy block after the steering tests:

```js
/* 1200 frames, not the 500 the kid steering tests use: DAD_WALK is 0.53
   against KID_SPEED 0.72, and a set piece marches him back across the room
   mid-run. Reaching the plant at all is the question, not how fast. */
test('daddy: steering Daddy walks him across the room', note => {
  const h = createHarness('daddy-smash', { seed: 11 });
  h.click('pickDaddy');
  h.click('startBtn');
  pump(h, 5);
  h.keyDown('ArrowLeft');
  const seen = new Set();
  for (let i = 0; i < 1200; i++) { pump(h, 1); seen.add(h.text('whereTag')); }
  assert(seen.has(SPOTS.plant), `holding left never walked Daddy to the plant: ${[...seen].join(', ')}`);
  note(`Daddy reached ${[...seen].join(' / ')}`);
  return h;
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node test/smoke.js daddy
```

Expected: FAIL — `holding left never walked Daddy to the plant`. Daddy is still chasing kids on his own and ignores the arrow key.

- [ ] **Step 3: Branch the walk steering on who is driving**

In `updateDaddy()`, replace the target-selection block:

```js
    if (!daddy.chase || daddy.chase.held || daddy.chase.safe > 0 || daddy.chaseCd <= 0){
      daddy.chase = pickTarget();
      daddy.chaseCd = rnd(420, 700);
    }
    daddy.chaseCd -= dt;
    const target = daddy.chase;
```

with:

```js
    const human = playerIdx === 2 && state === 'play';

    if (!daddy.chase || daddy.chase.held || daddy.chase.safe > 0 || daddy.chaseCd <= 0){
      daddy.chase = pickTarget();
      daddy.chaseCd = rnd(420, 700);
    }
    daddy.chaseCd -= dt;
    const target = daddy.chase;
```

Then replace the `walk` branch:

```js
    if (daddy.mode === 'walk'){
      daddy.lungeCd -= dt;
      if (d < 24 && daddy.lungeCd <= 0 && target.safe <= 0){
        daddy.mode = 'wind'; daddy.timer = 20;
        daddy.lx = dx/d; daddy.lz = dz/d;
        sfx.wind();
      } else {
        // aim a little ahead of where they are going, so corners get cut
        const lead = 9;
        const av = avoidance(daddy, 3);
        const ax = dx/d + target.vx*lead + av.x*1.2;
        const az = dz/d + target.vz*lead + av.z*1.2;
        move(daddy, ax, az, DAD_WALK*boost*slow, dt);
      }
    }
```

with:

```js
    if (daddy.mode === 'walk'){
      daddy.lungeCd -= dt;
      if (d < 24 && daddy.lungeCd <= 0 && target.safe <= 0){
        daddy.mode = 'wind'; daddy.timer = 20;
        daddy.lx = dx/d; daddy.lz = dz/d;
        sfx.wind();
      } else if (human){
        // no corner-cutting help: a human is doing the aiming
        const s = playerSteer();
        move(daddy, s.x, s.z, DAD_WALK*boost*slow, dt);
      } else {
        // aim a little ahead of where they are going, so corners get cut
        const lead = 9;
        const av = avoidance(daddy, 3);
        const ax = dx/d + target.vx*lead + av.x*1.2;
        const az = dz/d + target.vz*lead + av.z*1.2;
        move(daddy, ax, az, DAD_WALK*boost*slow, dt);
      }
    }
```

The `wind` and `lunge` branches are untouched: the player deliberately has no steering during the wind-up and the lunge, which is what makes a near miss read as a near miss.

- [ ] **Step 4: Run the test to verify it passes**

```bash
node test/smoke.js daddy
```

Expected: PASS, all daddy tests green.

- [ ] **Step 5: Commit**

```bash
git add games/daddy-smash/index.html test/smoke.js && git commit -m "feat(daddy-smash): the player can steer Daddy"
```

---

### Task 3: The auto-lunge

The point of the whole change. A human Daddy lunges at the kid they have actually run up to, not at whoever the AI committed to 400 frames ago.

**Files:**
- Modify: `games/daddy-smash/index.html` (script, `updateDaddy` and a new helper beside `pickTarget()` at ~908)
- Test: `test/smoke.js` (daddy block)
- Scratch (not committed): a probe script under the session scratchpad

**Interfaces:**
- Consumes: `human` from Task 2.
- Produces: `nearestCatchable()` → a kid entity, never null.

- [ ] **Step 1: Measure before asserting**

The kids are deliberately not in the DOM, so a test cannot steer *at* them — it can only drive a fixed pattern and count catches. Guessing a frame budget makes a flaky test. Measure it first.

Write this to the scratchpad (not the repo) as `probe-daddy.js`, and run it from the repo root **after** Step 3's implementation is in place:

```js
const { createHarness } = require('./test/harness');
const legs = [[1, 0], [0, -1], [-1, 0], [0, 1]];
for (const seed of [3, 9, 11, 17, 23, 42, 77]) {
  const h = createHarness('daddy-smash', { seed });
  h.click('pickDaddy');
  h.click('startBtn');
  let first = null;
  for (let i = 0; i < 12000; i++) {
    if (i % 90 === 0) { const [x, y] = legs[(i / 90) % legs.length]; h.stick(x, y); }
    h.frames(1);
    if (first === null && h.num('slams') > 0) first = i;
  }
  console.log(`seed ${seed}: first catch at ${first}, ${h.num('slams')} total`);
}
```

Record the worst first-catch frame across the seven seeds. The test in Step 2 uses **double** that, rounded up to a round number, and its comment records the measured numbers. If some seed never catches at all, that is a real finding — the auto-lunge is not doing its job and the design needs revisiting before the test is written.

- [ ] **Step 2: Write the failing test**

Write it with 6000 as the starting budget, then reconcile against the probe in Step 6: if the measured worst case is under 3000 the number stands as-is; otherwise raise it to double the measured worst case. Either way, replace the comment's second sentence with the actual per-seed numbers the probe printed, so the next person can see where the budget came from.

```js
/* A blind driver: it laps the room and never reacts to where the kids are,
   so this measures "can a steered Daddy catch anybody at all", not skill.
   Budget is double the worst first-catch across seeds 3/9/11/17/23/42/77.
   Measured: (record the probe output here). */
test('daddy: chasing as Daddy catches a kid, with no button pressed', note => {
  const CHASE_FRAMES = 6000;
  const h = createHarness('daddy-smash', { seed: 23 });
  h.click('pickDaddy');
  h.click('startBtn');         // the only click; h.tap() is never called again
  pump(h, 5);
  lapTheRoom(h, CHASE_FRAMES);
  const slams = h.num('slams');
  assert(slams > 0, `${CHASE_FRAMES} frames of chasing as Daddy caught nobody`);
  assert(/got smashed/i.test(h.text('catchLine')), `no smash shout, got "${h.text('catchLine')}"`);
  note(`${slams} smashes as Daddy, steering only`);
  return h;
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
node test/smoke.js daddy
```

Expected: FAIL or PASS-by-luck. Either way, note the smash count — Step 5 must improve it. If it passes here, the lunge is firing at the AI's committed target while you happen to be near it; the test only becomes meaningful after Step 5.

- [ ] **Step 4: Add the nearest-catchable helper**

Beside `pickTarget()`:

```js
  /* Who a human Daddy is aiming at. The AI commits to one kid for a few
     hundred frames so the little sister gets a turn even when the controller
     is put down; a player is looking at the screen, so aim at whoever they
     have actually run up to. Falls back to the nearest kid at all, so the
     caller never has to handle a null target. */
  function nearestCatchable(){
    let bestK = null, bestD = Infinity, anyK = null, anyD = Infinity;
    for (const k of kids){
      if (k.held) continue;
      const d = dist(daddy, k);
      if (d < anyD){ anyD = d; anyK = k; }
      if (k.safe <= 0 && d < bestD){ bestD = d; bestK = k; }
    }
    return bestK || anyK || kids[0];
  }
```

- [ ] **Step 5: Aim the lunge with it**

Replace the target-selection block written in Task 2:

```js
    const human = playerIdx === 2 && state === 'play';

    if (!daddy.chase || daddy.chase.held || daddy.chase.safe > 0 || daddy.chaseCd <= 0){
      daddy.chase = pickTarget();
      daddy.chaseCd = rnd(420, 700);
    }
    daddy.chaseCd -= dt;
    const target = daddy.chase;
```

with:

```js
    const human = playerIdx === 2 && state === 'play';

    let target;
    if (human){
      target = nearestCatchable();
    } else {
      if (!daddy.chase || daddy.chase.held || daddy.chase.safe > 0 || daddy.chaseCd <= 0){
        daddy.chase = pickTarget();
        daddy.chaseCd = rnd(420, 700);
      }
      daddy.chaseCd -= dt;
      target = daddy.chase;
    }
```

`daddy.chase`, `daddy.chaseCd` and `pickTarget()` stay exactly as they are for the AI path.

- [ ] **Step 6: Re-run the probe and finalise the budget**

```bash
node probe-daddy.js
```

(run from the repo root, with the scratchpad path). Update `CHASE_FRAMES` and the test's comment with the real measurements.

- [ ] **Step 7: Run the tests to verify they pass**

```bash
node test/smoke.js daddy
```

Expected: PASS, all daddy tests green.

- [ ] **Step 8: Commit**

```bash
git add games/daddy-smash/index.html test/smoke.js && git commit -m "feat(daddy-smash): a steered Daddy lunges at the nearest kid"
```

---

### Task 4: Both kids stay on the run

Proves neither kid is left standing still when nobody is driving them — the failure mode that would make chasing pointless.

**Files:**
- Test only: `test/smoke.js` (daddy block)

**Interfaces:**
- Consumes: everything from Tasks 1-3. No production code should need changing; if it does, that is the finding.

- [ ] **Step 1: Write the test**

```js
/* The mirror of "both kids get smashed, not just the one you drive": when
   you are Daddy, nobody is driving either kid, so both must be fleeing on
   autopilot. A kid left standing still would be caught constantly and the
   other never — the shout names them, so the DOM can tell us. */
test('daddy: as Daddy, both kids are still on the run', note => {
  const h = createHarness('daddy-smash', { seed: 17 });
  h.click('pickDaddy');
  h.click('startBtn');
  pump(h, 5);
  const legs = [[1, 0], [0, -1], [-1, 0], [0, 1]];
  const seen = new Set();
  for (let i = 0; i < 12000 && seen.size < 2; i++) {
    if (i % 90 === 0) { const [x, y] = legs[(i / 90) % legs.length]; h.stick(x, y); }
    pump(h, 1);
    const m = /^(\w+) got smashed/i.exec(h.text('catchLine'));
    if (m) seen.add(m[1]);
  }
  assert(seen.has('Oliver'), `Oliver never got caught: saw ${[...seen].join(', ') || 'nobody'}`);
  assert(seen.has('Emsile'), `Emsile never got caught: saw ${[...seen].join(', ') || 'nobody'}`);
  note(`caught both within ${h.frameCount} frames`);
  return h;
});
```

- [ ] **Step 2: Run it**

```bash
node test/smoke.js daddy
```

Expected: PASS. If it fails because only one kid is ever caught, `nearestCatchable()` is starving one of them — check that the `safe` window is being respected, and do **not** fix it by weakening the assertion.

If 12000 frames turns out to be tight, raise the budget using the probe from Task 3 rather than guessing.

- [ ] **Step 3: Commit**

```bash
git add test/smoke.js && git commit -m "test(daddy-smash): both kids flee while you are Daddy"
```

---

### Task 5: The 🔁 button cycles all three

**Files:**
- Modify: `games/daddy-smash/index.html` (markup ~221, script `swapKid` ~812)
- Modify: `test/smoke.js:1141` — the one existing test this change legitimately breaks

**Interfaces:**
- Consumes: `nextIdx()` from Task 1.

- [ ] **Step 1: Rewrite the existing swap test**

`daddy: swapping which kid you are` asserts Oliver → X → Emsile → 🔁 → **Oliver**. Under a three-way cycle the second swap lands on Daddy, so it fails by design. Replace the whole test with:

```js
test('daddy: swapping who you are cycles all three', note => {
  const h = createHarness('daddy-smash', { seed: 12 });
  h.tap();
  pump(h, 60);
  assert(h.text('kidTag') === 'Oliver', `expected to start as Oliver, got "${h.text('kidTag')}"`);

  // X on a pad — the one button in the kit that isn't a jump
  h.padPress('x');
  pump(h, 12);
  assert(h.text('kidTag') === 'Emsile', 'gamepad X did not swap to Emsile');

  // and the button on the kid's side of the screen does the same
  h.click('swapBtn');
  pump(h, 12);
  assert(h.text('kidTag') === 'Daddy', 'the swap button did not carry on to Daddy');

  h.click('swapBtn');
  pump(h, 12);
  assert(h.text('kidTag') === 'Oliver', 'the cycle did not come back round to Oliver');

  // the game carries on, and whoever you are can still be caught
  const before = h.num('slams');
  pump(h, 2500);
  assert(h.num('slams') > before, 'the chase stopped after swapping');
  note(`cycled all three, ${h.num('slams')} smashes total`);
  return h;
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
node test/smoke.js daddy
```

Expected: FAIL — `the swap button did not carry on to Daddy`. `swapKid()` still flips between two.

- [ ] **Step 3: Make the swap cycle**

Replace:

```js
  function swapKid(){
    if (state !== 'play') return;
    playerIdx = 1 - playerIdx;
```

with:

```js
  function swapKid(){
    if (state !== 'play') return;
    playerIdx = nextIdx();
```

The rest of the function is unchanged — `player().def.id` already writes the right value for all three, and `puffAt(player().x, …)` works on Daddy.

- [ ] **Step 4: Fix the button's resting label**

`updateHud()` overwrites this on every frame, but the markup default is what a screen reader sees before the first update. Replace:

```html
  <button id="swapBtn" aria-label="Play as the other kid">
```

with:

```html
  <button id="swapBtn" aria-label="Play as somebody else">
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
node test/smoke.js daddy
```

Expected: PASS, all daddy tests green.

- [ ] **Step 6: Commit**

```bash
git add games/daddy-smash/index.html test/smoke.js && git commit -m "feat(daddy-smash): the swap button cycles Oliver, Emsile and Daddy"
```

---

### Task 6: Seeing yourself — the ring, the hop, and the wiggle

Three small pieces of feel. None can be asserted against a no-op canvas, so this task is verified in a real browser as well as by the suite.

**Files:**
- Modify: `games/daddy-smash/index.html` (script 705, 776-781, `updateDaddy` top, `drawDaddy` 1566-1589, start-screen copy ~238)

**Interfaces:**
- Consumes: `playerIdx`, `player()` from Task 1; `daddy.hop` from Task 1 Step 5.

- [ ] **Step 1: Draw the "this is you" ring under Daddy**

`drawKid()` draws a pulsing yellow ring under whoever the player is driving. Daddy needs the same or you lose yourself the moment you swap. In `drawDaddy()`, after the `ctx.restore()` that closes the figure and **before** the wind-up marker block, insert:

```js
    // the same ring the kids get, so you never lose yourself
    if (playerIdx === 2 && state === 'play'){
      ctx.strokeStyle = 'rgba(255,210,61,' + (0.55 + Math.sin(t*0.12)*0.2) + ')';
      ctx.lineWidth = 3;
      ellipse(p.x, p.y, 24*p.s, 9*p.s); ctx.stroke();
    }
```

Sized off Daddy's shadow (17) against a kid's (12), so 24/9 against the kid ring's 17/6.5.

- [ ] **Step 2: Let Daddy hop**

Decay the timer. At the very top of `updateDaddy()`, **before** the `dizzy` early return so it keeps ticking while he sees stars:

```js
  function updateDaddy(dt){
    if (daddy.hop > 0) daddy.hop -= dt;
    if (daddy.mode === 'dizzy'){
```

Then draw it. In `drawDaddy()`, replace:

```js
  function drawDaddy(){
    const p = proj(daddy.x, daddy.z);
    const cfg = Object.assign({ belly:true, beard:true }, DADDY);
    shadow(daddy.x, daddy.z, 17);

    ctx.save();
    ctx.translate(p.x, p.y);
```

with:

```js
  function drawDaddy(){
    const p = proj(daddy.x, daddy.z);
    const cfg = Object.assign({ belly:true, beard:true }, DADDY);
    const hop = daddy.hop > 0 ? Math.sin((1 - daddy.hop/16)*Math.PI)*16 : 0;
    shadow(daddy.x, daddy.z, 17);

    ctx.save();
    ctx.translate(p.x, p.y - hop*p.s);
```

The wind-up `!` and the dizzy stars are drawn outside this transform off `p.y` and deliberately stay put.

- [ ] **Step 3: Keep the raise phase interactive from Daddy's side**

At the `raise` phase of `updateSmash()`, the held kid wriggles harder while the player waggles the controls. Gated on `k === player()`, that goes dead when the player is Daddy. Replace:

```js
      const wiggle = k === player() && state === 'play' ? steerMag() : 0;
```

with:

```js
      // holding a kid over your head counts too, so the wiggle works from
      // whichever side of the smash the player is on
      const wiggle = (k === player() || playerIdx === 2) && state === 'play' ? steerMag() : 0;
```

- [ ] **Step 4: Stop the start screen assuming you are running away**

Replace:

```html
    <p class="sub">Run away from Daddy! When he catches you he smashes you on the couch — then you run free again.</p>
```

with:

```html
    <p class="sub">Run away from Daddy — or be Daddy and chase the kids! Every catch ends in a smash on the couch, then everybody runs free again.</p>
```

- [ ] **Step 5: Run the full suite**

```bash
node test/smoke.js
```

Expected: all tests pass, all three games. The endurance runs are what catch a `ReferenceError` on a draw path, which is exactly the failure mode this task can introduce.

- [ ] **Step 6: Look at it in a real browser**

The harness draws to a no-op canvas and says nothing about whether the art is right. Serve the folder and check, per `CLAUDE.md`:

```bash
python -m http.server 8000
```

Open `http://localhost:8000/games/daddy-smash/`, pick 🧔 Daddy, and confirm: the yellow ring is under Daddy and not under either kid, a tap makes him hop, the `!` wind-up marker still sits above his head rather than bouncing with him, and the start screen's three buttons do not overflow at phone width.

- [ ] **Step 7: Commit**

```bash
git add games/daddy-smash/index.html && git commit -m "feat(daddy-smash): the player ring, the hop and the wiggle follow Daddy"
```

---

### Task 7: Endurance, cache bump, ship

**Files:**
- Test: `test/smoke.js` (daddy block, beside the other endurance tests)
- Modify: `sw.js:3`

- [ ] **Step 1: Write the endurance test**

Beside `daddy: 20000 frames of hard running never throws either`:

```js
test('daddy: 20000 frames as Daddy never throws', note => {
  const h = createHarness('daddy-smash', { seed: 77 });
  h.click('pickDaddy');
  h.click('startBtn');
  pump(h, 5);
  lapTheRoom(h, 20000);
  assert(h.hidden('startScreen'), 'still playing');
  assert(h.timerCount < 50, `timer leak: ${h.timerCount} still pending`);
  note(`${h.num('slams')} smashes as Daddy over 20000 frames`);
  return h;
});
```

- [ ] **Step 2: Run the full suite**

```bash
node test/smoke.js
```

Expected: every test passes, across all three games. In particular the Oliver Run ground-lane fingerprint must still be `449869:a3ed77ff` — this change touches no shared code, so any movement there means something leaked.

- [ ] **Step 3: Bump the service worker cache**

In `sw.js`, replace:

```js
const CACHE = 'arcade-v6';
```

with:

```js
const CACHE = 'arcade-v7';
```

No new files were created, so the `FILES` array is unchanged. Skipping this bump means phones keep serving v6 and it looks like nothing shipped — `CLAUDE.md` calls this the number one time sink.

- [ ] **Step 4: Commit**

```bash
git add test/smoke.js sw.js && git commit -m "feat(daddy-smash): play as Daddy, and bump the cache to v7"
```

- [ ] **Step 5: Ship it**

```bash
git push origin main
```

GitHub Pages rebuilds from `main` in about a minute. Then confirm the live site is actually serving the new build rather than a cached one:

```bash
curl -s "https://mpsmith414.github.io/family-arcade/sw.js" | head -3
```

Expected: `const CACHE = 'arcade-v7';`

- [ ] **Step 6: The check no harness can make**

Play it. Whether chasing actually feels like a chase, and whether a five-year-old can catch anybody at all, is not something the suite can answer.

---

## Notes for the implementer

**Do not "improve" these while you are in there:**

- Scoring. One `slams` counter, one `daddy-smash-best` key, shared by all three characters. The consequence — an adult playing Daddy setting a record the kids cannot beat — was raised and accepted.
- The AI's `pickTarget()` / `daddy.chase` commitment. It exists so the little sister gets a turn when the controller is put down, and it stays for the AI path.
- The hunger speed boost. It stays on for a human driver too; it is the one anti-dry-spell mechanism and a human who is bad at cornering needs it for the same reason the AI does.
- Swapping mid-set-piece. Taking over a character on rails and getting control when it ends is the existing behaviour for a carried kid, and Daddy matches it deliberately. Do not add a guard.
