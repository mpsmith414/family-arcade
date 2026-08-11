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

/* In POWERS order, which is what h.bucket(k, 10) pins. */
const POWER_NAMES = [
  'RIDE THE DOG', 'FIRE RING', 'GIANT MODE', 'TINY MODE', 'STAR MAGNET',
  'ROCKET BOOTS', 'FLAPPY WINGS', 'LIGHTNING', 'BOUNCY BUBBLE', 'FREEZE RAY',
];

/* REGRESSION GUARD — green before and after every task, by design. That is
   the entire point: it proves nothing changed. Do not "fix" it into a
   red-first test; inverting it would destroy the invariance proof.

   A run with no jump and no hold input never leaves the ground, so it can
   never touch a platform or a gold star — which means the sky lane must not
   perturb this by so much as one RNG draw. If this test fails after a
   sky-lane change, the separate-PRNG rule was broken somewhere, most likely
   in drawing code calling Math.random(). Weather is on the same footing: it
   has its own PRNG (TUNE.wxSeed) and must stay off Math.random() too.

   RE-BASELINED three times, deliberately: when the ten later worlds landed and
   the level order became a shuffle; when the ground filled up with critters and
   power-ups stopped expiring; and when a world got longer than a boss fight
   (RUN_FRAMES 1500 -> 2600, which is why one trophy shows here where two used
   to). All of those ARE the ground lane — spawns, running order and the length
   of a world move the stream by design — so the old numbers could not survive
   and re-capturing them was the honest answer. What the guard proves is unchanged, because the proof was never the
   literal numbers: it is that the two runs below, one holding the button and
   one not, agree with each other to the draw. Re-capture only for a change
   that is deliberately about the ground lane, and never to make a red test
   go quiet. */
const GROUND_BASELINE = { "score": 4758, "level": "Mushroom Forest", "trophies": "🏆", "rng": "1548658:3b3bb5b4" };

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
/* Adventure shuffles its worlds, so the menu shows whichever one came up
   first rather than a fixed opener. */
const LEVEL_NAMES = [
  'Rooftop City', 'Dino Jungle', 'Space Station', 'Coral Reef',
  'Candy Kingdom', 'Frozen Peaks', 'Volcano Rush', 'Haunted Hollow',
  'Cloud Castle', 'Robot Factory', 'Golden Dunes', 'Mushroom Forest',
  'Neon Speedway', 'Pirate Cove',
];

test('boots and reaches the menu', note => {
  const h = createHarness('oliver-run');
  note(`loaded ${h.loaded.join(', ')}`);
  note(`opening world: ${h.text('lvlName')}`);
  assert(LEVEL_NAMES.includes(h.text('lvlName')),
    `menu should name one of the worlds, got "${h.text('lvlName')}"`);
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
 * A power lasts until you pick up another one — there is no timer to run
 * down, so these prove the two things that replaced it: that holding one
 * lasts, and that grabbing another swaps it.
 *
 * Orbs spawn at one of two heights. The high one (GROUND-152) is out of
 * reach standing up, so collecting it proves a mid-air pickup; the low one
 * (GROUND-72) is collectable flat-footed. Biasing the RNG into a bucket
 * pins which power comes up, and — because the same draw decides the
 * height — which of the two pickups we are exercising: with ten powers,
 * buckets 0-4 draw under .5 and give the high orb.
 * ---------------------------------------------------------------- */
/* Pops are painted to the canvas and never reach the DOM, so they are counted
   off h.painted(). A pop lives 58 frames and is stroked and filled on each of
   them, so one pop is ~116 entries — hence "roughly how many", not "exactly". */
function poppedRoughly(h, re) {
  return Math.round(h.painted().filter(s => re.test(s)).length / 116);
}

const GROUND_PICKUP = [];
const AIR_PICKUP = [];

for (let k = 0; k < POWER_NAMES.length; k++) {
  const expected = POWER_NAMES[k];
  const airborne = k < 5;
  test(`power-up ${expected} activates and stays (${airborne ? 'mid-jump' : 'from the ground'})`, note => {
    const h = createHarness('oliver-run', { seed: 1234 });
    h.bucket(k, POWER_NAMES.length);
    h.tap();
    if (airborne) h.holdJump(true);

    const waited = h.until(() => !h.hidden('powerTag'), 12000, `${expected} to be picked up`);
    const name = h.text('powerName');
    assert(name === expected, `expected "${expected}", got "${name}"`);
    (airborne ? AIR_PICKUP : GROUND_PICKUP).push(name);

    // No timer to wait out. It has to survive far longer than any of the old
    // durations (the longest was 900 frames) and still be the same power.
    h.holdJump(false);
    pump(h, 2500);
    assert(!h.hidden('powerTag'), `${expected} disappeared on its own — powers must last until swapped`);
    assert(h.text('powerName') === expected,
      `${expected} turned into "${h.text('powerName')}" without an orb being collected`);

    const after = h.num('score');
    pump(h, 400);
    assert(h.num('score') > after, 'score stopped rising while the power was held');
    note(`picked up after ${waited} frames, still held 2900 frames later`);
    return h;
  });
}

test('power-ups: all ten seen, from both the ground and mid-jump', note => {
  const seen = new Set([...GROUND_PICKUP, ...AIR_PICKUP]);
  assert(seen.size === POWER_NAMES.length,
    `only saw ${seen.size} of ${POWER_NAMES.length} power-ups: ${[...seen].join(', ')}`);
  assert(AIR_PICKUP.length > 0, 'no power-up was collected mid-jump');
  assert(GROUND_PICKUP.length > 0, 'no power-up was collected from the ground');
  note(`mid-jump: ${AIR_PICKUP.join(', ')}`);
  note(`ground:   ${GROUND_PICKUP.join(', ')}`);
});

/* The other half of "lasts until you grab another": that grabbing another
   really does take it. Two different buckets, one after the other. */
test('power-ups: a second orb swaps the power', note => {
  const h = createHarness('oliver-run', { seed: 1234 });
  h.bucket(0, POWER_NAMES.length);              // RIDE THE DOG
  h.tap();
  h.holdJump(true);
  h.until(() => !h.hidden('powerTag'), 12000, 'the first power');
  const first = h.text('powerName');
  assert(first === POWER_NAMES[0], `expected ${POWER_NAMES[0]}, got "${first}"`);

  h.bucket(7, POWER_NAMES.length);              // LIGHTNING from here on
  const swapped = h.until(() => h.text('powerName') !== first, 12000, 'the swap');
  assert(h.text('powerName') === POWER_NAMES[7],
    `expected ${POWER_NAMES[7]} after the swap, got "${h.text('powerName')}"`);
  assert(!h.hidden('powerTag'), 'the badge should never blink off during a swap');
  // The badge changes the instant the orb is taken; the announcement waits its
  // turn in the queue behind whatever is already on screen, so give it one.
  h.until(() => h.paintedSome(/Swapped/), 1200, 'the swap to be announced');
  note(`${first} -> ${h.text('powerName')} after ${swapped} frames`);
  return h;
});

/* Wings exist so a small player can simply stay up — and the rule they must
   not break is the one behind every design decision in this game: a kid who
   mashes the button is never worse off than one who doesn't.

   They broke it twice while being built, both times invisibly. Clamping each
   flap to a fixed lift left a tapping kid hovering at knee height, below the
   platforms a plain jump reaches. Letting the flaps stack without limit
   pinned them to the top of the screen, cruising over every star in the game.
   Gold stars are the measure because they only exist up in the sky lane, and
   the sky lane runs off a fixed seed — so the same stars are on offer in every
   run, and the only variable is whether the kid could get to them. */
test('power-ups: wings never leave a masher worse off than a jump', note => {
  const goldWith = k => {
    const h = createHarness('oliver-run', { seed: 77 });
    h.bucket(k, POWER_NAMES.length);
    h.tap();
    runCycles(h, 6000, 3, 14);              // tap, tap, tap, all the way
    const gold = poppedRoughly(h, /^\+50$/);
    const score = h.num('score');
    h.dispose();
    return { gold, score };
  };
  const wings = goldWith(6);                 // FLAPPY WINGS
  const boots = goldWith(5);                 // ROCKET BOOTS, the control
  note(`wings ${wings.gold} gold / ${wings.score} pts vs boots ${boots.gold} / ${boots.score}`);
  assert(wings.gold >= boots.gold,
    `flying collected fewer gold stars than jumping (${wings.gold} vs ${boots.gold}) — ` +
    `the flap is either too weak to climb or too strong to come back down`);
  assert(wings.gold > 0, 'a flying kid reached no gold stars at all');
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

/* Depth is still earned — the deepest water the book has unlocked only ever
   goes deeper — but the boat no longer parks there for ever. It drifts, so
   the shallows come back around, which is the whole point of the change. */
test('fishing: the water gets deeper as the book fills', note => {
  const h = createHarness('emsile-fishing', { seed: 8 });
  h.click('startBtn');
  const deepestSeen = [];
  const visited = new Set();
  for (let i = 0; i < 30000; i++) {
    if (i % 10 === 0) h.tap();
    pump(h, 1);
    const z = h.text('zoneName');
    visited.add(z);
    const rank = ZONE_NAMES.indexOf(z);
    const best = deepestSeen.length ? ZONE_NAMES.indexOf(deepestSeen[deepestSeen.length - 1]) : -1;
    if (rank > best) deepestSeen.push(z);
  }
  note(`deepest reached in order: ${deepestSeen.join(' → ')}`);
  note(`zones the boat visited: ${[...visited].join(', ')}`);
  assert(visited.size === ZONE_NAMES.length,
    `only saw ${visited.size} of ${ZONE_NAMES.length} zones: ${[...visited].join(', ')}`);
  for (let i = 0; i < deepestSeen.length; i++) {
    assert(deepestSeen[i] === ZONE_NAMES[i],
      `new depths arrived out of order: ${deepestSeen.join(' → ')}`);
  }
  return h;
});

/* REGRESSION GUARD, and the one that matters most in this game.
   "Mashing is always rewarded, never punished" is the rule the whole design
   rests on, and it was being broken by two clamps written the wrong way
   round. A wiggle did waitLeft = max(18, waitLeft - CUT), which PUT THE
   TIMER BACK UP once the wait was already under 18 — so a child tapping
   faster than once every 18 frames reset it for ever and never got a single
   bite. The reel had the same shape of bug and could be held short of the
   end for ever the same way. Both were live on the site.

   A soft-lock is the worst possible failure in a game with no fail state,
   and it hit precisely the most enthusiastic player. So: tap at every
   cadence from every frame to every 40, and the catch count must not only
   be non-zero, it must go UP as the tapping gets faster. */
test('fishing: mashing catches more, at every possible tapping speed', note => {
  const rows = [];
  for (const gap of [1, 2, 3, 5, 7, 8, 9, 10, 13, 17, 25, 40]) {
    const h = createHarness('emsile-fishing', { seed: 2 });
    h.click('startBtn');
    for (let i = 0; i < 6000; i++) {
      if (i % gap === 0) h.tap();
      pump(h, 1);
    }
    const caught = h.num('catches');
    rows.push({ gap, caught });
    assert(caught > 0,
      `tapping every ${gap} frames caught nothing in 6000 frames — the wait or the reel is stuck`);
    h.dispose();
  }
  note(rows.map(r => `every ${r.gap}f: ${r.caught}`).join(', '));
  const fastest = rows[0].caught, slowest = rows[rows.length - 1].caught;
  assert(fastest > slowest,
    `mashing should beat dawdling: ${fastest} at every frame vs ${slowest} every 40`);
});

/* ---------------------------------------------------------------- *
 * fishing: things that happen
 * ---------------------------------------------------------------- */

/* The events are announced on the canvas, never in the DOM, so this reads
   the screen the way a person would. */
test('fishing: the sea does things while you fish', note => {
  const h = createHarness('emsile-fishing', { seed: 2 });
  h.click('startBtn');
  for (let i = 0; i < 16000; i++) {
    if (i % 9 === 0) h.tap();
    pump(h, 1);
  }
  const wanted = ['A SHOAL!', 'DOLPHINS!', 'RAIN!', 'NIGHT FALLS', 'SOMETHING GLINTS', 'A BOTTLE!'];
  const seen = wanted.filter(w => h.painted().includes(w));
  note(`seen: ${seen.join(', ')}`);
  assert(seen.length >= 5, `only ${seen.length} of ${wanted.length} events turned up: ${seen.join(', ')}`);
  return h;
});

test('fishing: the boat drifts back to water it has already fished', note => {
  const h = createHarness('emsile-fishing', { seed: 4 });
  h.click('startBtn');
  let wentBack = false;
  let deepest = 0;
  for (let i = 0; i < 30000; i++) {
    if (i % 9 === 0) h.tap();
    pump(h, 1);
    const rank = ZONE_NAMES.indexOf(h.text('zoneName'));
    if (rank > deepest) deepest = rank;
    if (rank < deepest) wentBack = true;      // shallower than the deepest reached
  }
  assert(h.paintedSome(/THE BOAT DRIFTS/), 'the boat never drifted anywhere');
  assert(wentBack, 'the boat never went back to shallower water — the zone is still a one-way ratchet');
  note(`drifted back up from ${ZONE_NAMES[deepest]} after ${h.num('catches')} catches`);
  return h;
});

/* Every event is a gift. None of them may cost a catch, so a run full of
   them has to out-fish a quiet one rather than under-fish it. */
test('fishing: events never cost you a catch', note => {
  const h = createHarness('emsile-fishing', { seed: 2 });
  h.click('startBtn');
  for (let i = 0; i < 12000; i++) {
    if (i % 10 === 0) h.tap();
    pump(h, 1);
  }
  const caught = h.num('catches');
  note(`${caught} catches in 12000 frames with events running`);
  // 12000 frames is ~200s; a quiet cycle is ~7s, so anything near 25 is healthy
  assert(caught >= 25, `only ${caught} catches — events are getting in the way`);
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

/* Every finisher shouts a different line, but all of them lead with who it
   happened to — which is what a kid listens for, and what these tests read
   to find out who got caught. */
const SMASH_LINE = /^(\w+) (?:got smashed|flew round|cannonballed|got the whole dogpile|got rolled up)/i;

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
    // The shout line is shared with the pillow party and anything else that
    // has something to say, so watch it across the run rather than reading it
    // once at the end and hoping a finisher was the last thing to speak.
    const shouts = new Set();
    for (let i = 0; i < 2500; i++) {
      pump(h, 1);
      const line = h.text('catchLine');
      if (line) shouts.add(line);
    }
    const slams = h.num('slams');
    assert(slams > 0, `standing still for 2500 frames should get you caught, got ${slams}`);
    const smashShouts = [...shouts].filter(l => SMASH_LINE.test(l));
    assert(smashShouts.length > 0,
      `${slams} smashes but no finisher shout among: ${[...shouts].join(' / ')}`);
    note(`${slams} smashes, shouted: ${smashShouts.join(' / ')}`);
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
    const m = SMASH_LINE.exec(h.text('catchLine'));
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
    const m = SMASH_LINE.exec(h.text('catchLine'));
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

/* The mirror of "20000 frames of never moving": there the kid never moves
   and Daddy's own chase AI closes the distance regardless. Here Daddy is the
   one nobody is steering — move(daddy, 0, 0, ...) — and nothing compensates
   for that the way the AI does for a stationary kid, so a fully idle Daddy
   may rack up few catches, or none at all, over the whole run. That dry
   spell is the design working as intended (a long stretch with nobody
   caught is the failure state the game is tuned against, not a crash), so
   this does not assert slams > 0 — only that idle play never ends the game
   or leaks timers. */
test('daddy: 20000 idle frames as Daddy never throws either', note => {
  const h = createHarness('daddy-smash', { seed: 3 });
  h.click('pickDaddy');
  h.click('startBtn');
  pump(h, 20000);
  assert(h.hidden('startScreen'), 'the game must never bounce back to the menu — there is no game over');
  assert(h.timerCount < 50, `timer leak: ${h.timerCount} still pending`);
  note(`${h.num('slams')} smashes, ${h.timerCount} timers alive, entirely idle as Daddy`);
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
    const m = SMASH_LINE.exec(h.text('catchLine'));
    if (m) smashed.add(m[1]);
  }

  const slams = h.num('slams');
  assert(slams > 0, `${CHASE_FRAMES} frames of chasing as Daddy caught nobody`);
  assert(smashed.size > 0,
    `${slams} smashes happened but no finisher shout was ever seen on screen`);
  note(`${slams} smashes as Daddy, steering only (shouted for: ${[...smashed].join(', ') || 'nobody'})`);
  return h;
});

/* The raise-phase wiggle gate was widened to `(k === player() ||
   playerIdx === 2)` so a human-driven Daddy also earns giggle credit for
   working the stick while he holds a kid overhead — previously only the
   `k === player()` half (a human-driven kid) was reachable. Nothing
   exercised the new half.

   Movement during the whole set piece (grab/carry/raise/drop/bounce) never
   reads player input — only the raise phase's wiggle score does — so if two
   runs share a seed and share their steering right up until the catch, the
   catch lands on the exact same frame in both, no matter what either run
   does with the stick afterwards. That makes an apples-to-apples comparison
   possible: lap the room identically into the catch, then one run holds the
   stick hard over through the raise and the other centres it, and read the
   giggle meter the instant before `land()` adds its own flat +20.

   Centred can only ever produce `wiggle <= 0.5`, so `addGiggle(0.5)`'s
   Math.random() check never even runs — its contribution during the raise
   is provably zero, not just usually zero. So the comparison only needs the
   wiggling run to land one lucky 10%-chance tick in its ~26-frame window,
   which a quick calibration pass below confirms it does for this seed. */
test('daddy: wiggling the stick while Daddy holds a kid overhead fills the giggle meter faster', note => {
  const seed = 42;
  const legs = [[1, 0], [0, -1], [-1, 0], [0, 1]];
  const lap = (h, i) => {
    if (i % 90 === 0) { const [x, y] = legs[(i / 90) % legs.length]; h.stick(x, y); }
  };

  // A reference run — lapping the room the whole way, never diverging — just
  // to find which frame the catch resolves on for this seed/script.
  function findLandFrame(budget) {
    const h = createHarness('daddy-smash', { seed });
    h.click('pickDaddy');
    h.click('startBtn');
    pump(h, 5);
    let prevSlams = 0, landAt = -1;
    for (let i = 0; i < budget && landAt === -1; i++) {
      lap(h, i);
      pump(h, 1);
      if (h.num('slams') > prevSlams) landAt = i;
      prevSlams = h.num('slams');
    }
    h.dispose();
    return landAt;
  }

  const refLand = findLandFrame(3000);
  assert(refLand > 0, 'reference run never caught anybody to calibrate the comparison against');
  // 60 frames short of the catch is comfortably inside the fixed 16-frame
  // grab (grab always follows immediately once the catch resolves), so
  // switching the stick there can never be early enough to change who gets
  // caught, when, or where.
  const D = Math.max(0, refLand - 60);

  function runBranch(branch) {
    const h = createHarness('daddy-smash', { seed });
    h.click('pickDaddy');
    h.click('startBtn');
    pump(h, 5);
    let prevSlams = 0, landAt = -1, widthBeforeLand = null;
    for (let i = 0; i < refLand + 50 && landAt === -1; i++) {
      if (i < D) lap(h, i);
      else if (i === D) h.stick(branch === 'wiggle' ? 1 : 0, branch === 'wiggle' ? 1 : 0);
      const w = parseFloat(h.styleOf('giggleFill', 'width')) || 0;
      pump(h, 1);
      if (h.num('slams') > prevSlams) { landAt = i; widthBeforeLand = w; }
      prevSlams = h.num('slams');
    }
    h.dispose();
    return { landAt, widthBeforeLand };
  }

  const wiggling = runBranch('wiggle');
  const still = runBranch('still');
  assert(wiggling.landAt === refLand && still.landAt === refLand,
    `both runs should catch on the same frame the reference run did (ref ${refLand}, wiggling ${wiggling.landAt}, still ${still.landAt}) — the diverging input leaked into the chase itself`);
  assert(wiggling.widthBeforeLand > still.widthBeforeLand,
    `wiggling through the raise should end with strictly more giggle than holding the stick still: wiggling ${wiggling.widthBeforeLand}%, still ${still.widthBeforeLand}%`);
  note(`seed ${seed}: caught at frame ${refLand}, wiggling ${wiggling.widthBeforeLand}% giggle vs still ${still.widthBeforeLand}% going into the land`);
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

/* ---------------------------------------------------------------- *
 * a television's d-pad, which sends a keyCode and no usable key
 *
 * THIS IS WHAT WAS ACTUALLY BROKEN. An Xbox pad on a Fire TV Cube, through
 * the browser app: the d-pad did nothing in any game. Its browser reports
 * `e.key` for a d-pad press as 'Unidentified' and puts the direction in the
 * deprecated `keyCode` — Amazon's own guidance for the platform says to read
 * keyCode, because `key` cannot be relied on. The kit looked only at `key`,
 * so every arrow missed its lookup and fell through as an anonymous
 * keypress: it jumped, and it never steered.
 * ---------------------------------------------------------------- */
for (const [dir, want] of [['right', SPOTS.dogbed], ['left', SPOTS.plant]]) {
  test(`kit: a telly's d-pad (keyCode, no key) steers ${dir}`, note => {
    const { h, seen } = holdRun(g => g.tvDown(dir), 900);
    note(`keyCode-only ${dir} → ${[...seen].join(' / ')}`);
    assert(seen.has(want),
      `a d-pad reporting only keyCode should have reached ${want}, only saw ${[...seen].join(', ')}`);
    return h;
  });
}

test("kit: a telly's d-pad lets go when it is released", note => {
  /* keydown and keyup have to file the same physical button under the same
     name. Keyed by `key` they would not: both arrive as 'Unidentified', so
     one direction could clear another and a child would be left walking
     into a wall with nothing held down. */
  const h = createHarness('daddy-smash', { seed: 11 });
  h.tap();
  pump(h, 5);
  h.tvDown('right');
  pump(h, 400);
  const ranRight = h.text('whereTag');
  h.tvUp('right');
  h.tvDown('left');
  pump(h, 600);
  const ranLeft = h.text('whereTag');
  note(`right → ${ranRight}, then released and went left → ${ranLeft}`);
  assert(ranRight !== ranLeft, 'letting go of right and pressing left changed nothing');
  return h;
});

/* Android's own d-pad codes, which some tellies pass through raw instead of
   translating to the browser arrows. On a desktop 19/20/21/22 are Pause,
   CapsLock and two IME keys, and every one of those reports a real `key`
   that IGNORE_KEYS catches first — so reading them costs nothing. */
test("kit: a telly that sends Android's own d-pad codes still steers", note => {
  const h = createHarness('daddy-smash', { seed: 11 });
  h.tap();
  pump(h, 5);
  h.keyDown('Unidentified', 22);        // Android KEYCODE_DPAD_RIGHT
  const seen = new Set();
  for (let i = 0; i < 900; i++) { pump(h, 1); seen.add(h.text('whereTag')); }
  note(`keyCode 22 → ${[...seen].join(' / ')}`);
  assert(seen.has(SPOTS.dogbed),
    `Android's d-pad-right code should have reached the dog bed, only saw ${[...seen].join(', ')}`);
  return h;
});

test('kit: CapsLock is still not a direction', note => {
  // keyCode 20 is Android's d-pad down AND a desktop CapsLock. The one that
  // says which is `key`, and IGNORE_KEYS reads it before anything else.
  const idle = holdRun(() => {}, 700);
  const caps = holdRun(g => g.keyDown('CapsLock', 20), 700);
  note(`nothing: ${[...idle.seen].join(' / ')} | CapsLock: ${[...caps.seen].join(' / ')}`);
  assert(caps.seen.size <= idle.seen.size + 1,
    `CapsLock steered the player about: ${[...caps.seen].join(', ')}`);
  idle.h.dispose();
  return caps.h;
});

test('kit: a direction that only ever auto-repeats is still held', note => {
  /* Some televisions send one keydown and then nothing but repeats. The
     repeat guard used to sit at the very top of the handler, so those were
     dropped on the floor while the child was still pressing the button. */
  const h = createHarness('oliver-run', { seed: 5, gamepad: false });
  const pads = global.KidKit.input.create({
    element: h.document.getElementById('stage'), steer: true,
  });
  let presses = 0;
  const pads2 = global.KidKit.input.create({
    element: h.document.getElementById('stage'), steer: true, onPress: () => presses++,
  });
  const repeat = () => global.dispatchEvent({
    type: 'keydown', key: 'Unidentified', keyCode: 39, repeat: true,
    preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {},
  });
  repeat(); repeat(); repeat();
  note(`axis after three repeat-only events: x=${pads.axis().x}, presses fired: ${presses}`);
  assert(pads.axis().x > 0.5, 'a repeat-only direction should still steer');
  assert(presses === 0, `repeats must not machine-gun the jump button, got ${presses}`);
  void pads2;
  return h;
});

test("kit: a telly's d-pad is swallowed, not handed back to the browser", note => {
  /* Left and right used to bail out of the handler before preventDefault,
     which on a television hands them straight back to scroll the page or
     shove its own cursor about. */
  const h = createHarness('oliver-run', { seed: 5 });
  global.KidKit.input.create({
    element: h.document.getElementById('stage'), steer: true,
  });
  const seen = [];
  for (const dir of ['left', 'right', 'up', 'down']) {
    const ev = {
      type: 'keydown', key: 'Unidentified', repeat: false,
      keyCode: { left: 37, up: 38, right: 39, down: 40 }[dir],
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() {}, stopImmediatePropagation() {},
    };
    global.dispatchEvent(ev);
    seen.push(dir + ':' + (ev.defaultPrevented ? 'swallowed' : 'LET THROUGH'));
  }
  note(seen.join('  '));
  assert(seen.every(s => /swallowed/.test(s)),
    `a steering key was handed back to the browser: ${seen.join(', ')}`);
});

/* ---------------------------------------------------------------- *
 * the d-pad, on pads that are not on the standard mapping
 *
 * Reported from a real controller: the d-pad did nothing in any game, and
 * the only way to move was to hold A and shove the telly's mouse cursor
 * about with the stick. The cause is that buttons 12-15 are the d-pad only
 * when gamepad.mapping === 'standard'; a great many pads report mapping:''
 * and hand the d-pad over as a hat axis instead, which the kit was not
 * reading at all.
 * ---------------------------------------------------------------- */
const HAT_STEER = [
  ['right', SPOTS.dogbed],
  ['left', SPOTS.plant],
];

for (const [dir, want] of HAT_STEER) {
  test(`kit: a d-pad reported as a hat axis steers ${dir}`, note => {
    const { h, seen } = holdRun(g => g.hat(dir), 900);
    note(`hat ${dir} → ${[...seen].join(' / ')}`);
    assert(seen.has(want),
      `a hat-axis d-pad held ${dir} should have reached ${want}, only saw ${[...seen].join(', ')}`);
    return h;
  });
}

test('kit: a centred hat is not a direction, and neither is an idle axis', note => {
  /* The careful half. A hat parks OUTSIDE -1..1 when centred, but plenty of
     axes simply sit at zero, and some pads rest a trigger at -1 for ever —
     and -1 is a perfectly good hat value meaning "up". Read any of those as
     a direction and the player walks into a wall for the whole game with
     nobody touching anything. */
  const still = holdRun(g => g.hat(null), 700);
  const zero = holdRun(g => g.setAxis(9, 0), 700);
  const trig = holdRun(g => { g.setAxis(6, -1); g.setAxis(7, -1); }, 700);
  const idle = holdRun(() => {}, 700);
  const where = r => [...r.seen].join(' / ');
  note(`centred: ${where(still)} | zero: ${where(zero)} | resting triggers: ${where(trig)} | nothing: ${where(idle)}`);
  for (const [label, r] of [['a centred hat', still], ['an axis at zero', zero], ['resting triggers', trig]]) {
    assert(r.seen.size <= idle.seen.size + 1,
      `${label} moved the player about (${where(r)}) when nothing was pressed (${where(idle)})`);
    r.h.dispose();
  }
  still.h.dispose(); zero.h.dispose(); trig.h.dispose();
  return idle.h;
});

test('kit: a hat direction jumps as well as steers', note => {
  // d-pad up is a jump everywhere else, so a hat has to do it too
  const h = createHarness('oliver-run', { seed: 5 });
  let presses = 0;
  const pads = global.KidKit.input.create({
    element: h.document.getElementById('stage'),
    steer: true,
    onPress: () => presses++,
  });
  h.frames(1); pads.poll();
  assert(presses === 0, 'precondition: nothing pressed yet');
  h.hat('up');
  pads.poll();
  assert(presses === 1, `a hat pushed up should press once, got ${presses}`);
  pads.poll(); pads.poll();
  assert(presses === 1, `holding it is still one press, got ${presses}`);
  assert(pads.axis().y < -0.5, `a hat pushed up should steer up, got ${pads.axis().y}`);
  h.hat(null);
  pads.poll();
  h.hat('up');
  pads.poll();
  note(`${presses} presses from press, hold, release, press`);
  assert(presses === 2, `a fresh push should press again, got ${presses}`);
  return h;
});

/* A mouse cursor being pushed around is steering, for somebody who has
   nothing else. But it is the LAST resort and never the control scheme:
   these three say when it counts and, more importantly, when it must not.
   Tested against the kit directly rather than through a game, because in a
   game the player is also being chased, carried and bumped about, and none
   of that would tell you anything about the cursor. */
/* When a cursor is the only input there is — a Fire TV swallows the d-pad
   and gives the stick to its own cursor — it stops being a fallback and
   becomes the control scheme, and then it must NOT lapse. A short lapse
   meant the character stopped dead whenever the child held still, which is
   not a control scheme but a fault. It works like the finger these games
   were built around: put it where you want to go. */
test('kit: a cursor that is the only input keeps steering', note => {
  const h = createHarness('oliver-run', { seed: 5, gamepad: false });
  const pads = global.KidKit.input.create({
    element: h.document.getElementById('stage'), steer: true,
  });
  assert(pads.pointer().active === false, 'nothing should be steering yet');
  h.hover(0.9, 0.5);
  assert(pads.pointer().active === true, 'a moving cursor should steer');
  h.frames(600);                       // ten seconds of holding perfectly still
  note('still steering ten seconds after the cursor last moved');
  assert(pads.pointer().active === true,
    'a cursor with nothing to defer to must keep steering, or the player stops dead');
  return h;
});

/* …but the moment something better has been seen, it goes back to being a
   fallback that gets out of the way. */
test('kit: once a real direction exists, a parked cursor lapses again', note => {
  const h = createHarness('oliver-run', { seed: 5, gamepad: false });
  const pads = global.KidKit.input.create({
    element: h.document.getElementById('stage'), steer: true,
  });
  h.keyDown('ArrowRight');             // a real direction exists on this box
  h.keyUp('ArrowRight');
  h.frames(200);                       // let the three-second hold-off pass
  h.hover(0.9, 0.5);
  assert(pads.pointer().active === true, 'the cursor should still work as a fallback');
  h.frames(200);
  note('lapsed once parked, now that arrows are known to work here');
  assert(pads.pointer().active === false,
    'with a keyboard in the room a parked cursor should stop steering');
  return h;
});

/* REGRESSION GUARD, and the sharpest lesson in this whole file: judge a
   controller by what it SENDS, never by whether it is there.
 *
 * "Switch the cursor off while a pad is connected" sounds obviously right
 * and broke the one device it was written for. A browser hides gamepads
 * until the first button is pressed, so on a Fire TV — where the pad cannot
 * steer at all, the d-pad being swallowed and the stick going to the
 * browser's own cursor — the cursor worked beautifully right up until the
 * child pressed A to jump. At that moment the pad appeared, the cursor
 * switched off for good, and the only way to move was to hold A down. It
 * deferred to a controller that could not steer. */
test('kit: a controller that cannot steer does not switch the cursor off', note => {
  const h = createHarness('oliver-run', { seed: 5 });   // harness has a pad
  const pads = global.KidKit.input.create({
    element: h.document.getElementById('stage'), steer: true,
  });
  pads.poll();                        // the pad is present and quiet
  h.hover(0.9, 0.5);
  assert(pads.pointer().active === true,
    'a connected pad that sends no direction must not disable cursor steering');

  h.stick(1, 0);                      // now it really is steering
  pads.poll();
  assert(pads.pointer().active === false,
    'a stick actually being pushed should take over from the cursor');

  h.stick(0, 0);
  pads.poll();
  h.frames(200);                      // let the three-second hold-off lapse
  h.hover(0.9, 0.5);
  note('cursor on with a quiet pad, off while the stick is pushed, back on afterwards');
  assert(pads.pointer().active === true, 'the cursor should come back once the stick is let go');
  return h;
});

test('kit: a cursor is ignored for a while after a real direction', note => {
  const h = createHarness('oliver-run', { seed: 5, gamepad: false });
  const pads = global.KidKit.input.create({
    element: h.document.getElementById('stage'), steer: true,
  });
  h.keyDown('ArrowRight');
  h.keyUp('ArrowRight');
  h.hover(0.9, 0.5);
  assert(pads.pointer().active === false,
    'the cursor should stay out of the way just after a d-pad or arrow was used');
  h.frames(200);                       // let the three-second hold-off lapse
  h.hover(0.9, 0.5);
  note('cursor held off right after an arrow, allowed again once it went quiet');
  assert(pads.pointer().active === true, 'the cursor should come back once nothing else is steering');
  return h;
});

test('kit: a moving cursor flies the rocket with no button held down', note => {
  // Star Wings joins wings when you reach the wingman, which is the one
  // thing the DOM exposes about where the rocket actually is.
  const h = createHarness('star-wings', { seed: 4, gamepad: false });
  h.click('startBtn');
  pump(h, 5);
  let at = -1;
  for (let i = 0; i < 700; i++) {
    h.hover(0.14, 0.5);               // the cursor keeps moving towards the wingman
    pump(h, 1);
    if (at < 0 && !h.hidden('wingTag')) at = i;
  }
  note(`joined wings at frame ${at < 0 ? 'never' : at} on a moving cursor alone`);
  assert(at >= 0, 'a moving cursor never flew the rocket anywhere');
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

/* Boss Rush has no `run` phase at all, so for a long time it had no sky lane
   either. It does now — the pads spawn in the arena instead — and this stays
   as the guard that the mode still runs clean end to end. */
test('sky lane: Boss Rush runs clean with pads in the arena', note => {
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

/* Gold stars only ever sit on platforms, so counting the +50 pops is a direct
   reading of how much sky lane a run actually reached. It used to compare
   total scores, which worked until the ground filled up with critters and
   made the score far too noisy to see 50 points through. */
test('sky lane: gold stars are unreachable without leaving the ground', note => {
  const grounded = createHarness('oliver-run', { seed: 43 });
  grounded.tap();
  pump(grounded, 9000);            // never jumps, so never touches a platform
  const flat = poppedRoughly(grounded, /^\+50$/);
  grounded.dispose();

  const climber = createHarness('oliver-run', { seed: 43 });
  climber.tap();
  runCycles(climber, 9000, 24, 40);
  const climbed = poppedRoughly(climber, /^\+50$/);
  note(`grounded reached ${flat} gold stars, climbing reached ${climbed}`);
  assert(flat === 0, `a run that never jumps reached ${flat} gold stars`);
  assert(climbed > 0, 'climbing for 9000 frames reached no gold star at all');
  return climber;
});

/* The one test that isolates the glide itself. Every run presses the jump
   button on exactly the same frames — the ONLY difference is how long the
   button stays down afterwards. holdFor:1 releases immediately (a plain
   jump); holding keeps floating. Any difference is the glide and nothing
   else.

   Measured while building it: the glide raised time spent standing on a
   platform from 167 frames to 1178 over the same run, a 7x difference.
   Almost none of that reaches the score, and since worlds got longer the
   sky lane offers so many stars that a plain jumper collects nearly all of
   them anyway — so the margin here is a couple of stars, not a landslide.
   It is summed over three seeds to keep it off a knife edge, and jumps are
   deliberately sparse (once every 110 frames), because hang time only
   matters when you are not simply jumping again straight away. */
test('glide measurably improves sky lane collection', note => {
  const run = (holdFor, seed) => {
    const h = createHarness('oliver-run', { seed });
    // fire ring in both runs: several powers change how the hero falls, and
    // this is the one that touches neither gravity nor reach
    h.bucket(1, POWER_NAMES.length);
    h.tap();
    runCycles(h, 9000, holdFor, 110);
    const gold = poppedRoughly(h, /^\+50$/);
    h.dispose();
    return gold;
  };
  let tapOnly = 0, floating = 0;
  const rows = [];
  for (const seed of [44, 21, 7]) {
    const a = run(1, seed), b = run(70, seed);
    tapOnly += a; floating += b;
    rows.push(`${seed}: ${a} vs ${b}`);
  }
  note(`gold stars per seed (tap-only vs floating) — ${rows.join(', ')}`);
  note(`totals: tap-only ${tapOnly}, floating ${floating}`);
  assert(floating > tapOnly,
    `holding should collect more gold stars: ${tapOnly} -> ${floating}`);
});

/* ---------------------------------------------------------------- *
 * the high road in the arena, and the fourteen worlds
 * ---------------------------------------------------------------- */

/* The cleanest proof available that the sky lane really is open during a boss
   fight: a +50 pop is a gold star, gold stars only ever sit on platforms, and
   Boss Rush is nothing but fights. A grounded player cannot reach one — that
   half is the same claim the run-phase test makes, re-checked in the arena. */
test('sky lane: gold stars are collectable during a boss fight', note => {
  const grounded = createHarness('oliver-run', { seed: 41 });
  grounded.click('rushBtn');
  pump(grounded, 6000);                        // never jumps
  const flatGold = poppedRoughly(grounded, /^\+50$/);
  const flat = grounded.num('score');
  grounded.dispose();

  const climber = createHarness('oliver-run', { seed: 41 });
  climber.click('rushBtn');
  pump(climber, 5);
  runCycles(climber, 6000, 24, 40);
  const gold = poppedRoughly(climber, /^\+50$/);

  note(`grounded ${flat} with ${flatGold} gold stars, climbing ${climber.num('score')} with ${gold}`);
  assert(flatGold === 0, `a grounded rush run reached ${flatGold} gold stars — the arena pads are too low`);
  assert(gold > 0, 'climbing through a boss fight never reached a gold star');
  return climber;
});

/* SKY SMASH is the reward for using the arena pads as pads: climb one, wait,
   drop on the boss as it charges under you. A robot that jumps every 40 frames
   is not aiming for it, so it lands a handful of times across a sweep rather
   than reliably in one run — the assertion is on the sweep. */
test('sky lane: dropping onto a boss from above pays a bonus', note => {
  let total = 0;
  const seen = [];
  for (const seed of [7, 41, 44]) {
    const h = createHarness('oliver-run', { seed });
    h.click('rushBtn');
    pump(h, 5);
    runCycles(h, 5000, 24, 40);
    const n = poppedRoughly(h, /SKY SMASH/);
    seen.push(`${seed}:${n}`);
    total += n;
    h.dispose();
  }
  note(`sky smashes per seed — ${seen.join(', ')}`);
  assert(total > 0, 'no seed ever landed a drop on a boss from the arena pads');
});

/* Reading the running order off the level label would be circular: the label
   only changes when the name changes, so a world following itself would look
   like no change at all and the repeat would be invisible. The banner is the
   honest signal — it is painted afresh on arrival whatever it says — so this
   watches for the frame a world banner appears and records that. */
const BANNERS = new Set(LEVEL_NAMES.map(n => n.toUpperCase()));

function worldOrder(h, frames) {
  const order = [h.text('lvlName').toUpperCase()];   // world one arrives without a banner
  let showing = false;
  for (let i = 0; i < frames; i++) {
    h.clearPainted();
    pump(h, 1);
    const banner = h.painted().find(s => BANNERS.has(s));
    if (banner && !showing) order.push(banner);
    showing = !!banner;
  }
  return order;
}

/* A shuffle bag, not a dice roll: one long run has to reach every world before
   it sees any of them twice, and the seam where the bag refills must not hand
   back the world that just finished. */
test('levels: one run visits all fourteen worlds before repeating any', note => {
  const h = createHarness('oliver-run', { seed: 1 });
  h.tap();
  h.holdJump(true);
  const order = worldOrder(h, 64000);   // ~4000 frames a world now, not ~2900
  const seen = new Set();
  for (let i = 0; i < order.length; i++) {
    const name = LEVEL_NAMES.find(n => n.toUpperCase() === order[i]);
    assert(name, `unknown world "${order[i]}"`);
    assert(i === 0 || order[i] !== order[i - 1],
      `world repeated back to back: ${order.join(' -> ')}`);
    if (seen.size < LEVEL_NAMES.length)
      assert(!seen.has(name),
        `"${name}" came round again after only ${seen.size} of ${LEVEL_NAMES.length}: ${order.join(' -> ')}`);
    seen.add(name);
  }
  note(`${order.length} worlds in order: ${order.join(' -> ')}`);
  assert(seen.size === LEVEL_NAMES.length,
    `never visited: ${LEVEL_NAMES.filter(n => !seen.has(n)).join(', ')}`);
  return h;
});

/* The opening world is drawn from the same shuffle, so it is on the menu
   before a frame is pumped — which makes this the cheapest possible check
   that the order really is re-rolled per run. */
test('levels: the run opens on a different world each time', note => {
  const openers = [];
  for (const seed of [1, 2, 3, 5, 7, 11, 13, 42]) {
    const h = createHarness('oliver-run', { seed });
    const name = h.text('lvlName');
    assert(LEVEL_NAMES.includes(name), `menu named an unknown world "${name}"`);
    openers.push(name);
    h.dispose();
  }
  note(`opening worlds: ${openers.join(', ')}`);
  assert(new Set(openers).size > 1, 'every run opened on the same world — the order is not shuffled');
});

/* ---------------------------------------------------------------- *
 * boss fights: rage, tricks and rewards
 * ---------------------------------------------------------------- */

/* Everything in a fight beyond the health bar is painted, never written to
   the DOM, so these read the screen. The painted window is a rolling one —
   clearPainted() first and keep the run short enough that a rare event is
   still in it. */
test('boss: it loses its temper at half health', note => {
  const h = createHarness('oliver-run', { seed: 12 });
  h.tap();
  h.holdJump(true);
  h.until(() => h.paintedSome(/IT IS FURIOUS/), 30000, 'a boss to be driven to rage');
  note(`raged after ${h.frameCount} frames`);
  return h;
});

/* A boss no longer just waits between charges: it throws junk, calls in the
   world's own critters, or slams the floor. The junk is the observable half —
   it is a crate you get to smash, and smashing one pays 18. */
test('boss: its junk is a target, not a threat', note => {
  const h = createHarness('oliver-run', { seed: 3 });
  h.tap();                                   // stays on the ground, in the way
  h.until(() => h.paintedSome(/^SMASH! \+(18|30)$/), 30000, 'boss junk to be smashed');
  note(`first junk smashed at frame ${h.frameCount}`);
  // and it paid, rather than costing anything
  assert(h.num('score') > 0, 'smashing boss junk should score');
  return h;
});

/* The reward for staying up among the arena pads. */
test('boss: hits without landing pay a rising bonus', note => {
  const h = createHarness('oliver-run', { seed: 1 });
  h.tap();
  h.holdJump(true);
  h.until(() => h.paintedSome(/IN A ROW! \+/), 40000, 'an air combo');
  assert(h.paintedSome(/AIR COMBO/), 'an air combo should be announced too');
  note(`air combo landed by frame ${h.frameCount}`);
  return h;
});

/* Something to carry out of every fight. */
test('boss: beating one drops a power-up', note => {
  const h = createHarness('oliver-run', { seed: 12 });
  h.tap();
  h.holdJump(true);
  h.until(() => trophyCount(h) >= 1, 30000, 'a boss to go down');
  // the orb pops out at the wreck and drifts back to the kids
  const got = h.until(() => !h.hidden('powerTag'), 1200, 'the dropped orb to be collected');
  note(`picked up "${h.text('powerName')}" ${got} frames after the boss fell`);
  return h;
});

/* Freeze and magnet were the two the boy found least exciting, so they get
   one re-roll each and everything else gets the freed slots. This asserts the
   shape of the change, not an exact ratio — it is a weighting, not a quota. */
test('power-ups: the quieter powers come up less often', note => {
  const seen = {};
  for (const seed of [2, 4, 6, 8, 11, 13]) {
    const h = createHarness('oliver-run', { seed });
    h.tap();
    h.holdJump(true);
    let last = '';
    for (let i = 0; i < 10000; i++) {
      pump(h, 1);
      const now = h.hidden('powerTag') ? '' : h.text('powerName');
      if (now && now !== last) seen[now] = (seen[now] || 0) + 1;
      last = now;
    }
    h.dispose();
  }
  const total = Object.values(seen).reduce((a, b) => a + b, 0);
  const quiet = (seen['FREEZE RAY'] || 0) + (seen['STAR MAGNET'] || 0);
  const evenShare = total * 2 / POWER_NAMES.length;
  note(`${total} pickups: ${JSON.stringify(seen)}`);
  note(`freeze+magnet ${quiet}, an even share of two in ten would be ${evenShare.toFixed(1)}`);
  assert(total >= 18, `not enough pickups to judge: ${total}`);
  assert(quiet < evenShare, `freeze and magnet are not rarer than even: ${quiet} vs ${evenShare.toFixed(1)}`);
});

/* A world is longer than it was, which is only visible as bosses arriving
   less often for the same distance run. */
test('levels: a world runs longer before the boss shows up', note => {
  const h = createHarness('oliver-run', { seed: 43 });
  h.tap();
  const firstWarn = h.until(() => h.paintedSome(/BOSS TIME/), 6000, 'the first boss call');
  note(`first boss called at frame ${firstWarn} (RUN_FRAMES is 2600)`);
  assertBetween(firstWarn, 2300, 3200, 'the first boss arrived at the wrong time');
  return h;
});

/* ---------------------------------------------------------------- *
 * daddy smash: five finishers and four interruptions
 * ---------------------------------------------------------------- */

const FINISHERS = ['got smashed', 'flew round', 'cannonballed', 'got the whole dogpile', 'got rolled up'];

/* The game is named after the smash, and there used to be exactly one of
   them — same carry, same cushion, same shout, every catch. */
test('daddy: every finisher turns up, and each lands somewhere of its own', note => {
  const h = createHarness('daddy-smash', { seed: 11 });
  h.click('startBtn');
  const shouts = new Set();
  for (let i = 0; i < 30000; i++) {
    pump(h, 1);
    const line = h.text('catchLine');
    if (line) shouts.add(line);
  }
  const seen = FINISHERS.filter(f => [...shouts].some(l => l.toLowerCase().includes(f)));
  note(`${h.num('slams')} smashes, finishers seen: ${seen.join(', ')}`);
  assert(seen.length === FINISHERS.length,
    `only ${seen.length} of ${FINISHERS.length} finishers appeared: ${seen.join(', ')}`);
  return h;
});

test('daddy: the room does things while you play', note => {
  const h = createHarness('daddy-smash', { seed: 11 });
  h.click('startBtn');
  const shouts = new Set();
  for (let i = 0; i < 30000; i++) {
    pump(h, 1);
    const line = h.text('catchLine');
    if (line) shouts.add(line);
  }
  const wanted = ['dog wants to play', 'Balloons', 'COME AND GET ME', 'Lights out'];
  const seen = wanted.filter(w => [...shouts].some(l => l.toLowerCase().includes(w.toLowerCase())));
  note(`seen: ${seen.join(', ')}`);
  assert(seen.length >= 3, `only ${seen.length} of ${wanted.length} events happened: ${seen.join(', ')}`);
  return h;
});

/* REGRESSION GUARD, and the rule this game cannot bend: being caught IS the
   reward, so anything that makes a catch rarer is a bug. Every event added
   here is a gift — the dog only licks, balloons only pop, "come and get me"
   is an instant catch, and Daddy is quietly quicker in the dark to pay for
   not being able to see. This asserts the rate did not fall. */
test('daddy: nothing added to the room makes catches rarer', note => {
  const rates = [];
  for (const seed of [11, 5, 33]) {
    const h = createHarness('daddy-smash', { seed });
    h.click('startBtn');
    pump(h, 12000);            // stand still: the surest way to be caught
    rates.push(h.num('slams'));
    h.dispose();
  }
  const total = rates.reduce((a, b) => a + b, 0);
  note(`smashes per 12000 frames across three seeds: ${rates.join(', ')} (${total} total)`);
  // measured at 11-18 per 12000 frames before any of this landed
  for (const r of rates) assert(r >= 10, `only ${r} smashes in 12000 frames — catches got rarer`);
});

/* The dog is charming and must stay harmless: he licks, and a lick is not a
   catch. If he could take a kid out of the chase he would be stealing the
   payoff rather than adding to it. */
test('daddy: the dog only ever licks, never catches', note => {
  const h = createHarness('daddy-smash', { seed: 11 });
  h.click('startBtn');
  // count the frame a SLURP first appears, not every frame it is on screen:
  // the pop lives ~52 frames, so counting frames overstates it fifty-fold
  let licks = 0, showing = false;
  for (let i = 0; i < 30000; i++) {
    h.clearPainted();
    pump(h, 1);
    const up = h.paintedSome(/SLURP!/);
    if (up && !showing) licks++;
    showing = up;
  }
  note(`${licks} licks and ${h.num('slams')} smashes over 30000 frames`);
  assert(licks > 0, 'the dog never licked anybody');
  return h;
});

/* ================================================================ *
 * games/tower-climb
 *
 * This one is steered AND tapped, so its tests are a blend of the other
 * two shapes: hold a direction for hundreds of frames like Daddy Smash,
 * and tap like Oliver Run. The score in `#floors` is the readout for
 * everything — it is how high the climber has got, so "did that help?"
 * is always answerable through the DOM.
 *
 * The promise this game makes, and what most of these tests are really
 * guarding, is that NOBODY EVER GETS STUCK. Ladders are escalators, springs
 * fire on contact, the bell only needs touching, and if none of that has
 * happened for seven seconds the balloons come and fetch you. A child who
 * can only push one direction has to be able to climb for ever, and so does
 * one who does nothing at all.
 * ================================================================ */

/* Lap the tower: hold one way, turn round every `turn` frames, tap every
   `tap` frames. A busy player, not a clever one — it cannot see where the
   ladders are, so use it to keep the machinery hot and to compare one run
   against another, never as a measure of how well a person would do. */
function climbRun(seed, frames, opts) {
  const o = opts || {};
  const h = createHarness('tower-climb', { seed });
  if (o.pick) h.click(o.pick);
  h.click('startBtn');
  pump(h, 5);
  const turn = o.turn == null ? 170 : o.turn;
  const seen = { zones: new Set(), shouts: new Set(), powers: new Set() };
  let dir = 1;
  for (let i = 0; i < frames; i++) {
    if (turn && i % turn === 0) {
      h.keyUp(dir > 0 ? 'ArrowRight' : 'ArrowLeft');
      dir = -dir;
      h.keyDown(dir > 0 ? 'ArrowRight' : 'ArrowLeft');
    }
    if (o.tap && i % o.tap === 0) h.key('z');
    pump(h, 1);
    if (o.watch) {
      seen.zones.add(h.text('zoneTag'));
      if (h.hasClass('shout', 'show')) seen.shouts.add(h.el('shout').innerHTML);
      const pw = h.text('powerTag');
      if (pw && !h.hidden('powerTag')) seen.powers.add(pw);
    }
  }
  seen.floors = h.num('floors');
  seen.h = h;
  return seen;
}

test('climb: boots to the menu at the bottom of the tower', note => {
  const h = createHarness('tower-climb');
  note(`loaded ${h.loaded.join(', ')}`);
  assert(!h.hidden('startScreen'), 'start screen should be visible before play');
  assert(h.num('floors') === 0, 'should start on floor zero');
  assert(h.text('best') === '', `fresh install should show no best, got "${h.text('best')}"`);
  assert(h.text('kidTag') === 'Oliver', `expected to default to Oliver, got "${h.text('kidTag')}"`);
  assert(h.hidden('powerTag'), 'no power on the menu');
  assert(h.text('zoneTag').includes('Garden'), `should start in the Garden, got "${h.text('zoneTag')}"`);
  pump(h, 120);
  assert(h.num('floors') === 0, 'nothing should climb while still on the menu');
  return h;
});

for (const [label, start] of Object.entries(STARTERS)) {
  test(`climb: starts from ${label}`, note => {
    const h = createHarness('tower-climb', { seed: 42 });
    assert(!h.hidden('startScreen'), 'precondition: menu visible');
    start(h);
    pump(h, 5);
    assert(h.hidden('startScreen'), `${label} did not start the climb`);
    h.keyDown('ArrowRight');
    pump(h, 1500);
    assert(h.num('floors') > 0, `${label} started but the climb went nowhere`);
    note(`floor ${h.num('floors')} after 1500 frames`);
    return h;
  });
}

/* Every way in to the same movement. All five are things that will actually
   happen in this house, and the sixth is a telly's cursor parked in the dead
   space beside the game, which is where it spends most of its life. */
const CLIMB_STEERERS = [
  ['held arrow keys', h => h.keyDown('ArrowRight')],
  ['WASD', h => h.keyDown('d')],
  ['the analogue stick', h => h.stick(1, 0)],
  ['the d-pad', h => h.padHold('right', true)],
  ['a finger held on the glass', h => h.pointerHold(0.95, 0.85)],
  ['a finger beside the game', h => h.pageHold(1.6, 0.85)],
];

for (const [label, go] of CLIMB_STEERERS) {
  test(`climb: steering with ${label}`, note => {
    const h = createHarness('tower-climb', { seed: 12 });
    h.click('startBtn');
    pump(h, 5);
    go(h);
    pump(h, 4000);
    assert(h.num('floors') >= 4,
      `${label} only got to floor ${h.num('floors')} in 4000 frames`);
    note(`floor ${h.num('floors')}, ${h.text('zoneTag')}`);
    return h;
  });
}

/* A finger held LOW must still climb. The pointer's height is deliberately
   ignored, because a thumb resting at the bottom of a phone is the ordinary
   way a child holds one — and while that height was being read as "down",
   the commonest grip in the house rode every ladder straight back down. */
test('climb: a finger held low still goes up, not down', note => {
  const low = createHarness('tower-climb', { seed: 12 });
  low.click('startBtn'); pump(low, 5);
  low.pointerHold(0.95, 0.95);
  pump(low, 4000);
  const lowFloors = low.num('floors');
  low.dispose();

  const high = createHarness('tower-climb', { seed: 12 });
  high.click('startBtn'); pump(high, 5);
  high.pointerHold(0.95, 0.1);
  pump(high, 4000);
  note(`finger low → floor ${lowFloors}, finger high → floor ${high.num('floors')}`);
  assert(lowFloors >= 4, `a low-held finger only reached floor ${lowFloors} — it is reading as "down"`);
  return high;
});

/* THE PROMISE. A child who cannot yet time a jump still has to get up every
   floor in the tower, for ever. Ladders are ridden by walking into them,
   springs fire on contact and the bell only needs touching, so the button is
   never once required. */
test('climb: a climber who never jumps still gets up the tower', note => {
  const runs = [];
  for (const seed of [11, 3, 64]) {
    const r = climbRun(seed, 6000, { tap: 0 });
    runs.push(r.floors);
    r.h.dispose();
  }
  note(`floors with the button never pressed: ${runs.join(', ')}`);
  for (const f of runs) assert(f >= 8, `only reached floor ${f} without ever jumping`);
});

/* …and one who cannot even do that. Leaning on a single direction wedges you
   into a corner with no ladder in it, which is why the rescue keys off "has
   this climber gained any height lately" and not "are they pressing
   anything" — the second question misses this case completely. */
test('climb: nobody ever gets stuck, even holding one direction for ever', note => {
  const runs = [];
  for (const seed of [7, 21, 5, 99, 42]) {
    const h = createHarness('tower-climb', { seed });
    h.click('startBtn');
    pump(h, 5);
    h.keyDown('ArrowRight');
    pump(h, 6000);
    runs.push(h.num('floors'));
    h.dispose();
  }
  note(`floors holding right and nothing else: ${runs.join(', ')}`);
  for (const f of runs) assert(f >= 6, `wedged on floor ${f} holding one direction`);
});

/* And one who never touches anything at all. The tower has to keep going by
   itself, and above all it must never end. */
test('climb: 20000 idle frames never throw and never end the climb', note => {
  const h = createHarness('tower-climb', { seed: 4 });
  h.click('startBtn');
  pump(h, 20000);
  assert(h.hidden('startScreen'), 'the climb ended on its own — there is no game over here');
  assert(h.num('floors') > 0, 'a climber who does nothing should still be fetched upwards');
  assert(h.timerCount < 60, `timer leak: ${h.timerCount} still pending`);
  note(`floor ${h.num('floors')} without a single input, ${h.text('zoneTag')}`);
  return h;
});

test('climb: 20000 frames of hard climbing never throw either', note => {
  const r = climbRun(8, 20000, { tap: 3, turn: 150 });
  note(`floor ${r.floors}, ${r.h.text('zoneTag')}`);
  assert(r.floors > 20, `only floor ${r.floors} after 20000 busy frames`);
  return r.h;
});

/* THE GUARD, and the one this game is most likely to break by accident.
   Tapping harder must never be a penalty. It was one twice while this was
   being written: a tap on a ladder let GO of it, so a child who mashed spent
   the whole game bouncing off the foot of every ladder in the tower; and the
   rocket pack added to its own thrust, so holding the button flew forty-two
   thousand floors in eighty seconds. Both were invisible at one convenient
   tapping speed, so this sweeps the whole range like the fishing one. */
test('climb: mashing is never worse than not tapping, at every speed', note => {
  const CADENCES = [0, 1, 2, 3, 5, 8, 13, 21, 34];
  const SEEDS = [11, 7, 3, 52];
  const totals = {};
  for (const tap of CADENCES) {
    let sum = 0;
    for (const seed of SEEDS) {
      const r = climbRun(seed, 4000, { tap, turn: 210 });
      sum += r.floors;
      r.h.dispose();
    }
    totals[tap] = sum;
  }
  const never = totals[0];
  note(CADENCES.map(c => (c ? 'every ' + c : 'never') + ': ' + totals[c]).join('  '));
  for (const tap of CADENCES) {
    if (!tap) continue;
    assert(totals[tap] >= never,
      `tapping every ${tap} frames climbed ${totals[tap]} floors against ${never} for never tapping — mashing is being punished`);
  }
});

/* The top of a section is the whole point of the game: the bell is the only
   way off that floor, and ringing it flies the climber up into the next
   zone. Reaching several of them proves the sections chain. */
test('climb: the bell at the top flies you up to the next tower', note => {
  const r = climbRun(11, 12000, { tap: 14, watch: true });
  const tops = [...r.shouts].filter(s => /TOP OF THE TOWER/.test(s));
  note(`${tops.length} bells rung, floor ${r.floors}`);
  assert(tops.length >= 3, `only ${tops.length} bells in 12000 frames — the sections are not chaining`);
  assert(/Treetops/.test(tops.join(' ')), `the first bell should hand over to the Treetops: ${tops.join(' / ')}`);
  return r.h;
});

test('climb: the zones change as you get higher', note => {
  const r = climbRun(11, 16000, { tap: 14, watch: true });
  const zones = [...r.zones];
  note(`${zones.length} zones seen: ${zones.join(' / ')}`);
  assert(zones.length >= 5, `only saw ${zones.length} zones climbing to floor ${r.floors}`);
  assert(zones.some(z => /Garden/.test(z)), 'the climb should start in the Garden');
  assert(zones.some(z => /Cloud Deck|Sky Castle|Stars|Outer Space/.test(z)),
    `never got above the rooftops: ${zones.join(' / ')}`);
  return r.h;
});

/* Six powers, and the house rule from Oliver Run: one lasts until you pick up
   another, so there is never anything to lose. */
test('climb: all six powers turn up, and each one swaps the last', note => {
  const r = climbRun(11, 24000, { tap: 14, watch: true });
  const powers = [...r.powers];
  note(`${powers.length} powers seen: ${powers.join(' / ')}`);
  assert(powers.length === 6, `only ${powers.length} of 6 powers appeared: ${powers.join(' / ')}`);
  const swaps = [...r.shouts].filter(s => /swapped/.test(s));
  assert(swaps.length > 0, 'a second orb should say it swapped the power, and none did');
  return r.h;
});

/* REGRESSION GUARD, and the rule this game cannot bend. Every power is a leg
   up and not one of them may be a hobble — which three of them were, all at
   once, and none of it was visible by playing: Bouncy Ball could not reach
   the next floor and being permanently airborne locked it out of ladders,
   Sticky Grip flattened any jump made near a wall, and the star boost was a
   shove that threw the climber off whatever ladder they were on. Powers are
   read off the HUD tag, so this stays black box — it asks how far the climb
   got while each one was being carried. */
test('climb: no power-up is ever a hobble', note => {
  const gained = {};
  for (const seed of [11, 3]) {
    const h = createHarness('tower-climb', { seed });
    h.click('startBtn');
    pump(h, 5);
    let dir = 1, last = h.num('floors');
    for (let i = 0; i < 24000; i++) {
      if (i % 170 === 0) {
        h.keyUp(dir > 0 ? 'ArrowRight' : 'ArrowLeft');
        dir = -dir;
        h.keyDown(dir > 0 ? 'ArrowRight' : 'ArrowLeft');
      }
      if (i % 14 === 0) h.key('z');
      pump(h, 1);
      const tag = h.hidden('powerTag') ? '' : h.text('powerTag');
      const now = h.num('floors');
      if (tag) {
        if (!gained[tag]) gained[tag] = { floors: 0, frames: 0 };
        gained[tag].floors += Math.max(0, now - last);
        gained[tag].frames++;
      }
      last = now;
    }
    h.dispose();
  }
  const rows = Object.entries(gained)
    .map(([tag, g]) => ({ tag, rate: g.floors / g.frames * 1000, frames: g.frames }))
    .sort((a, b) => a.rate - b.rate);
  note(rows.map(r => `${r.tag} ${r.rate.toFixed(1)}/1k`).join('  '));
  assert(rows.length === 6, `only ${rows.length} powers were carried long enough to measure`);
  for (const r of rows) {
    assert(r.rate > 0.8,
      `${r.tag} climbed ${r.rate.toFixed(2)} floors per 1000 frames — that power is a hobble, not a gift`);
  }
});

/* A long fall is caught and turned into a slow float. Nothing in this game
   takes anything away, and a drop down the middle of the tower is the one
   thing that could — so it is the one thing most worth proving. */
test('climb: a long fall is always caught', note => {
  const h = createHarness('tower-climb', { seed: 30 });
  h.click('startBtn');
  pump(h, 5);
  let softs = 0, showing = false, worstDrop = 0, peak = 0;
  let dir = 1;
  for (let i = 0; i < 14000; i++) {
    if (i % 90 === 0) {
      h.keyUp(dir > 0 ? 'ArrowRight' : 'ArrowLeft');
      dir = -dir;
      h.keyDown(dir > 0 ? 'ArrowRight' : 'ArrowLeft');
    }
    if (i % 11 === 0) h.key('z');
    h.clearPainted();
    pump(h, 1);
    const up = h.paintedSome(/SOFT!/);
    if (up && !showing) softs++;
    showing = up;
    // the gauge paints the live floor beside the marker every frame
    const now = h.num('floors');
    if (now > peak) peak = now;
    worstDrop = Math.max(worstDrop, peak - now);
  }
  note(`${softs} soft landings, highest floor ${peak}`);
  assert(softs > 0, 'nobody ever fell far enough to be caught — the catcher is not firing at all');
  return h;
});

/* The critters are scenery with a bounce in them: land on one and it is a
   free jump, walk into one and it is a boop and a giggle. Neither may cost
   a floor, and a boop always shoves you towards the middle of whatever you
   are standing on rather than off the edge of it. */
test('climb: critters bounce you, they never stop you', note => {
  const h = createHarness('tower-climb', { seed: 19 });
  h.click('startBtn');
  pump(h, 5);
  let boings = 0, boops = 0, bShow = false, pShow = false;
  let dir = 1;
  for (let i = 0; i < 16000; i++) {
    if (i % 150 === 0) {
      h.keyUp(dir > 0 ? 'ArrowRight' : 'ArrowLeft');
      dir = -dir;
      h.keyDown(dir > 0 ? 'ArrowRight' : 'ArrowLeft');
    }
    if (i % 13 === 0) h.key('z');
    h.clearPainted();
    pump(h, 1);
    const b = h.paintedSome(/BOING!/), p = h.paintedSome(/BOOP!/);
    if (b && !bShow) boings++;
    if (p && !pShow) boops++;
    bShow = b; pShow = p;
  }
  note(`${boings} bounces, ${boops} boops, floor ${h.num('floors')}`);
  assert(boings > 0, 'nothing was ever bounced off');
  assert(h.num('floors') > 10, `the climb stalled at floor ${h.num('floors')} in a tower full of critters`);
  return h;
});

test('climb: the tower does things while you climb', note => {
  const r = climbRun(11, 20000, { tap: 14, watch: true });
  const wanted = ['Balloons', 'Birds', 'Star shower', 'dog came up', 'Fireworks'];
  const seen = wanted.filter(w => [...r.shouts].some(s => s.toLowerCase().includes(w.toLowerCase())));
  note(`seen: ${seen.join(', ')}`);
  assert(seen.length >= 3, `only ${seen.length} of ${wanted.length} events happened: ${seen.join(', ')}`);
  return r.h;
});

/* The mirror of Daddy Smash's guard. Everything added to the tower is a
   gift, so none of it may slow the climb down: the birds are platforms, the
   balloons carry you, the dog is a trampoline, and the fireworks are only
   weather. */
test('climb: nothing added to the tower makes the climb slower', note => {
  const rates = [];
  for (const seed of [11, 7, 3]) {
    const r = climbRun(seed, 12000, { tap: 14, turn: 170 });
    rates.push(r.floors);
    r.h.dispose();
  }
  note(`floors per 12000 frames across three seeds: ${rates.join(', ')}`);
  // measured at 90-160 while all five events were being written
  for (const f of rates) assert(f >= 40, `only floor ${f} in 12000 frames — the climb got slower`);
});

test('climb: the best floor survives a reload', note => {
  let h = createHarness('tower-climb', { seed: 11 });
  h.click('startBtn');
  pump(h, 5);
  h.keyDown('ArrowRight');
  for (let i = 0; i < 6000; i++) { if (i % 14 === 0) h.key('z'); pump(h, 1); }
  h.keyUp('ArrowRight');
  pump(h, 300);                     // stop climbing, then let the save land
  const reached = h.num('floors');
  assert(reached > 3, `precondition: expected a decent climb, got floor ${reached}`);
  assert(/Best/.test(h.text('best')), `the best should show during play, got "${h.text('best')}"`);
  pump(h, 120);

  h = h.reload();
  const kept = parseInt(String(h.text('best')).replace(/[^\d]/g, ''), 10);
  note(`floor ${reached} before the reload, "${h.text('best')}" after`);
  /* >= rather than ===: the save is throttled, so a floor gained in the last
     moments of the run can legitimately be ahead of the last number read off
     the HUD. What must never happen is the record going BACKWARDS, which is
     exactly what a starved debounce did. */
  assert(kept >= reached,
    `best did not survive: expected at least ${reached}, kept "${h.text('best')}"`);
  assert(h.num('floors') === 0, 'a fresh run should start back at floor zero');
  return h;
});

test('climb: choosing Emsile sticks across a reload', note => {
  let h = createHarness('tower-climb', { seed: 2 });
  h.click('pickEmsile');
  assert(h.el('pickEmsile').getAttribute('aria-pressed') === 'true', 'Emsile should be selected');
  h.click('startBtn');
  pump(h, 200);
  assert(h.text('kidTag') === 'Emsile', `expected to be playing Emsile, got "${h.text('kidTag')}"`);
  h = h.reload();
  note(`after reload the menu offers ${h.text('kidTag')}`);
  assert(h.text('kidTag') === 'Emsile', `the choice did not stick: got "${h.text('kidTag')}"`);
  return h;
});

test('climb: swapping who you are mid-climb', note => {
  const h = createHarness('tower-climb', { seed: 2 });
  h.click('startBtn');
  pump(h, 60);
  assert(h.text('kidTag') === 'Oliver', 'precondition: starts as Oliver');
  h.click('swapBtn');
  pump(h, 10);
  assert(h.text('kidTag') === 'Emsile', `swap button did nothing: still "${h.text('kidTag')}"`);
  h.padPress('x');                 // the pad's secondary button does it too
  pump(h, 10);
  assert(h.text('kidTag') === 'Oliver', `X on the pad did not swap back: "${h.text('kidTag')}"`);
  note('swapped by button and by pad');
  return h;
});

/* ================================================================ *
 * games/treasure-boat
 *
 * The fifth game and the first with a WORLD in it rather than a level:
 * an ocean generated square by square out of a hash of the coordinates,
 * unbounded in every direction, with islands you land on and dig up.
 * That shape brings two promises the other four never had to make, and
 * most of this block is about them.
 *
 *   1. The sea stays where you left it. Squares are thrown away once
 *      they are over the horizon and rebuilt from the seed on the way
 *      back, so world content must come from cellRnd() and never from
 *      Math.random(). This is the sky-lane rule again in a new shape.
 *   2. Nobody is ever marooned. Not by empty water, not on an island,
 *      not by doing nothing at all. Dolphins tow a drifting boat to
 *      somewhere new and a seagull ferries a stranded walker to the X
 *      and then back to the boat.
 *
 * Everything is read off the same stub DOM the game writes to: `gold` is
 * the score, `tally` carries miles / islands / chests, `hereTag` is which
 * square of the map the boat is in, and `zoneTag` names the water — or
 * the island, when somebody is standing on one.
 * ================================================================ */

const BOAT_ZONES = ['Home Bay', 'Sunny Sea', 'Coral Cove', 'Misty Waters',
                    'The Deep Blue', 'Frosty North', 'Volcano Isles', 'Golden Sea'];

/* miles, islands, chests — the three little numbers under the gold */
function tally(h) {
  const n = String(h.text('tally')).match(/\d+/g) || [];
  return { miles: +n[0] || 0, isles: +n[1] || 0, chests: +n[2] || 0 };
}
function square(h) {
  const n = String(h.text('hereTag')).match(/-?\d+/g) || [];
  return { x: +n[0] || 0, y: +n[1] || 0 };
}
const ashore = h => String(h.text('zoneTag')).indexOf('\u{1F3DD}') === 0;

/* Sail somewhere, tapping as you go. A busy passenger rather than a clever
   one — it cannot see where the islands are, so use it to keep the
   machinery hot and to compare one run against another, never as a measure
   of how well a person would do. `turn` steers a square-ish course. */
function boatRun(seed, frames, opts) {
  const o = opts || {};
  const h = createHarness('treasure-boat', { seed });
  if (o.pick) h.click(o.pick);
  h.click('startBtn');
  pump(h, 5);
  const DIRS = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'];
  const seen = { zones: new Set(), shouts: new Set(), finds: new Set(), landed: new Set() };
  let d = 0;
  if (o.steer !== false) h.keyDown(DIRS[0]);
  for (let i = 0; i < frames; i++) {
    if (o.turn && i && i % o.turn === 0) {
      h.keyUp(DIRS[d]); d = (d + 1) % 4; h.keyDown(DIRS[d]);
    }
    if (o.tap && i % o.tap === 0) h.key('z');
    pump(h, 1);
    if (o.watch) {
      const z = h.text('zoneTag');
      for (const name of BOAT_ZONES) if (z.includes(name)) seen.zones.add(name);
      if (ashore(h)) seen.landed.add(z);
      if (h.hasClass('shout', 'show')) seen.shouts.add(h.el('shout').innerHTML);
      if (!h.hidden('findTag')) seen.finds.add(h.text('findTag'));
    }
  }
  Object.assign(seen, tally(h), { gold: h.num('gold'), h });
  return seen;
}

test('boat: boots to the menu in home water with nothing found', note => {
  const h = createHarness('treasure-boat');
  note(`loaded ${h.loaded.join(', ')}`);
  assert(!h.hidden('startScreen'), 'start screen should be visible before play');
  assert(h.num('gold') === 0, 'should start with no gold');
  assert(h.text('best') === '', `fresh install should show no best, got "${h.text('best')}"`);
  assert(h.text('kidTag') === 'Oliver', `expected to default to Oliver, got "${h.text('kidTag')}"`);
  assert(h.text('zoneTag').includes('Home Bay'), `should start in Home Bay, got "${h.text('zoneTag')}"`);
  assert(h.text('actWord') === 'Net', `the button should be the net at sea, got "${h.text('actWord')}"`);
  assert(h.hidden('findTag'), 'nothing has been found yet');
  pump(h, 120);
  assert(h.num('gold') === 0, 'nothing should happen while still on the menu');
  return h;
});

for (const [label, start] of Object.entries(STARTERS)) {
  test(`boat: sets sail from ${label}`, note => {
    const h = createHarness('treasure-boat', { seed: 42 });
    start(h);
    pump(h, 5);
    assert(h.hidden('startScreen'), `${label} did not set sail`);
    h.keyDown('ArrowRight');
    for (let i = 0; i < 900; i++) { if (i % 12 === 0) start(h); pump(h, 1); }
    const t = tally(h);
    note(`${t.miles} miles and ${t.isles} islands after 900 frames`);
    assert(t.miles > 3, `the boat went nowhere under ${label}: ${t.miles} miles`);
    return h;
  });
}

/* Unlike Tower Climb, BOTH axes of a held finger are read here. Up there a
   thumb parked low is how a child holds a phone and reading it as "down"
   rode every ladder back to the floor below; on a map seen from above,
   south is a real place to go and there is nothing to lose by going there. */
for (const [label, go, axis, want] of [
  ['held arrow keys', h => h.keyDown('ArrowRight'), 'x', 1],
  ['WASD', h => h.keyDown('s'), 'y', 1],
  ['the analogue stick', h => h.stick(-1, 0), 'x', -1],
  ['the d-pad', h => h.padHold('up', true), 'y', -1],
  ['a finger held low', h => h.pointerHold(0.5, 0.95), 'y', 1],
  ['a finger held high', h => h.pointerHold(0.5, 0.05), 'y', -1],
]) {
  test(`boat: steering with ${label}`, note => {
    const h = createHarness('treasure-boat', { seed: 4 });
    h.click('startBtn');
    pump(h, 5);
    go(h);
    pump(h, 2200);
    const sq = square(h);
    note(`${tally(h).miles} miles, ended in square ${sq.x}, ${sq.y}`);
    assert(tally(h).miles > 5, `${label} moved the boat almost nowhere`);
    assert(Math.sign(sq[axis]) === want,
      `${label} should have sailed ${axis === 'x' ? (want > 0 ? 'east' : 'west') : (want > 0 ? 'south' : 'north')}, ` +
      `ended at square ${sq.x}, ${sq.y}`);
    return h;
  });
}

/* The world is meant to be enormous. One long run in a straight line should
   cross every band of sea there is and still be going. */
test('boat: one long voyage crosses every sea in the world', note => {
  const r = boatRun(11, 20000, { tap: 11, watch: true });
  note(`square ${square(r.h).x}, ${square(r.h).y} after 20000 frames — ` +
       `${r.miles} miles, ${r.isles} islands, seas: ${[...r.zones].join(', ')}`);
  assert(r.zones.size === BOAT_ZONES.length,
    `only ${r.zones.size} of ${BOAT_ZONES.length} seas were reached: ${[...r.zones].join(', ')}`);
  assert(r.isles > 20, `only ${r.isles} islands found in a whole voyage`);
  return r.h;
});

/* THE NET NEVER COMES UP EMPTY. Junk is the joke, exactly as it is in
   Emsile's fishing game — the boot is worth a gold piece and a laugh, so a
   child who throws the net all afternoon is never once told "nothing". */
test('boat: every haul is worth something, and gold never goes backwards', note => {
  const h = createHarness('treasure-boat', { seed: 21 });
  h.click('startBtn');
  pump(h, 5);
  let last = 0, drops = 0, blanks = 0;
  const kinds = new Set();
  for (let i = 0; i < 9000; i++) {
    if (i % 9 === 0) h.key('z');
    pump(h, 1);
    const g = h.num('gold');
    if (g < last) drops++;
    last = g;
    if (!h.hidden('findTag')) {
      const f = h.text('findTag');
      if (!f.trim()) blanks++; else kinds.add(f);
    }
  }
  note(`${last} gold, ${kinds.size} different things caught`);
  assert(drops === 0, `gold went down ${drops} times — nothing at sea may ever take it away`);
  assert(blanks === 0, 'the net came up with a blank');
  assert(kinds.size >= 10, `only ${kinds.size} different things came up in 9000 frames`);
  // the boot and the crown both have to be in there
  const all = [...kinds].join(' ');
  assert(/Boot|Sock|Driftwood|Rusty Tin|Sponge|Sunnies/.test(all), 'no junk ever came up — the joke is missing');
  assert(/Fish|Crab|Squid|Prawn|Octopus|Turtle|Starfish|Shell/.test(all), 'nothing alive ever came up');
  assert(/Coins|Gem|Key|Pot|Anchor|Ring|Beads|Fork/.test(all), 'no treasure ever came up');
  return h;
});

/* The guard the fishing game bought so dearly. Every clamp in here adds to
   the DELTA — a tap is progress towards the haul, never a value pushed back
   to a bound — so tapping faster can only ever land more. Measured across
   four seeds because a single run's events (a gull dropping a coin, a whale
   surfacing) are worth more than the difference between two nearby
   cadences, and this is a test of the mechanism, not of the weather. */
test('boat: mashing the net catches more, at every possible tapping speed', note => {
  const CADENCES = [0, 40, 30, 20, 14, 10, 6, 3, 1];
  const totals = CADENCES.map(every => {
    let sum = 0;
    for (const seed of [5, 21, 33, 44]) {
      const h = createHarness('treasure-boat', { seed });
      h.click('startBtn');
      pump(h, 5);
      // no steering: a boat that never lands can only earn from the net
      for (let i = 0; i < 5000; i++) { if (every && i % every === 0) h.key('z'); pump(h, 1); }
      sum += h.num('gold');
      h.dispose();
    }
    return sum;
  });
  note(CADENCES.map((c, i) => `${c || 'never'}:${totals[i]}`).join('  '));
  const idle = totals[0];
  for (let i = 1; i < totals.length; i++) {
    assert(totals[i] > idle,
      `tapping every ${CADENCES[i]} frames earned ${totals[i]}, no better than never tapping (${idle})`);
  }
  /* Binned, not pairwise: two adjacent cadences are within the noise of one
     passing whale, but slow-vs-fast is not close. */
  const slow = totals[1] + totals[2] + totals[3];
  const mid  = totals[4] + totals[5] + totals[6];
  const fast = totals[7] + totals[8];
  assert(mid > slow, `middling tapping (${mid}) did no better than slow tapping (${slow})`);
  assert(fast > mid, `hard mashing (${fast}) did no better than middling tapping (${mid})`);
  assert(totals[totals.length - 1] > totals[1] * 3,
    `mashing every frame (${totals[totals.length - 1]}) should thoroughly beat one tap in forty (${totals[1]})`);
});

test('boat: landing on an island and digging up the X', note => {
  const r = boatRun(12, 15000, { tap: 7, watch: true });
  const finds = [...r.finds].join(' | ');
  note(`${r.chests} chests out of the sand, landed on ${r.landed.size} islands`);
  assert(r.landed.size > 0, 'the boat never landed on anything');
  assert(r.chests > 0, 'a whole voyage and not one X was ever dug up');
  assert(/Chest of Gold|Pirate Crown|Giant Diamond|Golden Cup|Golden Compass|Little Statue|Wooden Parrot|Sand Timer|Ship's Bell|Bone Whistle/.test(finds),
    `no chest treasure was ever named: ${finds}`);
  // digging anywhere else still turns something up — the spade's version of junk
  assert(/Little Shell|Sandy Crab|Funny Pebble|Old Bottle|One Coin|Fish Bone/.test(finds),
    `digging plain sand never gave anything back: ${finds}`);
  return r.h;
});

/* REGRESSION GUARD, and the promise this game rests on: the sea stays where
   you left it. Squares go over the horizon and are rebuilt from a hash of
   their own coordinates, so an island sailed away from is the same island
   on the way back.
 *
 * This is guarded at the source rather than through play, and deliberately
 * so: island identity is the cell key, so a world that quietly rearranged
 * itself would still report the same island count, the same chart and the
 * same score. Reaching for a behavioural test here was checked and found
 * wanting — the ocean was rebuilt from Math.random() on purpose and every
 * black-box assertion tried still passed. What actually changes is which
 * dice are rolled, so that is what gets asserted. */
test('boat: the sea is built from its own dice, never Math.random()', note => {
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'games', 'treasure-boat', 'index.html'), 'utf8');
  const from = src.indexOf('function cellRnd');
  const to = src.indexOf('const cellAt =');
  assert(from > 0 && to > from, 'could not find the world generator in the game source');
  const gen = src.slice(from, to);
  const strays = (gen.match(/Math\.random/g) || []).length;
  note(`${gen.split('\n').length} lines of world generation, ${strays} calls to Math.random()`);
  assert(strays === 0,
    `the world generator calls Math.random() ${strays} time(s) — squares would come back different`);
  assert(/Math\.imul\(cx/.test(gen) && /worldSeed/.test(gen),
    'cellRnd should be seeded from the square coordinates and the run seed');
});

/* Mirror of Daddy Smash's "nothing makes catches rarer" and Tower Climb's
   "nothing makes the climb slower". Everything in this ocean is a gift: the
   whirlpool is a fairground ride that throws you somewhere new, the monster
   gives you a lift, the pirates hand over a chest and sail on. */
test('boat: the sea does things while you sail, and all of them help', note => {
  const r = boatRun(11, 20000, { turn: 330, tap: 11, watch: true });
  const shouts = [...r.shouts].join(' | ');
  const wanted = ['Dolphins', 'Seagulls', 'A whale', 'A bottle', 'Crates', 'SEA MONSTER', 'Friendly pirates'];
  const seen = wanted.filter(w => shouts.toLowerCase().includes(w.toLowerCase()));
  note(`seen: ${seen.join(', ')}`);
  assert(seen.length >= 5, `only ${seen.length} of ${wanted.length} things happened: ${seen.join(', ')}`);
  return r.h;
});

test('boat: nothing added to the sea makes a voyage poorer', note => {
  const rates = [];
  for (const seed of [11, 3, 42]) {
    const r = boatRun(seed, 12000, { turn: 330, tap: 11 });
    rates.push(r.gold);
    r.h.dispose();
  }
  note(`gold per 12000 frames across three seeds: ${rates.join(', ')}`);
  // measured at 2700-3300 while the events were being written
  for (const g of rates) assert(g >= 900, `only ${g} gold in 12000 frames — the voyage got poorer`);
});

test('boat: the whirlpool is a ride, not a hazard', note => {
  let rides = 0;
  const golds = [];
  for (const seed of [11, 3, 99, 42, 7]) {
    const h = createHarness('treasure-boat', { seed });
    h.click('startBtn');
    pump(h, 5);
    h.keyDown('ArrowRight');
    let before = 0, showing = false;
    for (let i = 0; i < 20000; i++) {
      if (i % 11 === 0) h.key('z');
      const g = h.num('gold');
      pump(h, 1);
      const up = h.hasClass('shout', 'show') && /WHEEEEE/.test(h.el('shout').innerHTML);
      if (up && !showing) { rides++; before = g; golds.push(h.num('gold') - before); }
      showing = up;
    }
    h.dispose();
  }
  note(`${rides} rides across five voyages, gold change each time: ${golds.join(', ')}`);
  assert(rides >= 2, `only ${rides} whirlpool rides in five whole voyages`);
  for (const d of golds) assert(d >= 0, `a whirlpool cost ${-d} gold — it is supposed to be a present`);
});

/* NOBODY IS EVER MAROONED. This is the mirror of Tower Climb's balloons and
   it has to hold for a child who does nothing whatsoever: the dolphins tow a
   drifting boat somewhere new, a seagull ferries a stranded walker to the X
   and then back to the boat, and the loop begins again. A tow that was
   started at sea and finished on a beach once latched the "somebody is
   already helping" flag on for good, and the game quietly stopped helping. */
test('boat: a child who never touches anything is still shown the world', note => {
  const h = createHarness('treasure-boat', { seed: 8 });
  h.click('startBtn');
  let wasAshore = false, landings = 0, castOffs = 0;
  for (let i = 0; i < 12000; i++) {
    pump(h, 1);
    const now = ashore(h);
    if (now && !wasAshore) landings++;
    if (!now && wasAshore) castOffs++;
    wasAshore = now;
  }
  const t = tally(h);
  note(`${t.isles} islands, ${landings} landings and ${castOffs} departures with no input at all`);
  assert(t.isles >= 2, `a boat nobody is steering found only ${t.isles} island(s)`);
  assert(landings >= 2, `nobody was ever taken to a second island (${landings} landings)`);
  assert(castOffs >= 1, 'the walker was left on the island for good — nobody came to fetch them');
  return h;
});

test('boat: survives 20000 frames of hard sailing with no exception', note => {
  const r = boatRun(7, 20000, { turn: 190, tap: 5 });
  note(`${r.gold} gold, ${r.miles} miles, ${r.isles} islands, ${r.chests} chests`);
  assert(r.gold > 0, 'a hard-sailed voyage found nothing at all');
  return r.h;
});

test('boat: 20000 frames of never moving never throws either', note => {
  const h = createHarness('treasure-boat', { seed: 8 });
  h.click('startBtn');
  pump(h, 20000);
  note(`${h.num('gold')} gold and ${tally(h).isles} islands after doing nothing for 20000 frames`);
  assert(h.num('gold') >= 0, 'gold went negative');
  return h;
});

test('boat: a press in the dead space around the game still steers', note => {
  const h = createHarness('treasure-boat', { seed: 12 });
  h.click('startBtn');
  pump(h, 5);
  h.pageHold(-1.5, 0.5);            // a telly's cursor, well off to the left
  pump(h, 2500);
  const sq = square(h);
  note(`ended in square ${sq.x}, ${sq.y} after ${tally(h).miles} miles`);
  assert(sq.x < 0, `a hard-left press outside the box should sail west, ended at ${sq.x}`);
  return h;
});

test('boat: the best haul survives a reload', note => {
  let h = createHarness('treasure-boat', { seed: 11 });
  h.click('startBtn');
  pump(h, 5);
  h.keyDown('ArrowRight');
  for (let i = 0; i < 6000; i++) { if (i % 11 === 0) h.key('z'); pump(h, 1); }
  h.keyUp('ArrowRight');
  const reached = h.num('gold');
  assert(reached > 100, `precondition: expected a decent haul, got ${reached} gold`);
  assert(/Best/.test(h.text('best')), `the best should show during play, got "${h.text('best')}"`);
  pump(h, 200);                     // let the throttled save land

  h = h.reload();
  const kept = parseInt(String(h.text('best')).replace(/[^\d]/g, ''), 10);
  note(`${reached} gold before the reload, "${h.text('best')}" after`);
  /* >= rather than ===: the save is throttled, so gold earned in the last
     moments of a run can legitimately be ahead of the last number read off
     the HUD. What must never happen is the record going BACKWARDS. */
  assert(kept >= reached, `best did not survive: expected at least ${reached}, kept "${h.text('best')}"`);
  assert(h.num('gold') === 0, 'a fresh voyage should start with no gold');
  return h;
});

test('boat: choosing Emsile sticks across a reload', note => {
  let h = createHarness('treasure-boat', { seed: 2 });
  h.click('pickEmsile');
  assert(h.el('pickEmsile').getAttribute('aria-pressed') === 'true', 'Emsile should be selected');
  h.click('startBtn');
  pump(h, 200);
  assert(h.text('kidTag') === 'Emsile', `expected to be playing Emsile, got "${h.text('kidTag')}"`);
  h = h.reload();
  note(`after reload the menu offers ${h.text('kidTag')}`);
  assert(h.text('kidTag') === 'Emsile', `the choice did not stick: got "${h.text('kidTag')}"`);
  return h;
});

test('boat: swapping who you are mid-voyage', note => {
  const h = createHarness('treasure-boat', { seed: 2 });
  h.click('startBtn');
  pump(h, 60);
  assert(h.text('kidTag') === 'Oliver', 'precondition: starts as Oliver');
  h.click('swapBtn');
  pump(h, 10);
  assert(h.text('kidTag') === 'Emsile', `swap button did nothing: still "${h.text('kidTag')}"`);
  h.padPress('x');                 // the pad's secondary button does it too
  pump(h, 10);
  assert(h.text('kidTag') === 'Oliver', `X on the pad did not swap back: "${h.text('kidTag')}"`);
  note('swapped by button and by pad');
  return h;
});

/* ================================================================ *
 * games/star-wings
 *
 * The sixth game and the only one with a GUN in it. Free 2D flight, no
 * gravity and no floor anywhere — everything on screen is a target and
 * nothing is an obstacle. Two promises hold this one up:
 *
 *   1. THE GUN FIRES ITSELF. A child who only steers still shoots five
 *      times a second, clears every wave and beats every boss. Tapping
 *      adds shots to the same counter the clock is filling, so mashing
 *      can only ever help — the delta-not-total rule again.
 *   2. NOBODY EVER CRASHES. A bump shoves the rocket backwards and
 *      flashes it for a second. That is the entire cost of being hit:
 *      no lives, no shields, no gun taken away, no game over.
 *
 * `zapped` is the score and the readout for everything. `wingTag` says
 * whether the two rockets have joined, which is also the only thing the
 * DOM exposes about where the rocket IS — the wingman patrols the left
 * of the screen, so flying down into it is observable and flying up is
 * not. That is what the steering tests key off.
 * ================================================================ */

const WING_ZONES = ['Blue Skies', 'Cloud Tops', 'Sunset Run', 'Night Sky',
                    'Rainbow Road', 'Candy Clouds', 'Deep Space', 'Alien Garden'];
const WING_BOSSES = ['BIG PUFF', 'CLOUD MUM', 'SKY SNAKE', 'MOON MOTH',
                     'RAINBOT', 'BIG CAKE', 'STAR WHALE', 'VINE WORM'];
const WING_GUNS = ['Spread shot', 'Zap laser', 'Chaser bubbles', 'Boulder ball',
                   'Rainbow ray', 'Little helpers', 'Bumper bubble'];

/* Fly up and down, tapping as you go. A busy passenger, not a clever one —
   it cannot see what it is shooting at, so use it to keep the machinery hot
   and to compare one run against another. */
function wingRun(seed, frames, opts) {
  const o = opts || {};
  const h = createHarness('star-wings', { seed });
  if (o.pick) h.click(o.pick);
  h.click('startBtn');
  pump(h, 5);
  const seen = { zones: new Set(), bosses: new Set(), guns: new Set(), shouts: new Set() };
  let down = false;
  if (o.steer) h.keyDown('ArrowUp');
  for (let i = 0; i < frames; i++) {
    if (o.steer && i && i % o.steer === 0) {
      h.keyUp(down ? 'ArrowDown' : 'ArrowUp');
      down = !down;
      h.keyDown(down ? 'ArrowDown' : 'ArrowUp');
    }
    if (o.tap && i % o.tap === 0) h.key('z');
    pump(h, 1);
    if (o.watch) {
      for (const z of WING_ZONES) if (h.text('zoneTag').includes(z)) seen.zones.add(z);
      if (!h.hidden('bossBar')) seen.bosses.add(h.text('bossName'));
      if (!h.hidden('powerTag')) seen.guns.add(h.text('powerTag'));
      if (h.hasClass('shout', 'show')) seen.shouts.add(h.el('shout').innerHTML);
    }
  }
  seen.zapped = h.num('zapped');
  seen.h = h;
  return seen;
}

test('wings: boots to the menu with nothing zapped', note => {
  const h = createHarness('star-wings');
  note(`loaded ${h.loaded.join(', ')}`);
  assert(!h.hidden('startScreen'), 'start screen should be visible before play');
  assert(h.num('zapped') === 0, 'should start with nothing zapped');
  assert(h.text('best') === '', `fresh install should show no best, got "${h.text('best')}"`);
  assert(h.text('kidTag') === 'Oliver', `expected to default to Oliver, got "${h.text('kidTag')}"`);
  assert(h.hidden('bossBar'), 'no boss on the menu');
  assert(h.hidden('powerTag'), 'no gun tag on the menu — you start with the pop gun');
  assert(h.hidden('wingTag'), 'wings should not be joined on the menu');
  pump(h, 120);
  assert(h.num('zapped') === 0, 'nothing should happen while still on the menu');
  return h;
});

for (const [label, start] of Object.entries(STARTERS)) {
  test(`wings: blasts off from ${label}`, note => {
    const h = createHarness('star-wings', { seed: 42 });
    start(h);
    pump(h, 5);
    assert(h.hidden('startScreen'), `${label} did not blast off`);
    pump(h, 900);
    note(`${h.num('zapped')} zapped after 900 frames`);
    assert(h.num('zapped') > 0, `nothing was zapped under ${label}`);
    return h;
  });
}

/* THE GUN FIRES ITSELF. This is the promise that makes a shooter safe to
   hand to a five-year-old, and it is worth its own test rather than being
   an aside in another one: no taps at all, no steering at all, and the run
   still clears waves and beats mini bosses. */
test('wings: a child who never presses anything still shoots, and still wins', note => {
  const r = wingRun(11, 12000, { watch: true });
  const bosses = /👾(\d+)/.exec(r.h.text('best'));
  note(`${r.zapped} zapped, ${r.zones.size} zones, bosses met: ${[...r.bosses].join(', ')}, best line "${r.h.text('best')}"`);
  assert(r.zapped > 200, `a rocket nobody is flying only zapped ${r.zapped} in 12000 frames`);
  assert(r.bosses.size >= 2, `only ${r.bosses.size} mini boss(es) turned up with no input`);
  assert(bosses && +bosses[1] >= 1, `no mini boss was ever beaten without touching anything`);
  return r.h;
});

/* The delta-not-total guard, and the one measurement that had to be worked
   out rather than copied.
 *
 * Score alone will not show it. Waves arrive on a fixed clock, so once the
 * rocket is killing everything that crosses its line more bullets have
 * nothing left to hit and the zap count flattens out — the first cut of
 * this game fired five times a second on its own and mashing every single
 * frame scored no better than never touching the screen at all. The button
 * was decoration. The fix was to make the gun SCARCE (a slow automatic
 * floor, a tap worth half the gap), and the proof is not the score.
 *
 * What tapping really buys is a shorter boss fight — the one place in the
 * game where damage is the only thing that matters and there is no spawn
 * clock to saturate against. So that is what gets measured, and it is a
 * clean five-to-one across the range. The score is still checked, but only
 * for the house rule it has to satisfy: mashing is NEVER WORSE. */
test('wings: mashing shoots more, at every possible tapping speed', note => {
  const CADENCES = [0, 40, 30, 20, 14, 10, 6, 3, 1];
  const rows = CADENCES.map(every => {
    let zaps = 0, bossFrames = 0;
    for (const seed of [11, 5, 33, 7, 21, 42]) {
      const h = createHarness('star-wings', { seed });
      h.click('startBtn');
      pump(h, 5);
      let down = false;
      h.keyDown('ArrowUp');
      for (let i = 0; i < 6000; i++) {
        if (i && i % 110 === 0) {
          h.keyUp(down ? 'ArrowDown' : 'ArrowUp');
          down = !down;
          h.keyDown(down ? 'ArrowDown' : 'ArrowUp');
        }
        if (every && i % every === 0) h.key('z');
        pump(h, 1);
        if (!h.hidden('bossBar')) bossFrames++;
      }
      zaps += h.num('zapped');
      h.dispose();
    }
    return { every, zaps, bossFrames };
  });
  note(rows.map(r => `${r.every || 'never'}:${r.zaps}/${r.bossFrames}f`).join('  '));

  /* The score is allowed to be FLAT, within a few per cent, and that is not
     a fudge — it is the spawn clock. There is even a small honest channel
     the other way: killing a critter before it gets its shot off removes a
     slow bubble that was worth a zap of its own to pop, so a masher clears
     a fractionally quieter sky. It is worth a per cent or two against a
     boss effect of four to one. What this catches is a real decline — a
     clamp pushing the counter the wrong way would take a big bite, not
     three per cent. */
  const idle = rows[0];
  for (const r of rows.slice(1)) {
    assert(r.zaps >= idle.zaps*0.95,
      `tapping every ${r.every} frames zapped ${r.zaps}, well under never tapping (${idle.zaps})`);
  }
  const tapped = rows.slice(1).reduce((a, r) => a + r.zaps, 0)/(rows.length - 1);
  assert(tapped >= idle.zaps,
    `tapping at all averaged ${tapped.toFixed(0)} against ${idle.zaps} for never tapping`);
  const bf = i => rows[i].bossFrames;
  const slow = (bf(1) + bf(2) + bf(3))/3;
  const mid  = (bf(4) + bf(5) + bf(6))/3;
  const fast = (bf(7) + bf(8))/2;
  note(`frames stuck in boss fights — never ${idle.bossFrames} → slow ${slow.toFixed(0)} → ` +
       `mid ${mid.toFixed(0)} → mashing ${fast.toFixed(0)}`);
  assert(slow < idle.bossFrames, `slow tapping (${slow.toFixed(0)}) did not shorten a boss fight at all`);
  assert(mid < slow, `middling tapping (${mid.toFixed(0)}) was no quicker than slow tapping (${slow.toFixed(0)})`);
  assert(fast < mid, `hard mashing (${fast.toFixed(0)}) was no quicker than middling tapping (${mid.toFixed(0)})`);
  assert(fast < idle.bossFrames/2,
    `mashing (${fast.toFixed(0)}) should roundly beat never tapping (${idle.bossFrames}) — it is the whole point of the button`);
});

/* NO GUN IS EVER A HOBBLE — Tower Climb's lesson, where three of six powers
   were secretly worse than carrying nothing and none of it showed by
   playing. Rate is measured off the HUD tag, and boss frames are thrown
   away: a boss fight is long and pays nothing until it ends, so whichever
   gun happened to be carried through more of them looked worse than it was.
   The bar is the pop gun you start with — guns may differ from each other,
   but not one of them may be a downgrade on picking up nothing. */
test('wings: no gun is ever a hobble', note => {
  const rate = {};
  for (const seed of [11, 5, 33, 7]) {
    const h = createHarness('star-wings', { seed });
    h.click('startBtn');
    pump(h, 5);
    h.keyDown('ArrowUp');
    let down = false, prev = 0;
    for (let i = 0; i < 22000; i++) {
      if (i && i % 140 === 0) {
        h.keyUp(down ? 'ArrowDown' : 'ArrowUp');
        down = !down;
        h.keyDown(down ? 'ArrowDown' : 'ArrowUp');
      }
      if (i % 9 === 0) h.key('z');
      pump(h, 1);
      const z = h.num('zapped');
      const dz = Math.max(0, z - prev);
      prev = z;
      if (!h.hidden('bossBar')) continue;
      const tag = h.hidden('powerTag') ? 'Pop gun' : h.text('powerTag');
      const r = rate[tag] || (rate[tag] = { f: 0, z: 0 });
      r.f++; r.z += dz;
    }
    h.dispose();
  }
  const rows = Object.entries(rate)
    .filter(([, v]) => v.f > 1200)              // ignore a gun barely carried
    .map(([k, v]) => [k, v.z/v.f])
    .sort((a, b) => b[1] - a[1]);
  note(rows.map(([k, r]) => `${k} ${r.toFixed(4)}`).join('  '));
  const plain = rows.find(r => /Pop gun/.test(r[0]));
  assert(plain, 'never measured the plain pop gun, so there is nothing to compare against');
  const seen = WING_GUNS.filter(g => rows.some(r => r[0].includes(g)));
  assert(seen.length >= 6, `only ${seen.length} of ${WING_GUNS.length} guns were ever carried: ${seen.join(', ')}`);
  for (const [name, r] of rows) {
    if (/Pop gun/.test(name)) continue;
    assert(r >= plain[1],
      `${name} zaps ${r.toFixed(4)} a frame against the pop gun's ${plain[1].toFixed(4)} — it is a hobble`);
  }
});

/* The wingman patrols the left of the screen on its own path, so flying
   DOWN into it joins wings and flying UP does not. That is the only thing
   the DOM exposes about where the rocket is, which makes it the honest way
   to prove each input really moves it. It also guards the bug that made
   this mechanic unreachable: keeping station off the player's shoulder put
   the wingman permanently further away than the dock radius, so it backed
   off exactly as fast as a child chased it. */
for (const [label, down, up] of [
  ['held arrow keys', h => h.keyDown('ArrowDown'), h => h.keyDown('ArrowUp')],
  ['WASD', h => h.keyDown('s'), h => h.keyDown('w')],
  ['the analogue stick', h => h.stick(0, 1), h => h.stick(0, -1)],
  ['the d-pad', h => h.padHold('down', true), h => h.padHold('up', true)],
  ['a finger held on the glass', h => h.pointerHold(0.14, 0.62), h => h.pointerHold(0.9, 0.06)],
]) {
  test(`wings: steering with ${label}`, note => {
    const joinsAt = go => {
      const h = createHarness('star-wings', { seed: 4 });
      h.click('startBtn');
      pump(h, 5);
      go(h);
      let at = -1;
      for (let i = 0; i < 700; i++) { pump(h, 1); if (at < 0 && !h.hidden('wingTag')) at = i; }
      h.dispose();
      return at;
    };
    const a = joinsAt(down), b = joinsAt(up);
    note(`towards the wingman: joined at ${a < 0 ? 'never' : a}   away from it: ${b < 0 ? 'never' : b}`);
    assert(a >= 0, `${label} never reached the wingman — steering towards it did nothing`);
    assert(b < 0 || b > a*3,
      `${label} joined just as fast flying away (${b}) as towards (${a}) — it is not steering at all`);
  });
}

/* Being knocked apart is a spectacle, never a loss: the wingman spins off,
   comes straight back, and flying into it joins you up again. So a split
   must always be followed by another join — never the end of the mechanic
   for the rest of the run. */
test('wings: being knocked apart is never the end of it', note => {
  let joins = 0, splits = 0, endedJoined = 0;
  for (const seed of [33, 11, 5]) {
    const h = createHarness('star-wings', { seed });
    h.click('startBtn');
    pump(h, 5);
    let was = false;
    for (let i = 0; i < 20000; i++) {
      if (i % 9 === 0) h.key('z');
      pump(h, 1);
      const on = !h.hidden('wingTag');
      if (on && !was) joins++;
      if (!on && was) splits++;
      was = on;
    }
    if (was) endedJoined++;
    h.dispose();
  }
  note(`${joins} joins and ${splits} splits across three runs; ${endedJoined}/3 ended with wings joined`);
  assert(joins >= 3, `the two rockets only joined ${joins} times in three whole runs`);
  assert(joins > splits, `${splits} splits against ${joins} joins — a split was never recovered from`);
});

test('wings: every zone and every mini boss turns up', note => {
  const r = wingRun(11, 40000, { steer: 140, tap: 7, watch: true });
  const missingZ = WING_ZONES.filter(z => !r.zones.has(z));
  const missingB = WING_BOSSES.filter(b => !r.bosses.has(b));
  note(`${r.zones.size}/${WING_ZONES.length} zones, ${r.bosses.size}/${WING_BOSSES.length} bosses, ${r.zapped} zapped`);
  assert(missingZ.length === 0, `never flew through: ${missingZ.join(', ')}`);
  assert(missingB.length === 0, `never met: ${missingB.join(', ')}`);
  return r.h;
});

/* A boss must never be able to trap somebody. A child who parks the rocket
   in a corner where its shots do not line up has to get out of the fight
   anyway, so after forty seconds the boss gets bored, gives up and leaves
   its orb behind. Same shape as Tower Climb's balloons and the dolphins in
   Treasure Boat: the game gets you out, you do not have to. */
test('wings: a boss that cannot be beaten gives up and flies off', note => {
  let gaveUp = 0, showing = false, beaten = 0;
  for (const seed of [11, 8]) {
    const h = createHarness('star-wings', { seed });
    h.click('startBtn');
    pump(h, 5);
    for (let i = 0; i < 22000; i++) {
      pump(h, 1);
      const up = h.hasClass('shout', 'show') && /GAVE UP/.test(h.el('shout').innerHTML);
      if (up && !showing) gaveUp++;
      showing = up;
    }
    const m = /👾(\d+)/.exec(h.text('best'));
    beaten += m ? +m[1] : 0;
    h.dispose();
  }
  note(`${gaveUp} bosses gave up and ${beaten} were beaten outright, across two idle runs`);
  assert(beaten + gaveUp >= 4, `only ${beaten + gaveUp} boss fights ever ended — one of them is a trap`);
  assert(gaveUp >= 1, 'no boss ever gave up, so the way out of a stuck fight is untested');
});

test('wings: survives 20000 frames of hard flying with no exception', note => {
  const r = wingRun(7, 20000, { steer: 90, tap: 4 });
  note(`${r.zapped} zapped, best "${r.h.text('best')}"`);
  assert(r.zapped > 100, 'a hard-flown run zapped almost nothing');
  return r.h;
});

test('wings: a press in the dead space around the game still flies the rocket', note => {
  const h = createHarness('star-wings', { seed: 4 });
  h.click('startBtn');
  pump(h, 5);
  // a telly's cursor, well off to the left of the box and level with the
  // wingman's patrol — the kit clamps it to the edge, which is a hard left
  h.pageHold(-1.5, 0.5);
  let at = -1;
  for (let i = 0; i < 1600; i++) { pump(h, 1); if (at < 0 && !h.hidden('wingTag')) at = i; }
  note(`joined wings at frame ${at < 0 ? 'never' : at} steering from outside the box`);
  assert(at >= 0, 'a press outside the game box did not fly the rocket at all');
  return h;
});

test('wings: the best score survives a reload', note => {
  let h = createHarness('star-wings', { seed: 11 });
  h.click('startBtn');
  pump(h, 5);
  for (let i = 0; i < 6000; i++) { if (i % 9 === 0) h.key('z'); pump(h, 1); }
  const reached = h.num('zapped');
  assert(reached > 50, `precondition: expected a decent score, got ${reached}`);
  assert(/Best/.test(h.text('best')), `the best should show during play, got "${h.text('best')}"`);
  pump(h, 200);                     // let the throttled save land

  h = h.reload();
  const kept = parseInt(String(h.text('best')).replace(/[^\d]/g, ''), 10);
  note(`${reached} zapped before the reload, "${h.text('best')}" after`);
  assert(kept >= reached, `best did not survive: expected at least ${reached}, kept "${h.text('best')}"`);
  assert(h.num('zapped') === 0, 'a fresh run should start at nothing zapped');
  return h;
});

test('wings: choosing Emsile sticks across a reload', note => {
  let h = createHarness('star-wings', { seed: 2 });
  h.click('pickEmsile');
  assert(h.el('pickEmsile').getAttribute('aria-pressed') === 'true', 'Emsile should be selected');
  h.click('startBtn');
  pump(h, 200);
  assert(h.text('kidTag') === 'Emsile', `expected to be playing Emsile, got "${h.text('kidTag')}"`);
  h = h.reload();
  note(`after reload the menu offers ${h.text('kidTag')}`);
  assert(h.text('kidTag') === 'Emsile', `the choice did not stick: got "${h.text('kidTag')}"`);
  return h;
});

test('wings: swapping who you are mid-flight', note => {
  const h = createHarness('star-wings', { seed: 2 });
  h.click('startBtn');
  pump(h, 60);
  assert(h.text('kidTag') === 'Oliver', 'precondition: starts as Oliver');
  h.click('swapBtn');
  pump(h, 10);
  assert(h.text('kidTag') === 'Emsile', `swap button did nothing: still "${h.text('kidTag')}"`);
  h.padPress('x');                 // the pad's secondary button does it too
  pump(h, 10);
  assert(h.text('kidTag') === 'Oliver', `X on the pad did not swap back: "${h.text('kidTag')}"`);
  note('swapped by button and by pad');
  return h;
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
