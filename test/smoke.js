/* ============================================================================
   Smoke test for games/oliver-run, driven through test/harness.js.

     node test/smoke.js            run everything
     node test/smoke.js powers     run only tests whose name matches "powers"

   Everything here is black box: the game is an IIFE with no exports, so the
   assertions read the same stub DOM the game writes to (score, boss name,
   power tag) rather than reaching inside it. Nothing in the game had to
   change to make it testable.
   ========================================================================== */
'use strict';

const { createHarness, disposeAll } = require('./harness');

/* ---------------------------------------------------------------- *
 * tiny test runner
 * ---------------------------------------------------------------- */
const filter = process.argv[2];
const results = [];
let current = null;

function test(name, fn) {
  if (filter && !name.toLowerCase().includes(filter.toLowerCase())) return;
  current = { name, notes: [] };
  const t0 = Date.now();
  try {
    fn(n => { current.notes.push(n); });
    current.ok = true;
  } catch (err) {
    current.ok = false;
    current.err = err;
  } finally {
    // unconditional: a half-torn-down harness would poison the next test
    try { disposeAll(); } catch (e) {}
  }
  current.ms = Date.now() - t0;
  results.push(current);
  const tag = current.ok ? '  ok  ' : ' FAIL ';
  console.log(`[${tag}] ${name}  (${current.ms}ms)`);
  for (const n of current.notes) console.log(`         · ${n}`);
  if (!current.ok) {
    const lines = String(current.err && current.err.stack || current.err).split('\n');
    for (const l of lines.slice(0, 6)) console.log(`         ${l}`);
  }
  current = null;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function assertBetween(v, lo, hi, msg) {
  if (!(v >= lo && v <= hi)) throw new Error(`${msg}: got ${v}, expected ${lo}..${hi}`);
}

/* Run frames and turn any in-game exception into a message that says which
   frame it blew up on — otherwise the stack alone tells you very little. */
function pump(h, n, each) {
  const start = h.frameCount;
  try {
    h.frames(n, each);
  } catch (err) {
    err.message = `frame ${h.frameCount - start + 1} of ${n} (absolute ${h.frameCount}): ${err.message}`;
    throw err;
  }
}

const POWER_NAMES = ['RIDE THE DOG', 'FIRE RING', 'GIANT MODE', 'TINY MODE', 'STAR MAGNET', 'ROCKET BOOTS'];
const POWER_DURATIONS = { 'RIDE THE DOG': 900, 'FIRE RING': 750, 'GIANT MODE': 690, 'TINY MODE': 750, 'STAR MAGNET': 810, 'ROCKET BOOTS': 810 };

/* REGRESSION GUARD — green before and after every task, by design. That is
   the entire point: it proves nothing changed. Do not "fix" it into a
   red-first test; inverting it would destroy the invariance proof.

   Captured from the pre-high-road build. A run with no jump and no hold input
   never leaves the ground, so it can never touch a platform or a gold star —
   which means the sky lane must not perturb this by so much as one RNG draw.
   If this test fails after a sky-lane change, the separate-PRNG rule was
   broken somewhere, most likely in drawing code calling Math.random(). */
const GROUND_BASELINE = { "score": 4658, "level": "Space Station", "trophies": "🏆🏆", "rng": "449869:a3ed77ff" };

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

  // Gamepad is edge-detected inside poll(), so it needs a poll. Use padHold,
  // NOT hold() — hold() also dispatches a pointerdown, which would satisfy
  // this assertion via the pointer path even if pad tracking were deleted.
  h.padHold(true, 0); pads.poll();
  assert(pads.held === true, 'pad button should hold');

  // the case that would otherwise glide forever
  h.blur();
  assert(pads.held === false, 'blur must force-release everything');

  note(seen.join(' '));
  assert(seen.length > 0, 'onHold should have fired');
  return h;
});

/* REGRESSION GUARD — the pad is polled, not event-driven. releaseAll('blur')
   used to clear padHeld to false, but the very next poll() recomputed
   anyDown straight from the still-pressed physical button, saw it differed
   from padHeld, and flipped the hold back on one frame after blur — even
   though the child never re-pressed anything. Keyboard/pointer never have
   this problem because the browser never replays their down-events; only
   the pad resurrects. Fix: blur must latch the pad off until it is observed
   with nothing pressed, at which point a fresh press works normally again. */
test('KidKit: blur latches the pad off until released', note => {
  const h = createHarness('oliver-run', { seed: 5 });
  const seen = [];
  const pads = global.KidKit.input.create({
    element: h.document.getElementById('stage'),
    onHold: (down, src) => seen.push((down ? '+' : '-') + src),
  });

  // padHold() drives ONLY the mock gamepad button — no pointerdown/up side
  // effect — so nothing but the gamepad path can satisfy the assertions
  // below. (A pointer-driven hold() previously masked this: its synthetic
  // pointerup fired syncHold('touch') and made the final assertion pass
  // even when the pad latch itself never cleared.)
  h.padHold(true, 0);
  pads.poll();
  note(`after padHold+poll: held= ${pads.held}`);
  assert(pads.held === true, 'held should be true after padHold+poll');

  h.blur();
  note(`after blur: held= ${pads.held}`);
  assert(pads.held === false, 'held should be false right after blur');

  // the gamepad button is still physically down here — blur cannot reach
  // out and release it, only poll() ever looks at it again.
  pads.poll();
  note(`after blur + next poll(): held= ${pads.held}`);
  assert(pads.held === false,
    'blur must latch the pad off: poll() right after blur must not resurrect the hold from a still-pressed button');

  // now genuinely release the pad, then press it again — the latch must not
  // get stuck off forever.
  h.padHold(false, 0);
  pads.poll();
  assert(pads.held === false, 'held should stay false once the pad is actually released');

  h.padHold(true, 0);
  pads.poll();
  assert(pads.held === true, 'a fresh press after a real release must restore the hold');

  note(`event log: ${seen.join(' ')}`);
  return h;
});

/* REGRESSION GUARD — two controllers. Pad A is still held through blur while
   pad B is idle. A global latch ORs A's stale button into B's poll, so the
   combined "anything down" never goes quiet while A keeps holding — B's own
   fresh press would then stay masked for as long as A holds. Suppression
   must be tracked per pad: B's latch clears on ITS OWN all-quiet poll,
   independent of whatever pad A is doing. */
test('KidKit: blur latch is per-pad', note => {
  const h = createHarness('oliver-run', { seed: 5, gamepads: 2 });
  const seen = [];
  const pads = global.KidKit.input.create({
    element: h.document.getElementById('stage'),
    onHold: (down, src) => seen.push((down ? '+' : '-') + src),
  });

  // pad A (index 0) held down; pad B (index 1) idle at blur time.
  h.padHold(true, 0);
  pads.poll();
  note(`after A held+poll: held= ${pads.held}`);
  assert(pads.held === true, 'held should be true with pad A down');

  h.blur();
  note(`after blur: held= ${pads.held}`);
  assert(pads.held === false, 'blur must force-release everything');

  // A is still physically down; B is still idle. This poll must observe
  // B's all-quiet state and clear B's own latch, while A's stays suppressed
  // because A never went quiet.
  pads.poll();
  note(`after blur + poll (A still down, B idle): held= ${pads.held}`);
  assert(pads.held === false, 'pad A still held must not resurrect the hold');

  // B makes a fresh press. Under a global latch this stays masked forever
  // because A's stale button keeps the aggregate "anyDown" true. Per-pad
  // suppression means B's own latch already cleared, so this must register.
  h.padHold(true, 1);
  pads.poll();
  note(`after B fresh press (A still held): held= ${pads.held}`);
  assert(pads.held === true, "pad B's fresh press must register even while pad A is still held");

  note(`event log: ${seen.join(' ')}`);
  return h;
});

/* REGRESSION GUARD — releaseAll('blur') only latched padState entries that
   ALREADY EXISTED at blur time. poll() lazily creates a pad's entry the
   first time it observes that pad, initialising suppressed: false — so a
   pad discovered for the first time AFTER blur (a controller connecting
   late, or one that was connected but never polled before blur) arrived
   completely unsuppressed. If its button was already down at that first
   observation — normal for controllers that need a press to wake up and
   register with the browser — it reported held immediately, with no prior
   release, exactly what the latch exists to prevent. Fix: a module-level
   suppressNewPads flag, set true by releaseAll(), is used as the initial
   value for every newly created padState entry instead of a hard-coded
   false. */
test('KidKit: a pad discovered after blur starts suppressed', note => {
  const h = createHarness('oliver-run', { seed: 5, gamepads: 2, startDisconnected: [1] });
  const seen = [];
  const pads = global.KidKit.input.create({
    element: h.document.getElementById('stage'),
    onHold: (down, src) => seen.push((down ? '+' : '-') + src),
  });

  // Pad 1's button is pressed while the pad is still withheld from
  // navigator.getGamepads() — poll() cannot see it yet, so no padState
  // entry exists for it at all.
  h.padHold(true, 1);
  pads.poll();
  note(`before pad 1 is discovered: held= ${pads.held}`);
  assert(pads.held === false, 'pad 1 is invisible to poll() until connected, so it cannot report held yet');

  h.blur();
  note(`after blur: held= ${pads.held}`);
  assert(pads.held === false, 'blur must force-release everything');

  // Pad 1 becomes visible for the first time now, AFTER blur, with its
  // button already down — the exact "controller wakes on button press"
  // scenario the latch exists to guard against.
  h.connectGamepad(1);
  pads.poll();
  note(`first poll after pad 1 is discovered (button already down): held= ${pads.held}`);
  assert(pads.held === false,
    'a pad discovered for the first time after blur must start suppressed, not report held immediately');

  // must not be stuck forever: a genuine release, then a fresh press, must
  // work exactly as it would for a pad that existed before blur.
  h.padHold(false, 1);
  pads.poll();
  assert(pads.held === false, 'held should stay false once pad 1 is actually released');

  h.padHold(true, 1);
  pads.poll();
  assert(pads.held === true, 'a fresh press after a real release must restore the hold');

  note(`event log: ${seen.join(' ')}`);
  return h;
});

/* REGRESSION GUARD — hold() must own the gamepad A button for as long as
   it's held. Before the fix, any pressPadButton() call (via pad(),
   padPress(), or the holdJump() cadence) queued a pendingRelease closure
   that unconditionally cleared button A on the very next step(), silently
   dropping a sustained hold() one frame later. */
test('harness: hold() survives a pad press', note => {
  const h = createHarness('oliver-run', { seed: 1 });
  h.tap();
  pump(h, 30);

  h.hold(true);
  const afterHold = navigator.getGamepads()[0].buttons[0].pressed;
  note(`A after hold(true):     ${afterHold}`);
  assert(afterHold === true, 'hold(true) should press gamepad button A');

  h.pad('a');
  pump(h, 1);
  const afterPad = navigator.getGamepads()[0].buttons[0].pressed;
  note(`A after pad(a)+1 frame: ${afterPad}`);
  assert(afterPad === true, 'hold() should still own button A after an unrelated pad() press/release cycle');

  h.hold(false);
  const afterRelease = navigator.getGamepads()[0].buttons[0].pressed;
  assert(afterRelease === false, 'hold(false) should release button A immediately');

  return h;
});

/* REGRESSION GUARD — green before and after this task, by design.

   Glide only engages while airborne and descending. A run that never jumps
   must therefore be bit-for-bit identical whether or not the button is held —
   which is a far stronger claim than "the score looks similar". */
test('glide is inert while grounded', note => {
  const h = createHarness('oliver-run', { seed: 20260729 });
  // Deliberately NOT h.tap() + h.hold(true): hold() drives the pointer path
  // AND the mock gamepad button together (by design, see harness.js), which
  // means starting via tap() and then holding fires a SECOND press edge: the
  // pointerdown inside hold(true) is dispatched synchronously, before any
  // frame is pumped, and tap() has already set state to 'play' -- so it calls
  // jump() for real. A genuine extra jump, not a glide bug. (The gamepad poll
  // is at most a second contributor; the pointer path alone is enough.)
  // keyDown() with no matching keyUp is a single input source with a
  // single press edge that then stays down for the rest of the run: it both
  // starts the game and holds forever, with no second edge ever created, so
  // it is the only way to actually keep the hero on the ground for all 9000
  // frames while `holding` is true throughout.
  h.keyDown('ArrowUp');       // held for the entire run, never jumping
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

/* How a child actually glides: the same press both jumps and begins the
   float, you keep holding to stay up, then release and press again. You
   cannot press a button you are already holding, so never mix hold() with
   pad() — cycle hold() instead. holdFor = 1 gives identical jump edges with
   no float, which makes it the control run for any A/B comparison. */
function runCycles(h, totalFrames, holdFor, period) {
  for (let i = 0; i < totalFrames; i++) {
    const phase = i % (period || 40);
    if (phase === 0) h.hold(true);
    if (phase === holdFor) h.hold(false);
    pump(h, 1);
  }
}

test('holding through a long run throws nothing', note => {
  const h = createHarness('oliver-run', { seed: 33 });
  h.tap();
  runCycles(h, 6000, 24, 40);      // jump, float for 24 frames, land, repeat
  assert(h.num('score') > 500, `run should have progressed, got ${h.num('score')}`);
  note(`score ${h.num('score')} over 6000 frames of jump-and-float cycles`);
  return h;
});

/* ---------------------------------------------------------------- *
 * 1. it boots
 * ---------------------------------------------------------------- */
test('boots and reaches the menu', note => {
  const h = createHarness('oliver-run');
  note(`loaded ${h.loaded.join(', ')}`);
  assert(h.text('lvlName') === 'Rooftop City', `expected first level name, got "${h.text('lvlName')}"`);
  assert(h.text('score') === '0', 'score should start at 0');
  assert(!h.hidden('startScreen'), 'start screen should be visible before play');
  pump(h, 60);
  assert(h.text('score') === '0', 'score must not move while still on the menu');
  return h;
});

/* ---------------------------------------------------------------- *
 * 2. starts and scores from each input
 * ---------------------------------------------------------------- */
const STARTERS = {
  touch: h => h.tap(),
  keyboard: h => h.key('ArrowUp'),
  gamepad: h => h.padPress('a'),
};

for (const [label, start] of Object.entries(STARTERS)) {
  test(`starts and scores from ${label}`, note => {
    const h = createHarness('oliver-run', { seed: 99 });
    assert(!h.hidden('startScreen'), 'precondition: menu visible');
    start(h);
    pump(h, 5);
    assert(h.hidden('startScreen'), `${label} did not start the game`);

    const early = h.num('score');
    // keep playing using the same input, so the input path stays live
    for (let i = 0; i < 600; i++) {
      if (i % 12 === 0) start(h);
      pump(h, 1);
    }
    const later = h.num('score');
    assert(later > early, `score did not rise under ${label}: ${early} -> ${later}`);
    note(`score ${early} -> ${later} over 600 frames`);
    return h;
  });
}

/* ---------------------------------------------------------------- *
 * 3. endurance
 * ---------------------------------------------------------------- */
test('survives 20000 frames with no exception', note => {
  const h = createHarness('oliver-run', { seed: 7 });
  h.tap();
  h.holdJump(true);
  pump(h, 20000);
  const score = h.num('score');
  assert(score > 1000, `expected a real score after 20000 frames, got ${score}`);
  assert(h.hidden('startScreen'), 'game should still be in play');
  const trophies = (h.text('trophies').match(/🏆/g) || []).length;
  note(`score ${score}, ${trophies} trophies, ${h.timerCount} timers still alive`);
  note(`audio nodes built: ${h.audioStats.oscillators} oscillators, ${h.audioStats.sources} buffer sources`);
  assert(h.timerCount < 50, `timer leak: ${h.timerCount} still pending`);
  return h;
});

/* ---------------------------------------------------------------- *
 * 4. power-ups
 *
 * Orbs spawn at one of two heights. The high one (GROUND-152) is out of
 * reach standing up, so collecting it proves a mid-air pickup; the low one
 * (GROUND-72) is collectable flat-footed. Biasing the RNG into a bucket
 * pins which power comes up, and — because the same draw decides the
 * height — which of the two pickups we are exercising.
 * ---------------------------------------------------------------- */
const GROUND_PICKUP = [];
const AIR_PICKUP = [];

for (let k = 0; k < 6; k++) {
  const expected = POWER_NAMES[k];
  const airborne = k < 3;          // buckets 0-2 draw < .5 => the high orb
  test(`power-up ${expected} activates and expires (${airborne ? 'mid-jump' : 'from the ground'})`, note => {
    const h = createHarness('oliver-run', { seed: 1234 });
    h.bucket(k, 6);
    h.tap();
    if (airborne) h.holdJump(true);

    const waited = h.until(() => !h.hidden('powerTag'), 12000, `${expected} to be picked up`);
    const name = h.text('powerName');
    assert(name === expected, `expected "${expected}", got "${name}"`);
    (airborne ? AIR_PICKUP : GROUND_PICKUP).push(name);

    const activatedAt = h.frameCount;
    // stop jumping once it is held, so expiry is measured against a settled hero
    h.holdJump(false);
    const lived = h.until(() => h.hidden('powerTag'), 3000, `${expected} to expire`);

    const expectedDur = POWER_DURATIONS[expected];
    assertBetween(lived, expectedDur * 0.9, expectedDur * 1.1,
      `${expected} lasted the wrong number of frames`);

    // and the game has to keep running cleanly afterwards
    const after = h.num('score');
    pump(h, 400);
    assert(h.num('score') > after, 'score stopped rising after the power-up ended');
    assert(h.hidden('powerTag'), 'power tag came back on its own');
    note(`picked up after ${waited} frames at ${activatedAt}, lasted ${lived} (nominal ${expectedDur})`);
    return h;
  });
}

test('power-ups: all six seen, from both the ground and mid-jump', note => {
  const seen = new Set([...GROUND_PICKUP, ...AIR_PICKUP]);
  assert(seen.size === 6, `only saw ${seen.size} of 6 power-ups: ${[...seen].join(', ')}`);
  assert(AIR_PICKUP.length > 0, 'no power-up was collected mid-jump');
  assert(GROUND_PICKUP.length > 0, 'no power-up was collected from the ground');
  note(`mid-jump: ${AIR_PICKUP.join(', ')}`);
  note(`ground:   ${GROUND_PICKUP.join(', ')}`);
});

/* ---------------------------------------------------------------- *
 * 5. boss rush
 * ---------------------------------------------------------------- */
test('boss rush reaches and beats all 18 bosses', note => {
  const h = createHarness('oliver-run', { seed: 1234 });
  h.click('rushBtn');
  pump(h, 5);
  assert(h.hidden('startScreen'), 'rush mode did not start');
  assert(h.text('lvlName') === 'Boss Rush', `expected Boss Rush, got "${h.text('lvlName')}"`);
  h.holdJump(true);

  const order = [];
  let last = '';
  const CAP = 120000;
  for (let i = 0; i < CAP; i++) {
    pump(h, 1);
    const label = h.text('bossName');
    if (label && label !== last) {
      last = label;
      const m = /^Boss (\d+) — (.+)$/.exec(label);
      assert(m, `unexpected boss label "${label}"`);
      assert(Number(m[1]) === order.length + 1, `boss numbering jumped at "${label}"`);
      order.push(m[2]);
    }
    if (trophyCount(h) >= 18) break;
  }

  const beaten = trophyCount(h);
  assert(order.length === 18, `only reached ${order.length} of 18 bosses`);
  assert(new Set(order).size === 18, `bosses repeated before the bag emptied: ${order.join(', ')}`);
  assert(beaten >= 18, `reached 18 bosses but only beat ${beaten}`);
  note(`beat all 18 in ${h.frameCount} frames`);
  note(order.join(', '));
  return h;
});

function trophyCount(h) {
  const txt = h.text('trophies');
  const mult = /×(\d+)/.exec(txt);
  if (mult) return Number(mult[1]);
  return (txt.match(/🏆/g) || []).length;
}

/* ---------------------------------------------------------------- *
 * 6. persistence across a reload
 * ---------------------------------------------------------------- */
test('high score survives a reload', note => {
  let h = createHarness('oliver-run', { seed: 21 });
  assert(h.text('best') === '', `fresh install should show no best, got "${h.text('best')}"`);
  h.tap();
  h.holdJump(true);
  pump(h, 4000);
  // The score label and the internal point total can land a half-frame apart
  // when a collision bonus lands on the very last pumped frame (the label is
  // written before that frame's collisions are scored) — settle a couple of
  // quiet frames so the label has caught up before comparing it to "best".
  h.holdJump(false);
  pump(h, 3);

  const score = h.num('score');
  assert(score > 0, 'need a score before testing persistence');
  assert(h.text('best') === 'Best ' + score, `best label out of step: "${h.text('best')}" vs score ${score}`);

  // saveBest() debounces behind a 1500ms setTimeout, and distance keeps the
  // score climbing meanwhile, so what lands in storage is the best as of the
  // moment the timer fired — at or just past the score sampled above.
  pump(h, 120);
  const stored = Number(h.store['oliver-run-best']);
  assert(h.store['oliver-run-best'] !== undefined, 'nothing was written to storage');
  assert(stored >= score, `stored ${stored} is behind the ${score} already scored`);
  assert(stored <= h.num('best'), `stored ${stored} is ahead of the live best ${h.num('best')}`);
  note(`scored ${score}, storage now ${JSON.stringify(h.store)}`);

  h = h.reload();
  assert(h.text('best') === 'Best ' + stored,
    `after reload best showed "${h.text('best')}", expected "Best ${stored}"`);
  assert(h.text('score') === '0', 'score should reset to 0 on reload');
  assert(h.hidden('startScreen') === false, 'reload should land back on the menu');
  note(`after reload: best "${h.text('best')}", score "${h.text('score')}"`);
  return h;
});

/* ---------------------------------------------------------------- *
 * sky lane (Task 4)
 * ---------------------------------------------------------------- */

/* REGRESSION GUARD — green before and after this task, by design.
   Platforms are not observable from the DOM, so this cannot assert their
   absence in Boss Rush directly. What it does assert is the thing that would
   actually break: that a mode with no `run` phase still runs clean once the
   sky-lane code exists. Named for what it checks, not what we wish it could. */
test('sky lane: Boss Rush is unaffected by the sky lane code', note => {
  const h = createHarness('oliver-run', { seed: 41 });
  h.click('rushBtn');          // Boss Rush only cycles warn -> boss -> victory
  pump(h, 6000);
  assert(h.text('lvlName') === 'Boss Rush', 'should be in rush mode');
  assert(h.num('score') > 200, `rush should have progressed, got ${h.num('score')}`);
  assert(h.hidden('startScreen'), 'game should still be in play');
  note(`rush reached score ${h.num('score')} over 6000 frames`);
  return h;
});

test('sky lane: platforms survive a long run without incident', note => {
  const h = createHarness('oliver-run', { seed: 42 });
  h.tap();
  runCycles(h, 12000, 24, 40);       // climb around the clusters
  assert(h.num('score') > 500, `run should have progressed, got ${h.num('score')}`);
  assert(h.hidden('startScreen'), 'game should still be in play');
  note(`score ${h.num('score')} after 12000 frames of climbing`);
  return h;
});

/* Score is dominated by distance — roughly 4,600 points over 9,000 frames —
   so gold stars can only ever be a small fraction of it, and climbing also
   costs you ground-lane smashes you would otherwise have hit. A percentage
   threshold on total score therefore measures distance, not the sky lane.
   What IS provable through the score is that climbing nets strictly more
   than a full gold star's worth over a grounded run. */
test('sky lane: gold stars are unreachable without leaving the ground', note => {
  const grounded = createHarness('oliver-run', { seed: 43 });
  grounded.tap();
  pump(grounded, 9000);            // never jumps, so never touches a platform
  const flat = grounded.num('score');
  grounded.dispose();

  const climber = createHarness('oliver-run', { seed: 43 });
  climber.tap();
  runCycles(climber, 9000, 24, 40);
  const climbed = climber.num('score');
  const GOLD = 50;                 // TUNE.goldPoints
  note(`grounded ${flat} vs climbing ${climbed} (+${climbed - flat})`);
  assert(climbed >= flat + GOLD,
    `climbing should net at least one gold star over a grounded run: ${flat} -> ${climbed}`);
  return climber;
});

/* The one test that isolates the glide itself. Both runs share a seed and
   press the jump button on exactly the same frames — the ONLY difference is
   how long the button stays down afterwards. holdFor:1 releases immediately
   (a plain jump); holdFor:24 keeps floating. Any score difference is the
   glide and nothing else.

   Measured while building this: the glide raises time spent standing on a
   platform from 167 frames to 1178 over the same run — a 7x difference. The
   score margin below is much smaller than that because distance dominates
   the score; it is the visible tip of a far larger effect. */
test('glide measurably improves sky lane collection', note => {
  const run = holdFor => {
    const h = createHarness('oliver-run', { seed: 44 });
    h.tap();
    runCycles(h, 9000, holdFor, 40);
    const score = h.num('score');
    h.dispose();
    return score;
  };
  const tapOnly = run(1);
  const floating = run(24);
  note(`tap-only ${tapOnly} vs floating ${floating} (+${floating - tapOnly})`);
  assert(floating > tapOnly,
    `holding should collect more: ${tapOnly} -> ${floating}`);
});

/* ---------------------------------------------------------------- *
 * report
 * ---------------------------------------------------------------- */
const failed = results.filter(r => !r.ok);
const total = results.length;
console.log('');
console.log(failed.length
  ? `${failed.length} of ${total} failed:\n${failed.map(f => '  - ' + f.name).join('\n')}`
  : `all ${total} passed`);
process.exit(failed.length ? 1 : 0);
