/* ============================================================================
   Smoke tests for every game, driven through test/harness.js.

     node test/smoke.js            run everything
     node test/smoke.js powers     only tests whose name matches "powers"
     node test/smoke.js fishing    only the Emsile Fishing block

   Everything here is black box: each game is an IIFE with no exports, so the
   assertions read the same stub DOM the game writes to (score, boss name,
   power tag, catch name) rather than reaching inside it. No game code had to
   change to make any of this testable.
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
  h.padHold('a', true, 0); pads.poll();
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
  h.padHold('a', true, 0);
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
  h.padHold('a', false, 0);
  pads.poll();
  assert(pads.held === false, 'held should stay false once the pad is actually released');

  h.padHold('a', true, 0);
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
  h.padHold('a', true, 0);
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
  h.padHold('a', true, 1);
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
  h.padHold('a', true, 1);
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
  h.padHold('a', false, 1);
  pads.poll();
  assert(pads.held === false, 'held should stay false once pad 1 is actually released');

  h.padHold('a', true, 1);
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

/* ================================================================ *
 * games/emsile-fishing
 *
 * The cycle runs itself — cast, wait, bite, reel, show, cast — and the only
 * thing a player contributes is a tap. That makes both halves of the design
 * testable without any timing cleverness: tap often and you catch fish, tap
 * never and the hook still comes up with junk. Neither path can end the game,
 * which is the property these tests are really guarding.
 * ================================================================ */
const FISH_NAMES = [
  'Goldfish', 'Blue Tang', 'Crab', 'Seahorse', 'Starfish', 'Puffer Fish',
  'Jellyfish', 'Sea Turtle', 'Lantern Fish', 'Octopus', 'Swordfish',
  'Baby Whale', 'Treasure!', 'Rubber Duck', 'Golden Fish',
];
const JUNK_NAMES = ['Old Boot', 'Lost Sock', 'Seaweed', 'Tin Can'];
const ZONE_NAMES = ['Sunny Shallows', 'Kelp Forest', 'Twilight Deep', 'The Deep Deep'];

/* album label reads "7 / 15" */
function speciesCount(h) {
  const m = /(\d+)\s*\/\s*(\d+)/.exec(h.text('albumCount'));
  return m ? Number(m[1]) : -1;
}
function junkCount(h) {
  const m = /(\d+)/.exec(h.text('junkTag'));
  return m ? Number(m[1]) : 0;
}
/* Play the way a kid plays: keep tapping. Every bite window is 80 frames, so
   a tap every 10 frames can never miss one. */
function mash(h, frames, every) {
  const gap = every || 10;
  for (let i = 0; i < frames; i++) {
    if (i % gap === 0) h.tap();
    pump(h, 1);
  }
}

test('fishing: boots to the menu with an empty book', note => {
  const h = createHarness('emsile-fishing');
  note(`loaded ${h.loaded.join(', ')}`);
  assert(!h.hidden('startScreen'), 'start screen should be visible before play');
  assert(h.text('zoneName') === ZONE_NAMES[0], `expected first zone, got "${h.text('zoneName')}"`);
  assert(h.num('catches') === 0, 'catches should start at 0');
  assert(speciesCount(h) === 0, `fresh install should have an empty book, got "${h.text('albumCount')}"`);
  assert(h.text('albumCount') === '0 / 15', `expected "0 / 15", got "${h.text('albumCount')}"`);
  assert(h.hidden('catchWrap'), 'catch banner should not be up yet');
  pump(h, 60);
  assert(h.num('catches') === 0, 'nothing should be caught while still on the menu');
  return h;
});

for (const [label, start] of Object.entries(STARTERS)) {
  test(`fishing: starts and catches from ${label}`, note => {
    const h = createHarness('emsile-fishing', { seed: 4242 });
    assert(!h.hidden('startScreen'), 'precondition: menu visible');
    start(h);
    pump(h, 5);
    assert(h.hidden('startScreen'), `${label} did not start the game`);

    // keep playing through the same input so that path stays live
    for (let i = 0; i < 900; i++) {
      if (i % 10 === 0) start(h);
      pump(h, 1);
    }
    const caught = h.num('catches');
    assert(caught > 0, `no fish landed in 900 frames of ${label}`);
    assert(speciesCount(h) > 0, 'a fish was counted but the book stayed empty');
    note(`${caught} fish, ${speciesCount(h)} species in ${900} frames`);
    return h;
  });
}

test('fishing: a caught fish is named and goes in the book', note => {
  const h = createHarness('emsile-fishing', { seed: 31 });
  h.click('startBtn');
  const seen = [];
  for (let i = 0; i < 3000 && seen.length < 3; i++) {
    if (i % 10 === 0) h.tap();
    pump(h, 1);
    if (!h.hidden('catchWrap')) {
      const name = h.text('catchName');
      if (name && seen[seen.length - 1] !== name) seen.push(name);
    }
  }
  assert(seen.length >= 3, `only saw ${seen.length} catches: ${seen.join(', ')}`);
  for (const name of seen) {
    assert(FISH_NAMES.includes(name), `"${name}" is not one of the 15 creatures`);
  }
  assert(h.num('catches') >= 3, `catch counter behind the banners: ${h.num('catches')}`);
  assert(junkCount(h) === 0, `tapping every 10 frames should never miss a bite, but junk = ${junkCount(h)}`);
  note(`caught ${seen.join(', ')}`);
  return h;
});

test('fishing: never tapping still lands junk, and never ends the game', note => {
  const h = createHarness('emsile-fishing', { seed: 77 });
  h.click('startBtn');          // start without ever using the tap handler

  // The banner is only up for part of each cycle, so collect names as they
  // appear rather than sampling whatever happens to be on screen at the end.
  const seen = [];
  for (let i = 0; i < 3000; i++) {
    pump(h, 1);
    if (!h.hidden('catchWrap')) {
      const name = h.text('catchName');
      if (name && seen[seen.length - 1] !== name) seen.push(name);
    }
  }

  const junk = junkCount(h);
  assert(junk > 0, 'ignoring every bite should still fill the junk pile');
  assert(h.num('catches') === 0, `no tap means no fish, but catches = ${h.num('catches')}`);
  assert(speciesCount(h) === 0, 'junk must not count towards the book');
  assert(h.hidden('startScreen'), 'the game must not bounce back to the menu — there is no game over');
  assert(seen.length > 0, 'junk should still get its own little banner');
  for (const name of seen) {
    assert(JUNK_NAMES.includes(name), `"${name}" landed without a single tap`);
  }
  note(`${junk} pieces of junk in 3000 frames (${seen.join(', ')}), still fishing`);
  return h;
});

test('fishing: wiggling the line brings the bite sooner', note => {
  // Same seed, same everything, except one run mashes the button. The wiggle
  // knocks 30 frames off the wait, so the masher has to land more fish.
  const calm = createHarness('emsile-fishing', { seed: 555 });
  calm.click('startBtn');
  for (let i = 0; i < 2400; i++) {
    if (i % 240 === 0) calm.tap();       // rare enough to still catch each bite
    pump(calm, 1);
  }
  const calmCatches = calm.num('catches') + junkCount(calm);
  calm.dispose();

  const busy = createHarness('emsile-fishing', { seed: 555 });
  busy.click('startBtn');
  mash(busy, 2400);
  const busyCatches = busy.num('catches');

  assert(busyCatches > calmCatches,
    `wiggling should speed things up: ${busyCatches} vs ${calmCatches} in the same 2400 frames`);
  note(`wiggling: ${busyCatches} catches, leaving it alone: ${calmCatches}`);
  return busy;
});

test('fishing: the water gets deeper as the book fills', note => {
  const h = createHarness('emsile-fishing', { seed: 8 });
  h.click('startBtn');
  const zonesSeen = [h.text('zoneName')];
  for (let i = 0; i < 20000; i++) {
    if (i % 10 === 0) h.tap();
    pump(h, 1);
    const z = h.text('zoneName');
    if (z !== zonesSeen[zonesSeen.length - 1]) zonesSeen.push(z);
    if (zonesSeen.length === ZONE_NAMES.length) break;
  }
  assert(zonesSeen.length === ZONE_NAMES.length,
    `only reached ${zonesSeen.length} of ${ZONE_NAMES.length} zones: ${zonesSeen.join(' → ')}`);
  for (let i = 0; i < zonesSeen.length; i++) {
    assert(zonesSeen[i] === ZONE_NAMES[i], `zones out of order: ${zonesSeen.join(' → ')}`);
  }
  note(`${zonesSeen.join(' → ')} after ${h.num('catches')} catches`);
  return h;
});

test('fishing: the fish book opens and closes', note => {
  const h = createHarness('emsile-fishing', { seed: 12 });
  h.click('startBtn');
  pump(h, 400);

  const shut = h.el('albumBtn').getAttribute('aria-label');
  assert(/show/i.test(shut), `expected a "show" label while closed, got "${shut}"`);

  h.click('albumBtn');
  pump(h, 30);
  assert(/back/i.test(h.el('albumBtn').getAttribute('aria-label')), 'book did not open on the button');
  assert(h.hidden('catchWrap'), 'the catch banner must not show through the book');

  // a tap anywhere closes it again — same one button
  h.tap();
  pump(h, 30);
  assert(/show/i.test(h.el('albumBtn').getAttribute('aria-label')), 'tapping did not close the book');

  // and X on a pad toggles it, which is the only non-jump button in the kit
  h.padPress('x');
  pump(h, 5);
  assert(/back/i.test(h.el('albumBtn').getAttribute('aria-label')), 'gamepad X did not open the book');
  h.padPress('x');
  pump(h, 5);
  assert(/show/i.test(h.el('albumBtn').getAttribute('aria-label')), 'gamepad X did not close the book');

  // fishing carries on afterwards
  const before = h.num('catches');
  mash(h, 900);
  assert(h.num('catches') > before, 'fishing stopped after closing the book');
  note(`reopened cleanly, ${h.num('catches')} caught total`);
  return h;
});

test('fishing: the book survives a reload', note => {
  let h = createHarness('emsile-fishing', { seed: 64 });
  assert(speciesCount(h) === 0, 'precondition: empty book');
  h.click('startBtn');
  mash(h, 3000);

  const caught = h.num('catches');
  const species = speciesCount(h);
  assert(caught > 0, 'need a catch before testing persistence');

  // save() debounces behind a 1200ms setTimeout, so pump past it
  pump(h, 120);
  assert(h.store['emsile-fishing-album'] !== undefined, 'nothing was written to storage');
  const stored = JSON.parse(h.store['emsile-fishing-album']);
  assert(Object.keys(stored).length === species,
    `storage has ${Object.keys(stored).length} species, HUD says ${species}`);
  assert(Number(h.store['emsile-fishing-catches']) === caught,
    `stored total ${h.store['emsile-fishing-catches']} vs ${caught} caught`);
  note(`caught ${caught} across ${species} species: ${Object.keys(stored).join(', ')}`);

  h = h.reload();
  assert(h.num('catches') === caught, `after reload catches showed ${h.num('catches')}, expected ${caught}`);
  assert(speciesCount(h) === species, `after reload book showed "${h.text('albumCount')}"`);
  assert(!h.hidden('startScreen'), 'reload should land back on the menu');
  note(`after reload: ${h.num('catches')} catches, book "${h.text('albumCount')}"`);
  return h;
});

/* --- sizes and the fight --------------------------------------------- *
 * Every catch rolls a size, and the biggest of each species is kept. That is
 * what stops a duplicate being a dud: a fourth jellyfish might still be the
 * biggest jellyfish. Anything at or over BIG_SIZE puts up a fight — a longer
 * reel the player can tap through — so these also cover that path.
 * --------------------------------------------------------------------- */
const SIZE_MIN = 0.62, SIZE_MAX = 1.9;

function sizeRecords(h) {
  const raw = h.store['emsile-fishing-sizes'];
  return raw === undefined ? null : JSON.parse(raw);
}
/* Watch the badge line as it changes, rather than sampling it at one frame. */
function collectBadges(h, frames, gap) {
  const seen = [];
  for (let i = 0; i < frames; i++) {
    if (i % (gap || 10) === 0) h.tap();
    pump(h, 1);
    if (!h.hidden('catchWrap')) {
      const badge = h.text('catchNew');
      const name = h.text('catchName');
      const key = name + '|' + badge;
      if (seen[seen.length - 1] !== key) seen.push(key);
    }
  }
  return seen;
}

test('fishing: every fish has a size, and the records only ever go up', note => {
  const h = createHarness('emsile-fishing', { seed: 202 });
  h.click('startBtn');
  mash(h, 5000);
  pump(h, 120);                       // past the 1200ms save debounce

  const early = sizeRecords(h);
  assert(early !== null, 'no size records were written to storage');
  const species = Object.keys(JSON.parse(h.store['emsile-fishing-album']));
  assert(species.length > 0, 'need some catches first');

  // every species in the book has a record, and every record is a real size
  for (const id of species) {
    assert(early[id] !== undefined, `${id} is in the book with no size record`);
    assertBetween(early[id], SIZE_MIN, SIZE_MAX, `${id} record out of range`);
  }
  assert(Object.keys(early).length === species.length,
    `${Object.keys(early).length} size records vs ${species.length} species in the book`);

  // keep fishing: a record may rise, but must never fall
  mash(h, 6000);
  pump(h, 120);
  const later = sizeRecords(h);
  for (const id of Object.keys(early)) {
    assert(later[id] >= early[id],
      `${id} record went backwards: ${early[id]} -> ${later[id]}`);
  }
  const grew = Object.keys(early).filter(id => later[id] > early[id]);
  note(`${species.length} species recorded, ${grew.length} beat their record on the second run`);
  note(`records: ${JSON.stringify(later)}`);
  return h;
});

test('fishing: duplicates still pay off — new, biggest and whopper all show', note => {
  const h = createHarness('emsile-fishing', { seed: 5150 });
  h.click('startBtn');
  const badges = collectBadges(h, 16000);
  const kinds = new Set(badges.map(b => b.split('|')[1]));

  assert(kinds.has('★ NEW FISH ★'), 'never saw a NEW FISH badge');
  const gotBig = [...kinds].some(k => k.includes('BIGGEST YET') || k === 'WHOPPER!');
  assert(gotBig, `no size badge in ${badges.length} catches: ${[...kinds].join(' / ')}`);
  const gotCount = [...kinds].some(k => /^×\d+$/.test(k));
  assert(gotCount, 'never saw a duplicate count badge');

  // and a duplicate that beats the record must not be labelled NEW
  const names = badges.map(b => b.split('|')[0]);
  const dupBiggest = badges.filter((b, i) =>
    b.includes('BIGGEST YET') && names.indexOf(names[i]) < i);
  for (const b of dupBiggest) {
    assert(!b.includes('NEW FISH'), `badge claims both new and biggest: ${b}`);
  }
  note(`${badges.length} catches, badges seen: ${[...kinds].join(' / ')}`);
  return h;
});

test('fishing: a run of nothing but whoppers fights and lands cleanly', note => {
  // Bucketing the low end of the RNG pins rollSize() into its whopper band, so
  // every single fish is big enough to trigger the fight. Safe here because
  // nothing in this game rejection-samples — every pick is a running sum.
  const h = createHarness('emsile-fishing', { seed: 606 });
  h.bucket(0, 20);
  h.click('startBtn');
  const badges = collectBadges(h, 6000);

  assert(badges.length > 0, 'no catches at all — the fight may be stalling');
  assert(h.num('catches') > 0, 'catch counter never moved');
  assert(h.hidden('startScreen'), 'still fishing');

  const recs = sizeRecords(h);
  pump(h, 120);
  const after = sizeRecords(h) || recs;
  for (const [id, v] of Object.entries(after || {})) {
    assert(v >= 1.4, `${id} recorded ${v} but every fish should have been a whopper`);
    assertBetween(v, SIZE_MIN, SIZE_MAX, `${id} record out of range`);
  }
  note(`${h.num('catches')} whoppers landed in 6000 frames, records ${JSON.stringify(after)}`);
  return h;
});

test('fishing: survives 20000 frames with no exception', note => {
  const h = createHarness('emsile-fishing', { seed: 3 });
  h.click('startBtn');
  mash(h, 20000);

  const caught = h.num('catches');
  const species = speciesCount(h);
  assert(caught > 20, `expected a real haul after 20000 frames, got ${caught}`);
  assert(species >= 8, `only ${species} of 15 species after ${caught} catches — the book fills too slowly`);
  assert(h.hidden('startScreen'), 'game should still be in play');
  assert(h.timerCount < 50, `timer leak: ${h.timerCount} still pending`);
  note(`${caught} catches, ${species}/15 species, zone "${h.text('zoneName')}", ${h.timerCount} timers alive`);
  note(`audio nodes built: ${h.audioStats.oscillators} oscillators, ${h.audioStats.sources} buffer sources`);
  return h;
});

test('fishing: a long idle run never throws either', note => {
  // The other endurance test taps; this one exercises the paths a distracted
  // kid hits — bite windows expiring, junk after junk, forever.
  const h = createHarness('emsile-fishing', { seed: 99 });
  h.click('startBtn');
  pump(h, 12000);
  assert(junkCount(h) > 10, `expected a big junk pile, got ${junkCount(h)}`);
  assert(h.hidden('startScreen'), 'still fishing');
  assert(h.timerCount < 50, `timer leak: ${h.timerCount} still pending`);
  note(`${junkCount(h)} junk, 0 fish, no crash`);
  return h;
});

/* ================================================================ *
 * games/daddy-smash
 *
 * The other two games are driven by one button, so a test taps. This one is
 * driven by *held* input, which is a different shape of test: hold a
 * direction for hundreds of frames and watch where the kid ends up. The
 * landmark tag under the meter ("🪴 the plant") is the game's own readout
 * of where the player is standing, so steering can be checked through the
 * DOM like everything else — no test-only hooks in the game.
 *
 * The property these tests really guard is that getting caught is a reward:
 * a kid who never moves gets smashed over and over and the game never ends,
 * and a kid who runs gets smashed less. Both are wins, neither is a loss.
 * ================================================================ */
const SPOTS = {
  plant:  '🪴 the plant',
  dogbed: '🐶 the dog bed',
  couch:  '🛋️ the couch',
  middle: '🏠 in the middle',
};
/* everything down the right-hand wall — the big chair, the lamp, the dog bed */
const RIGHT_SIDE = ['🪑 the big chair', '💡 the lamp', SPOTS.dogbed];

/* Start the game and hold one input down for `frames`, collecting every
   landmark the player is reported at along the way. A smash teleports them
   to the couch, so the set of places seen is the honest question to ask —
   "where did they end up" would be answering about the last slam. */
function holdRun(setup, frames, seed) {
  const h = createHarness('daddy-smash', { seed: seed == null ? 11 : seed });
  h.tap();
  pump(h, 5);
  setup(h);
  const seen = new Set();
  for (let i = 0; i < frames; i++) {
    pump(h, 1);
    seen.add(h.text('whereTag'));
  }
  return { h, seen };
}

/* Keep the controls moving: lap the room, changing direction every 90
   frames. This is a busy player, not a clever one — it does not react to
   Daddy at all — so use it to keep the movement code hot, never to measure
   how well evasion works. */
function lapTheRoom(h, frames) {
  const legs = [[1, 0], [0, -1], [-1, 0], [0, 1]];
  for (let i = 0; i < frames; i++) {
    if (i % 90 === 0) {
      const [x, y] = legs[(i / 90) % legs.length];
      h.stick(x, y);
    }
    pump(h, 1);
  }
}

test('daddy: boots to the menu with nobody smashed', note => {
  const h = createHarness('daddy-smash');
  note(`loaded ${h.loaded.join(', ')}`);
  assert(!h.hidden('startScreen'), 'start screen should be visible before play');
  assert(h.num('slams') === 0, 'smash counter should start at 0');
  assert(h.text('best') === '', `fresh install should show no best, got "${h.text('best')}"`);
  assert(h.text('kidTag') === 'Oliver', `expected to default to Oliver, got "${h.text('kidTag')}"`);
  assert(h.hidden('partyTag'), 'no pillow party on the menu');
  pump(h, 60);
  assert(h.num('slams') === 0, 'nothing should be smashed while still on the menu');
  return h;
});

for (const [label, start] of Object.entries(STARTERS)) {
  test(`daddy: starts and gets smashed from ${label}`, note => {
    const h = createHarness('daddy-smash', { seed: 42 });
    assert(!h.hidden('startScreen'), 'precondition: menu visible');
    start(h);
    pump(h, 5);
    assert(h.hidden('startScreen'), `${label} did not start the game`);

    // then stand still, which is the surest way to be caught
    pump(h, 2500);
    const slams = h.num('slams');
    assert(slams > 0, `standing still for 2500 frames should get you caught, got ${slams}`);
    assert(/got smashed/i.test(h.text('catchLine')), `no smash shout, got "${h.text('catchLine')}"`);
    note(`${slams} smashes, last shout "${h.text('catchLine')}"`);
    return h;
  });
}

/* Every way in to the same vector: held keys, the analogue stick, the d-pad
   and a finger held on the glass. All four have to steer, because all four
   are things that will actually happen in this house. */
const STEERERS = [
  ['held arrow keys', h => h.keyDown('ArrowLeft'), h => h.keyDown('ArrowRight')],
  ['WASD', h => h.keyDown('a'), h => h.keyDown('d')],
  ['the analogue stick', h => h.stick(-1, 0), h => h.stick(1, 0)],
  ['the d-pad', h => h.padHold('left', true), h => h.padHold('right', true)],
  ['a finger held on the glass', h => h.pointerHold(0.02, 0.95), h => h.pointerHold(0.98, 0.99)],
];

for (const [label, goLeft, goRight] of STEERERS) {
  test(`daddy: steering with ${label}`, note => {
    const left = holdRun(goLeft, 900);
    assert(left.seen.has(SPOTS.plant),
      `holding left should reach the plant in the far left corner, only saw ${[...left.seen].join(', ')}`);
    left.h.dispose();

    const right = holdRun(goRight, 900);
    assert(right.seen.has(SPOTS.dogbed),
      `holding right should reach the dog bed, only saw ${[...right.seen].join(', ')}`);
    note(`left → ${[...left.seen].join(' / ')}   right → ${[...right.seen].join(' / ')}`);
    return right.h;
  });
}

/* Daddy spawns mid-room at z:34, not down at the kids' z:88, so the plant is
   not in his lane and the landmarks either side of him are the toy box and
   the big chair. Holding one way then the other is the honest question:
   a Daddy nobody is driving would wander after the kids instead. */
test('daddy: steering Daddy walks him across the room', note => {
  const h = createHarness('daddy-smash', { seed: 11 });
  h.click('pickDaddy');
  h.click('startBtn');
  pump(h, 5);

  h.keyDown('ArrowLeft');
  const goingLeft = new Set();
  for (let i = 0; i < 900; i++) { pump(h, 1); goingLeft.add(h.text('whereTag')); }
  assert(goingLeft.has('🧸 the toy box'), `holding left never walked Daddy to the toy box: ${[...goingLeft].join(', ')}`);

  h.keyUp('ArrowLeft');
  h.keyDown('ArrowRight');
  const goingRight = new Set();
  for (let i = 0; i < 900; i++) { pump(h, 1); goingRight.add(h.text('whereTag')); }
  assert(goingRight.has('🪑 the big chair'), `holding right never walked Daddy to the big chair: ${[...goingRight].join(', ')}`);

  note(`left → ${[...goingLeft].join(' / ')}   right → ${[...goingRight].join(' / ')}`);
  return h;
});

/* Releasing has to actually release, and "did they stop?" is the wrong way
   to ask: being grabbed carries the kid across the room, so the position
   moves for reasons that have nothing to do with the key. Ask it the other
   way instead — go left, let go, then go right. A key that stayed stuck
   down would cancel the new direction out (axis() sums its inputs) and the
   dog bed on the far side would never be reached. */
test('daddy: letting go of a key really lets go', note => {
  const h = createHarness('daddy-smash', { seed: 6 });
  h.tap();
  pump(h, 5);
  h.keyDown('ArrowLeft');
  const goingLeft = new Set();
  for (let i = 0; i < 500; i++) { pump(h, 1); goingLeft.add(h.text('whereTag')); }
  assert(goingLeft.has(SPOTS.plant), `holding left never reached the plant: ${[...goingLeft].join(', ')}`);

  h.keyUp('ArrowLeft');
  h.keyDown('ArrowRight');
  const goingRight = new Set();
  for (let i = 0; i < 900; i++) { pump(h, 1); goingRight.add(h.text('whereTag')); }
  // any landmark down the right-hand wall will do: being smashed part-way
  // through drops the kid back in a different lane, so which one they meet
  // is luck — reaching that side of the room at all is the actual question
  const right = [...goingRight].filter(w => RIGHT_SIDE.includes(w));
  assert(right.length,
    `left looks stuck down — right never got across the room: ${[...goingRight].join(', ')}`);
  note(`left → plant, released, right → ${right.join(' / ')}`);
  return h;
});

/* Not tested here: "running away means fewer smashes than standing still".
   It is true — a driver that flees Daddy tangentially gets caught every ~32
   seconds against every ~15 for one that never moves, measured over seven
   seeds — but proving it needs a robot that can see where Daddy is, and he
   is deliberately not in the DOM. A fixed pattern (lap the room, turn every
   45 frames) is not evasion and scores the same as standing still, so a
   test built on one would only be measuring its own driver. Checked with a
   throwaway probe instead; DAD_WALK is tuned off those numbers. */

test('daddy: near misses fill the giggle meter without anybody being caught', note => {
  // The WHOOSH is the reward for the running itself, and it has to land
  // before the first smash does or a kid who is good at this gets nothing.
  const h = createHarness('daddy-smash', { seed: 31 });
  h.tap();
  pump(h, 5);
  const width = () => parseFloat(h.styleOf('giggleFill', 'width')) || 0;
  assert(width() === 0, `the meter should start empty, got "${h.styleOf('giggleFill', 'width')}"`);

  let filledBeforeASmash = false;
  for (let i = 0; i < 4000; i++) {
    pump(h, 1);
    if (h.num('slams') > 0) break;
    if (width() > 0) { filledBeforeASmash = true; break; }
  }
  assert(filledBeforeASmash,
    `the giggle meter never moved before the first smash — near misses are not paying out`);
  note(`meter reading ${h.styleOf('giggleFill', 'width')} after ${h.frameCount} frames, still 0 smashes`);
  return h;
});

test('daddy: both kids get smashed, not just the one you drive', note => {
  const h = createHarness('daddy-smash', { seed: 17 });
  h.tap();
  const seen = new Set();
  for (let i = 0; i < 6000 && seen.size < 2; i++) {
    pump(h, 1);
    const m = /^(\w+) got smashed/i.exec(h.text('catchLine'));
    if (m) seen.add(m[1]);
  }
  assert(seen.has('Oliver'), `Oliver never got smashed: saw ${[...seen].join(', ') || 'nobody'}`);
  assert(seen.has('Emsile'), `Emsile never got smashed: saw ${[...seen].join(', ') || 'nobody'}`);
  note(`both smashed within ${h.frameCount} frames`);
  return h;
});

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

test('daddy: the pillow party arrives, then packs itself away', note => {
  const h = createHarness('daddy-smash', { seed: 5 });
  h.tap();
  const started = h.until(() => !h.hidden('partyTag'), 6000, 'the pillow party to start');
  assert(h.hasClass('giggleMeter', 'full'), 'the giggle meter should read full during the party');
  const lasted = h.until(() => h.hidden('partyTag'), 2000, 'the pillow party to end');
  assertBetween(lasted, 500, 900, 'the pillow party ran for the wrong number of frames');

  // and the meter empties out ready to fill again
  assert(!h.hasClass('giggleMeter', 'full'), 'the meter should reset once the party is over');
  const again = h.until(() => !h.hidden('partyTag'), 8000, 'a second pillow party');
  note(`first party after ${started} frames, lasted ${lasted}, second ${again} frames later`);
  return h;
});

test('daddy: swapping which kid you are', note => {
  const h = createHarness('daddy-smash', { seed: 12 });
  h.tap();
  pump(h, 60);
  assert(h.text('kidTag') === 'Oliver', `expected to start as Oliver, got "${h.text('kidTag')}"`);

  // X on a pad — the one button in the kit that isn't a jump
  h.padPress('x');
  pump(h, 12);
  assert(h.text('kidTag') === 'Emsile', 'gamepad X did not swap the kids');

  // and the button on the kid's side of the screen cycles to the next kid
  h.click('swapBtn');
  pump(h, 12);
  assert(h.text('kidTag') === 'Daddy', 'the swap button did not cycle to Daddy');

  // and cycles back through Oliver
  h.click('swapBtn');
  pump(h, 12);
  assert(h.text('kidTag') === 'Oliver', 'the swap button did not cycle back to Oliver');

  // the game carries on, and whoever you are can still be caught
  const before = h.num('slams');
  pump(h, 2500);
  assert(h.num('slams') > before, 'the chase stopped after swapping');
  note(`cycled through all three characters, ${h.num('slams')} smashes total`);
  return h;
});

test('daddy: choosing Emsile on the menu sticks across a reload', note => {
  let h = createHarness('daddy-smash', { seed: 4 });
  h.click('pickEmsile');
  h.click('startBtn');
  pump(h, 30);
  assert(h.text('kidTag') === 'Emsile', `picking Emsile did not take, got "${h.text('kidTag')}"`);
  assert(h.store['daddy-smash-kid'] === 'emsile', `storage says "${h.store['daddy-smash-kid']}"`);

  h = h.reload();
  assert(h.text('kidTag') === 'Emsile', `after reload the game forgot, showing "${h.text('kidTag')}"`);
  assert(!h.hidden('startScreen'), 'reload should land back on the menu');
  note('Emsile remembered across a reload');
  return h;
});

test('daddy: choosing Daddy on the menu sticks across a reload', note => {
  let h = createHarness('daddy-smash', { seed: 9 });
  h.click('pickDaddy');
  h.click('startBtn');
  pump(h, 30);
  assert(h.text('kidTag') === 'Daddy', `picking Daddy did not take, got "${h.text('kidTag')}"`);
  assert(h.store['daddy-smash-kid'] === 'daddy', `storage says "${h.store['daddy-smash-kid']}"`);

  // test swapping away from Daddy and cycling back through Oliver and Emsile
  h.click('swapBtn');
  pump(h, 12);
  assert(h.text('kidTag') === 'Oliver', 'swap away from Daddy should cycle to Oliver');
  h.click('swapBtn');
  pump(h, 12);
  assert(h.text('kidTag') === 'Emsile', 'swap from Oliver should cycle to Emsile');
  h.click('swapBtn');
  pump(h, 12);
  assert(h.text('kidTag') === 'Daddy', 'swap from Emsile should cycle back to Daddy');

  h = h.reload();
  assert(h.text('kidTag') === 'Daddy', `after reload the game forgot, showing "${h.text('kidTag')}"`);
  assert(!h.hidden('startScreen'), 'reload should land back on the menu');
  note('Daddy remembered across a reload');
  return h;
});

test('daddy: best smash count survives a reload', note => {
  let h = createHarness('daddy-smash', { seed: 21 });
  assert(h.text('best') === '', `fresh install should show no best, got "${h.text('best')}"`);
  h.tap();
  pump(h, 4000);

  const slams = h.num('slams');
  assert(slams > 0, 'need some smashes before testing persistence');
  assert(h.text('best') === 'Best ' + slams, `best label out of step: "${h.text('best')}" vs ${slams}`);

  // saveBest() debounces behind a 1200ms setTimeout, so pump past it
  pump(h, 100);
  assert(h.store['daddy-smash-best'] !== undefined, 'nothing was written to storage');
  const stored = Number(h.store['daddy-smash-best']);
  assert(stored >= slams, `stored ${stored} is behind the ${slams} already smashed`);
  note(`smashed ${slams}, storage now ${JSON.stringify(h.store)}`);

  h = h.reload();
  assert(h.text('best') === 'Best ' + stored,
    `after reload best showed "${h.text('best')}", expected "Best ${stored}"`);
  assert(h.num('slams') === 0, 'the counter should reset to 0 on reload');
  return h;
});

test('daddy: 20000 frames of never moving, and it still never ends', note => {
  // The kid who puts the controller down is the one this game has to be
  // safe for: no lives, no game over, just smash after smash after smash.
  const h = createHarness('daddy-smash', { seed: 3 });
  h.tap();
  pump(h, 20000);
  const slams = h.num('slams');
  assert(slams > 20, `expected a pile of smashes after 20000 idle frames, got ${slams}`);
  assert(h.hidden('startScreen'), 'the game must never bounce back to the menu — there is no game over');
  assert(h.timerCount < 50, `timer leak: ${h.timerCount} still pending`);
  note(`${slams} smashes, ${h.timerCount} timers alive`);
  note(`audio nodes built: ${h.audioStats.oscillators} oscillators, ${h.audioStats.sources} buffer sources`);
  return h;
});

test('daddy: 20000 frames of hard running never throws either', note => {
  const h = createHarness('daddy-smash', { seed: 77 });
  h.tap();
  pump(h, 5);
  lapTheRoom(h, 20000);
  assert(h.hidden('startScreen'), 'still playing');
  assert(h.timerCount < 50, `timer leak: ${h.timerCount} still pending`);
  note(`${h.num('slams')} smashes while running, still going`);
  return h;
});

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

/* A blind driver: it laps the room and never reacts to where the kids are,
   so this measures "can a steered Daddy catch anybody at all", not skill —
   but it has to be a seed/budget pair the auto-lunge actually has to earn,
   or a regression to the old AI-committed target would pass it too.
   Numbers below are first-catch frame, measured with a probe that mirrors
   this test exactly (click, click, 5 idle frames, then the 90-frame leg
   pattern) — an earlier version of this measurement skipped that 5-frame
   gap and gave numbers that didn't hold up here, so re-measure with the
   probe if this ever needs revisiting rather than trusting a stale table.
   Before the nearest-catchable retargeting / after: 3 → 1026/1584,
   9 → 865/1188, 11 → 847/1380, 17 → 2983/3331, 23 → 1104/865,
   42 → 2899/1452, 77 → 865/709. Most seeds get caught on both sides of the
   fix (this game is forgiving even to a lucky AI-committed target), so the
   only seed with real daylight between "before" and "after" is 42: 2899
   frames before the fix, 1452 after. CHASE_FRAMES = 2200 sits in that gap
   — 699 frames of margin below the pre-fix catch (a reverted retargeting
   is still empty-handed here) and 748 above the post-fix one. Confirmed by
   actually reverting the human branch to `daddy.chase` and re-running:
   FAILS (0 smashes) before the fix, PASSES after. */
test('daddy: chasing as Daddy catches a kid, with no button pressed', note => {
  const CHASE_FRAMES = 2200;
  const h = createHarness('daddy-smash', { seed: 42 });
  h.click('pickDaddy');
  h.click('startBtn');         // the only click; h.tap() is never called again
  pump(h, 5);

  // catchLine is a transient shout that other events (the pillow party, in
  // particular) overwrite, so sampling it once at the final frame is a coin
  // flip on whatever happens to be on screen at that instant. Collect it
  // across the whole run instead — same approach as "both kids get smashed,
  // not just the one you drive" above. lapTheRoom() pumps internally and
  // gives no chance to sample in between, so its leg-changing pattern (same
  // legs, same 90-frame cadence) is inlined here rather than reused.
  const legs = [[1, 0], [0, -1], [-1, 0], [0, 1]];
  const smashed = new Set();
  for (let i = 0; i < CHASE_FRAMES; i++) {
    if (i % 90 === 0) {
      const [x, y] = legs[(i / 90) % legs.length];
      h.stick(x, y);
    }
    pump(h, 1);
    const m = /^(\w+) got smashed/i.exec(h.text('catchLine'));
    if (m) smashed.add(m[1]);
  }

  const slams = h.num('slams');
  assert(slams > 0, `${CHASE_FRAMES} frames of chasing as Daddy caught nobody`);
  assert(smashed.size > 0,
    `${slams} smashes happened but no "got smashed" shout was ever seen on screen`);
  note(`${slams} smashes as Daddy, steering only (shouted for: ${[...smashed].join(', ') || 'nobody'})`);
  return h;
});

/* ================================================================ *
 * KidKit — the TV cursor
 *
 * A telly browser draws a mouse cursor over the page and lets the left
 * stick shove it around. The game is a rectangle in the middle of the
 * screen, so that cursor spends most of its life in the dead space around
 * it, and when it slides off the page entirely the browser chrome takes
 * focus: keydown stops arriving, getGamepads() freezes, and every button
 * on the controller goes dead with nothing on screen to say why.
 * ================================================================ */

test('kit: a press in the dead space around the game still counts', note => {
  const h = createHarness('oliver-run');
  assert(!h.hidden('startScreen'), 'should start on the menu');
  h.tapPage(-1.5, 0.5);                 // well off to the left of the box
  pump(h, 120);
  assert(h.hidden('startScreen'), 'a press beside the game should still start it');
  const after = h.num('score');
  assert(after > 0, 'the game should be running after a press outside the box');
  note(`started from a press outside the stage, score ${after}`);
  return h;
});

test('kit: steering works with the cursor parked outside the game too', note => {
  const h = createHarness('daddy-smash', { seed: 6 });
  h.tap();
  pump(h, 5);
  // held out beyond the left edge — clamps to the edge, not to the middle
  h.pageHold(-2, 0.5);
  const seen = new Set();
  for (let i = 0; i < 700; i++) { pump(h, 1); seen.add(h.text('whereTag')); }
  assert(seen.has('🪴 the plant'),
    `holding left of the box should still run left, only saw ${[...seen].join(', ')}`);
  h.pageRelease();
  note(`ran to ${[...seen].join(' / ')}`);
  return h;
});

test('kit: losing focus puts up a way back, and a press takes it', note => {
  const h = createHarness('daddy-smash', { seed: 9 });
  h.tap();
  pump(h, 30);
  assert(!h.byId('kk-focus-guard'), 'nothing should be covering the game while focus is fine');

  h.loseFocus();
  pump(h, 6);
  const early = h.byId('kk-focus-guard');
  assert(!early || early.style.display === 'none',
    'a blink of lost focus should not flash a panel over the game');

  pump(h, 90);                          // ~1.5s: past the guard's delay
  const panel = h.byId('kk-focus-guard');
  assert(panel, 'a lost cursor should put something on screen saying how to come back');
  assert(panel.style.display === 'flex', `guard should be showing, display was "${panel.style.display}"`);
  assert(/press any button/i.test(panel.innerHTML), 'the way back has to say what to press');

  // pressing it is what hands focus back — and the panel gets out of the way
  h.regainFocus();
  panel.dispatchEvent({ type: 'pointerdown', target: panel, preventDefault() {}, stopPropagation() {} });
  pump(h, 30);
  assert(panel.style.display === 'none', 'the panel must clear once focus is back');
  assert(h.hidden('startScreen'), 'and the game underneath is still running, not reset');
  note('guard appeared after ~1s unfocused, cleared on the press that brought focus home');
  return h;
});

test('kit: a key held when focus is lost does not stay stuck', note => {
  const h = createHarness('daddy-smash', { seed: 11 });
  h.tap();
  pump(h, 5);
  h.keyDown('ArrowLeft');
  const goingLeft = new Set();
  for (let i = 0; i < 500; i++) { pump(h, 1); goingLeft.add(h.text('whereTag')); }
  assert(goingLeft.has('🪴 the plant'), `never got left: ${[...goingLeft].join(', ')}`);

  // the cursor wanders off; the keyup for that arrow is never delivered
  h.loseFocus();
  h.regainFocus();
  h.keyDown('ArrowRight');
  const goingRight = new Set();
  for (let i = 0; i < 900; i++) { pump(h, 1); goingRight.add(h.text('whereTag')); }
  const right = [...goingRight].filter(w => RIGHT_SIDE.includes(w));
  assert(right.length,
    `left stayed stuck down through the blur — right never got across: ${[...goingRight].join(', ')}`);
  note(`held left, lost focus, then right → ${right.join(' / ')}`);
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
