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
