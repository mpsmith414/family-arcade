# Family Arcade — working notes

Homemade browser games for my two young kids. Oliver (older) and Emsile (little
sister) are the characters in both games. Built to be played on a phone, a
tablet, and a TV with a controller.

Six games, deliberately unlike each other. Keep it that way: a seventh should
contrast with all six rather than land in between.

- `games/oliver-run` — endless runner, tap to jump, 14 worlds, 18 bosses, scores
  distance. Adventure deals the worlds from a shuffle bag, so a full set comes
  round before any repeat and no two runs open the same way. Each world owns a
  palette, a backdrop shape, its weather (`wx`) and how heavy the jump feels;
  `grav` and `jump` always move together as `jump = sqrt(2*grav*152)`, because
  152px is the apex the sky lane's platforms are placed around. Change one
  without the other and that world's high road becomes unreachable.
  The sky lane is open during boss fights too, where the pads hover at a third
  of the world speed so they can be climbed and waited on; dropping onto a
  charging boss from one is a SKY SMASH.
  A boss fight has an arc rather than five identical exchanges: each boss has
  one `trick` it works between charges (`throw` lobs junk you smash, `summon`
  calls in that world's critters, `quake` shakes rubble off the floor), it
  goes red-hot and faster at half health, the wait between charges shrinks as
  its health falls, hits landed without touching the ground pay a rising
  combo, and a power-up orb always pops out of the wreck. Everything a boss
  produces is a target, never a threat — the no-fail rule does not bend for
  bosses.
  Enemies come in four shapes — crawlers, flyers, swarms and brutes — composed
  by `drawFoe` from a per-world `foe` spec, the same trick the generic bosses
  use. Flyers have their own spawn clock so the sky can fill up without the
  ground getting any busier. **Only the poppable half of the spawn table is
  dense**: big smashables still arrive at the old rate, because they are the
  only thing that slows you down and a run made of nothing but BONKs is a
  punishment however loud it is.
  Ten power-ups, and **a power lasts until you pick up another one** — no
  timers, no expiry, nothing to lose. Orbs keep arriving so there is always
  something to trade for. Everything a power does is either automatic or maps
  onto the single button: wings flap, the bubble bounces itself, lightning
  fires itself, the freeze ray stops the world.
  Announcements all go through one queue (`announce`, drawn by `drawBanner`)
  so a new world can't wipe the boss it just beat off the screen. Each one
  carries a picture from `drawGlyph`, because the audience is five. When the
  queue overflows it drops the **least important** card waiting, not the
  oldest — dropping the oldest silently ate the "swapped!" card whenever a
  fight got loud, and a kid who just traded one power for another is owed
  that feedback more than the screen is owed a tidy queue.
- `games/emsile-fishing` — still screen, tap on the bite, scores a book of 15 sea
  creatures. Tap does four jobs depending on state (wiggle the lure / hook the
  fish / reel faster / skip the celebration), and mashing is always rewarded,
  never punished. Miss a bite and the hook still comes up with junk, which is
  the joke rather than a penalty.
  Every catch rolls a size and the biggest of each species is kept, so a
  duplicate is never a dud — it might be the biggest one yet. Anything big or
  rare puts up a fight: a longer reel with the rod bent and the boat lurching,
  and it stays a dark silhouette until it breaks the surface. That reveal is
  the payoff, so the tap-to-reel-faster boost is capped short of the end and
  can never skip it.
  **Things happen while you fish** (`fireEvent`): a shoal arrives, dolphins go
  past, rain comes on, night falls, treasure glints on the bottom, a bottle
  floats by to be tapped, or the boat drifts to another zone. Every one is a
  gift — several shorten the wait, none may ever lengthen it or cost a catch.
  The zone is **where the boat is**, not how far the book has got: `maxZone()`
  is the earned depth and only grows, `zi` moves around inside it. They used to
  be the same value, which parked you in The Deep Deep for ever after two dozen
  catches and was the single biggest reason it went stale.
- `games/daddy-smash` — free movement round one room, both kids on screen at
  once, Daddy chasing. **This is the one that breaks the one-button rule, on
  purpose and by request:** there is no button at all, only steering. The whole
  contrast is that it is neither a runner nor a still screen — it is a floor
  plan you move around in, and *being caught is the reward*, not the failure.
  Getting smashed on the couch is the payoff the game is named after, so
  anything that makes catches rarer is a bug and anything that makes them
  feel like a punishment is a worse one.
  There are five finishers (`SMASHES`), not one — couch flop, aeroplane,
  cannonball, dogpile, blanket burrito — each with its own carry, landing
  spot and shout, and every shout leads with the name of whoever it happened
  to. **Things happen in the room too** (`fireEvent`): the dog wakes up and
  joins in, balloons drift down to be popped, the lights go out with a torch
  on the player, or Daddy stands still and dares them to come and get him.
  Each one has to be a gift — the dog only licks, "come and get me" is an
  instant catch, and Daddy is quietly quicker in the dark to pay for nobody
  being able to see him. `daddy: nothing added to the room makes catches
  rarer` is the guard on that.
- `games/tower-climb` — a Donkey-Kong-shaped maze of floors that goes up for
  ever, scored in floors climbed. The only game you both **steer and tap**:
  hold a finger where you want to go, every fresh tap is a jump. The pointer's
  x steers and its **height is deliberately ignored** — a thumb parked at the
  bottom of a phone is how a small child holds one, and reading that as "down"
  rode every ladder back to the floor below.
  **Ladders are escalators**: walk into one and you ride it, no button and no
  timing. That is the promise the whole game rests on, so every floor is
  generated with at least one route up that needs no jump at all — a ladder or
  a spring, never only steps. `linkUp()` places routes only where both floors
  are solid, which is why floors are built in two passes rather than one.
  A tap on a ladder is a **rung-leap up it, not a release from it**. Letting go
  was the obvious reading and it made mashing the slowest way to play: a child
  who tapped constantly bounced off the foot of every ladder in the tower.
  Nothing may ever get worse the harder the button is hit —
  `climb: mashing is never worse than not tapping, at every speed` sweeps the
  whole range of cadences, the same shape of guard as the fishing one.
  **Nobody ever gets stuck.** If seven seconds pass without any height gained,
  balloons come and fetch them. The counter is frames-since-the-last-floor, not
  frames-since-an-input: the common case is a child leaning on one direction
  with their back to a wall, and "are they pressing anything?" misses it
  entirely. On a section's top floor the balloons ferry them *sideways to the
  bell* instead of lifting, because the bell is the only way off that floor.
  Every eighth floor is a **top floor**: solid, no routes up, just a bell.
  Ringing it flies the climber into the next zone — the epic moment, every
  eight floors. Once rung the floor gets ordinary routes, or a climber who fell
  back down a gap would be standing on the one floor with no way up.
  Six powers, same rule as Oliver Run: one lasts until you take another. Three
  of them were *hobbles* when first written and none of it was visible by
  playing — the Bouncy Ball apexed just short of a floor and being permanently
  airborne locked it out of ladders, Sticky Grip assigned its climb speed and so
  flattened any jump made near a wall, and the star boost was a shove that threw
  you off whatever ladder you were on. `climb: no power-up is ever a hobble`
  measures floors-per-frame while each one is carried, read off the HUD tag.
  Falling is never a punishment: a drop of more than a floor turns into a slow
  float on a cloud. There are no ceilings anywhere — every platform is one-way,
  so you rise straight through them and only ever land on a top.
- `games/treasure-boat` — a top-down open sea you steer a fishing boat around,
  scored in gold. The only game with a **world** in it rather than a level, and
  the contrast the other four leave room for: no scrolling lane, no single
  room, no vertical shaft — a map that goes on for ever in all four directions
  with a chart in the corner filling in as you go.
  **The ocean is built one square at a time from a hash of that square's own
  coordinates and the run's seed** (`cellRnd`), never from `Math.random()`.
  That is the whole trick: squares are thrown away once they are five squares
  over the horizon and rebuilt identically on the way back, so an island you
  sailed away from is the same island when you return. Roll the world off
  `Math.random()` and the sea quietly rearranges itself behind the boat — and
  because an island's identity is its square, nothing in the score or the chart
  would ever notice. `boat: the sea is built from its own dice` guards it at the
  source, which is the honest place: a behavioural test was written, the world
  was deliberately randomised to check it, and every black-box assertion still
  passed. A fresh `worldSeed` each run is what makes every voyage a new world.
  Two modes, one control scheme. At sea you steer and the button throws the
  net; ashore you steer a walker and the button digs. Landing is automatic —
  **bumping an island is how you get onto it**, land is a landing and never a
  wall. The one exception is the island you just cast off from (`leftIsle`),
  where the hull instead swings onto the tangent and follows the coast round.
  That has to key off the island rather than a stopwatch: a plain "no landing
  for two seconds" pinned a child holding one direction against the beach they
  had just left, re-landing the moment the clock ran out, and the voyage ended
  at the first island in the sea.
  **Both axes of a held finger are read**, unlike Tower Climb — this is a map
  seen from above, so a low thumb means south, which is a real place to go.
  A finger over the middle means stop.
  Everything the net or the spade turns up pays: the boot is worth a gold piece
  and a laugh, same as the fishing game's junk. Tapping adds to the *delta* of
  the haul or the hole and never clamps a total, so mashing can only ever land
  more — `boat: mashing the net catches more, at every possible tapping speed`
  sweeps the whole range, binned across four seeds because one passing whale is
  worth more gold than the gap between two neighbouring cadences.
  **Things happen at sea too** (`fireEvent`): dolphins escort and tow, gulls
  drop coins, a whale lifts the boat, a bottle holds a treasure map, crates
  float by, the sea monster gives you a lift and the pirates hand over a chest.
  Whirlpools are a fairground ride that flings the boat a couple of thousand
  pixels somewhere new — the fastest way to find fresh islands in the game, and
  they pull gently from three radii out so a five-year-old can actually land in
  one. Every one of these is a gift; `boat: nothing added to the sea makes a
  voyage poorer` is the guard.
  **Nobody is ever marooned.** Eight seconds with nothing found and help
  arrives: dolphins tow the boat to an island it has not seen before (an
  unvisited one by preference — towing to the *nearest* island carried a
  passive child back to the one they had just been carried off, for ever), and
  ashore a seagull ferries the walker to the X, then to the boat the next time.
  Digging plain sand pays but is marked `quiet` so it does not reset that
  timer, or a child happily digging one spot would never be shown the X.
- `games/star-wings` — a side-on shoot-em-up, Aegis Wing shaped, scored in
  critters zapped. **The only game with a gun in it**, and the only one with
  no gravity and no floor anywhere: the whole screen is flyable, everything
  in it is a target and nothing is an obstacle. That is the line between
  this and Oliver Run, which shares the scrolling-and-worlds skeleton — over
  there you are avoiding things on a floor, here you are shooting things in
  the open. Deliberately eight zones and eight mini bosses, not fourteen and
  eighteen: Oliver Run is the one with the big world tour in it.
  **The gun fires itself**, and that is what makes a shooter safe to hand to
  a five-year-old — a child who only steers still shoots, clears every wave
  and beats every boss. A tap adds `tapShot` to the same counter the clock
  is filling, so mashing shortens the gap without ever clamping a total.
  `fireGap` and `tapShot` are a pair and they were wrong once in a way only
  measuring found: at 12 and 6 the automatic gun alone killed everything
  that crossed the rocket's line, so **mashing every frame scored no better
  than never touching the screen**. See the saturation note below.
  **Joining wings is the signature** and nothing else in the arcade has a
  co-op merge: fly into your brother or sister's rocket and the two clip
  together into one machine with an extra gun and a green ring. Only a boss
  can knock you apart, and that is a spectacle rather than a loss — the
  wingman spins off, comes back and can be rejoined. The wingman flies **its
  own slow circle** round the left of the screen, both axes on one clock. It
  used to keep station off your shoulder, which put it permanently further
  away than the dock radius: it backed off exactly as fast as a child chased
  it and the headline mechanic could only ever happen by accident.
  Being hit costs a shove backwards and a second of flashing. That is all it
  costs — there are no lives, no shield to lose and no gun taken away. Enemy
  fire is big, slow and **poppable**, and popping it pays, because a
  five-year-old cannot dodge and a bullet you can shoot down is the only
  kind this game is allowed to have.
  Eight guns, same rule as Oliver Run and Tower Climb: one at a time, until
  you take another. `wings: no gun is ever a hobble` measures each one's
  zaps per frame off the HUD tag and throws away boss frames — a boss fight
  is long and pays nothing until it ends, so whichever gun happened to be
  carried through more of them read as worse than it was.
  **A boss that cannot be beaten gets bored and leaves**, dropping its orb.
  Forty seconds. That is the balloons of Tower Climb and the dolphins of
  Treasure Boat: a child who parks the rocket in a corner where its shots
  never line up must not be stuck in the same fight for ever.

## Hard constraints — do not break these

- **No build step, no npm, no dependencies, no framework.** Vanilla HTML + CSS +
  canvas 2D + WebAudio. A game must run by opening its `index.html` over plain
  HTTP. If a change would require a bundler or a package install, propose it
  first rather than doing it.
- **Never use `window.storage`.** That's a Claude-artifact-only API and silently
  fails in real browsers. Use `KidKit.storage`.
- **No `localStorage` / `sessionStorage` calls directly either** — go through
  `KidKit.storage`, which falls back to memory when storage is blocked (private
  browsing, some TV browsers).
- **Relative paths only.** The site is served from a subpath on GitHub Pages
  (`/family-arcade/`). Absolute paths like `/shared/kidkit.js` will 404.
- **ES5-safe in `shared/kidkit.js`.** It may load in older smart-TV browsers.
  Games can use modern syntax; the kit should stay conservative.

## After changing any game, bump the service worker cache

`sw.js` → `const CACHE = 'arcade-v1'` → `v2`, `v3`, … Forgetting this is the
number one time sink: phones keep serving the cached old version and it looks
like the fix didn't work. Also add any new file to the `FILES` array.

## How to verify changes

No test framework, but the harness is no longer throwaway — it lives in
`test/harness.js`. It stubs the DOM, canvas, WebAudio and a gamepad, then
drives the real game loop for thousands of frames. Two bugs were caught this
way that eyeballing missed (a `ReferenceError` firing every frame a power-up
was active, and a hitbox that stretched to the ground while jumping).

```bash
node test/smoke.js            # all six games, several minutes, no dependencies
node test/smoke.js powers     # only tests matching "powers"
node test/smoke.js fishing    # only the Emsile Fishing block
node test/smoke.js daddy      # only the Daddy Smash block
node test/smoke.js climb      # only the Tower Climb block
node test/smoke.js boat       # only the Treasure Boat block
node test/smoke.js wings      # only the Star Wings block
node test/smoke.js levels     # only the fourteen-worlds block
```

The harness draws to a no-op canvas, so it proves the game does not throw and
that the numbers add up — it says nothing about whether the art looks right.
For that, serve the folder and screenshot it in a real browser; Chromium and
Playwright are already on the box. Doing that caught two things the tests could
not: the fish book's bottom row sitting under the on-screen buttons, and every
uncaught silhouette leaking its hard-coded highlights.

**The proxy hides thrown canvas calls**, which is a sharper version of the same
point. `ctx` is a Proxy of no-ops, so a call a real browser rejects — a gradient
built on NaN coordinates, say — does nothing at all in the harness and throws
`IndexSizeError` out of the render loop in Chromium, freezing the canvas on its
last good frame. The tests stayed green while the game was dead on screen. Any
new drawing code wants one look in a browser before you believe it.

The harness takes a folder name and works for any game under `games/`: it
walks that game's `<script>` tags in order, evals `src=` ones off disk (which
is how `shared/kidkit.js` gets loaded) and evals the inline one. Nothing in it
is specific to Oliver Run, and no game code had to change to make it testable
— the assertions read the same stub DOM the game already writes to.

```js
const { createHarness } = require('./test/harness');
const h = createHarness('oliver-run');
h.tap();              // also .key('ArrowUp'), .padPress('a'), .holdJump(true)
h.frames(600);        // pump the real update + render
h.text('score');      // read it back off the stub DOM
h.reload();           // same storage, fresh page — for persistence tests

// held input, for a game you steer instead of tapping
h.keyDown('ArrowLeft');  h.keyUp('ArrowLeft');
h.stick(-1, 0);          // left stick, sticks until set back to 0,0
h.padHold('left', true); // d-pad held, unlike padPress which is one edge
h.pointerHold(.02, .95); h.pointerRelease();

// a telly's cursor: pressing beside the game, and losing the page's focus
h.tapPage(-1.5, .5);     // press outside the box; nx/ny still measured across it
h.pageHold(-2, .5);      // …and held, for steering
h.loseFocus(); h.regainFocus();
h.byId('kk-focus-guard');// nodes the page built at runtime, unlike el()
```

Feel values for the sky lane, the boss-arena pads and the glide all live in the
`TUNE` object at the top of `games/oliver-run/index.html`. Change those rather
than hunting through the game loop. Anything sky-lane related must draw from
`skyRnd`, and weather from `wxRnd`, never `Math.random()` — the ground-lane
regression test asserts an exact fingerprint of the `Math.random()` stream, and
one stray draw on the render path breaks it. That test is what proves the
younger child's game is untouched by everything added above it, so treat a
failure there as a real defect, never a flaky test.

Its baseline has been re-captured exactly once, when the ten later worlds and
the shuffled running order landed — both of those *are* the ground lane, so the
old numbers could not survive. The proof was never the literal numbers: it is
that the two runs, one holding the button and one not, agree to the draw. Only
re-capture for a change that is deliberately about the ground lane, and never
to quieten a red test.

The harness can read what the game paints, not just what it writes to the DOM:
`h.painted()` / `h.paintedSome(re)` / `h.clearPainted()` return the strings sent
to `fillText`/`strokeText`. It is a rolling window, so for a rare event in a long
run call `clearPainted()` first — a too-small window once made a working mechanic
read as "never happened". Score pops, level banners and the boss warning never
reach the DOM, so that is the only way to assert on them — it is how the
fourteen-worlds test reads the running order (the level label alone can't, since
a world following itself would look like no change at all).

Gotchas already handled in there, worth knowing before you change it:

- **Node has a built-in read-only `navigator`** that shadows a plain
  `global.navigator = {...}`. Gamepad mocks silently see zero pads, so it goes
  in via `Object.defineProperty`.
- `ctx` is a Proxy of no-ops, but `createLinearGradient` / `createRadialGradient`
  return an object with `addColorStop` or the sky never draws.
- `setInterval` callbacks are collected and run off a virtual clock — that is
  what drives the music scheduler.
- Time is virtual, so a debounced `setTimeout(…, 1500)` like `saveBest()` only
  fires if you pump enough frames to reach it.
- A pad button must be down for exactly one `poll()` to read as a press; held
  longer it is one jump, same as a real stuck button.
- `h.bucket(k, n)` biases the *whole* RNG stream to force a specific power-up.
  That stops rejection-sampling loops from escaping — `index.html:894` picks a
  different backdrop that way in Boss Rush — so keep `bucket()` to adventure
  mode. A runaway-RNG guard fails the test instead of hanging if you don't.

## Where the shared layer ends

`shared/kidkit.js` owns storage, input (touch/mouse/keyboard/TV remote/gamepad),
the WebAudio unlock, the chiptune music engine, and the kid lock. Games supply
only their own data and rules. If you find yourself writing a second copy of any
of those in a game, move it into the kit instead.

Steering lives there too, behind `KidKit.input.create({steer:true})`, which adds
`.axis()` (held arrows/WASD + left stick + d-pad, clamped to a unit circle so a
diagonal isn't faster) and `.pointer()` (where a finger is being held, 0..1
across the element). Daddy Smash, Tower Climb and Treasure Boat all call it and
none of them has its own copy; keep it that way.

### Playing on a TV — the cursor rules

A TV browser (Fire TV's Silk in particular) paints a mouse cursor over the page
and drives it with the left stick. Three things follow, all of them load-bearing:

- **A press anywhere on the page counts**, not just on the game box — the kit
  binds to the document as well as to the element, and the element is only used
  to work out *where* the press was. Don't narrow that back to the stage.
- **The games fill the screen** (`#stage` scales to the viewport instead of
  stopping at 920px). Any dead border is somewhere the cursor can sit where a
  press does nothing, which reads to a kid as a broken controller.
- **`KidKit.focusGuard()`** watches `document.hasFocus()`, because a cursor
  pushed past the edge of the page hands focus to the browser chrome, and from
  then on `keydown` never fires and `getGamepads()` freezes. It covers the page
  with a "Press any button" panel — the press that hits it is what brings focus
  home, and it spends that gesture on fullscreen when a pad is connected.
  `input.create()` arms it; opt out with `{focusGuard:false}`.

Gamepad mapping is deliberate: **almost every button jumps**, because a
five-year-old shouldn't have to find the right one. Only X/Y are a separate
action. Don't "fix" this by narrowing it.

### The d-pad is not always buttons 12-15

Reported from a real controller: the d-pad did nothing in any game, and the
only way to move was to hold A and shove the telly's cursor about with the
stick. Buttons 12-15 are the d-pad **only when `gamepad.mapping` is
`'standard'`**, and a great many pads — cheap Bluetooth ones especially, and
most of them once they are talking to a TV box rather than a desktop —
report `mapping:''` and hand the d-pad over as a **hat axis** instead,
usually `axes[9]`. Reading only the buttons means those pads have no d-pad at
all. `hatVec()` decodes it; a hat encodes eight directions as eight evenly
spaced values from -1 (up) clockwise to 1, and parks *outside* -1..1 when
centred.

The careful part is not decoding something else by mistake, and there are two
traps. A value only counts when it lands within a shred of one of the eight,
which is what keeps an idle axis sitting at zero from reading as a direction
that is always held — zero is deliberately not one of the eight. And only
axes 9 and 10 are scanned, because some pads rest a **trigger** at -1 for
ever, and -1 is a perfectly good hat value meaning "up": scan wider and the
player walks into the ceiling for the whole game with nobody touching
anything. `kit: a centred hat is not a direction` is the guard on both.

### A cursor that is moving counts, with no button held

Same report, other half. A TV browser eats the left stick to drive its own
mouse cursor, so the stick never reaches the page as a stick — which left
"hold A down and waggle the stick" as the only way to move. A cursor being
pushed around *is* steering, so `pointer()` now reports active for a mouse
that has moved in the last `hoverMs` (1.5s), not only for a held press.

It lapses shortly after the cursor stops, and that is load-bearing: a cursor
parked in the middle of the screen would otherwise pin the player against it
for ever. Touch never hovers, so phones and tablets are untouched; a desktop
mouse gains the same nicety.

### When a pad misbehaves, look at the menu

The arcade menu has a **Controller test** panel on it (not a `<button>`, so
d-pad menu navigation can't land a small child on it). It shows the pad's
name and mapping, which buttons and axes are live, which keys are arriving,
and — next to all of that — what `axis()` makes of it. That last line is the
one that matters: if it moves and a game doesn't, the game is at fault; if it
stays blank while the axes change, the pad is reporting the d-pad somewhere
new and the kit needs teaching. Guessing at hardware nobody can see is how
this bug survived five games.

## Design rules for these games

- **One button.** Tap to jump, nothing else. Any new ability must map onto that.
  Daddy Smash is the exception and it goes the other way — no buttons, only
  steering. Either way the rule behind the rule holds: one thing to do, and a
  kid who mashes or flails at it is never worse off than one who doesn't.
  That last clause is load-bearing and it is easy to break by accident:
  Flappy Wings violated it twice while being written — once hovering too low
  to reach the platforms a plain jump reaches, once pinned so high it sailed
  over every star in the game — and neither was visible without measuring.
  `power-ups: wings never leave a masher worse off than a jump` is the guard.
- **No fail states.** Nothing kills the player, ever. There's no game over in
  Oliver Run by design — hitting a big obstacle just slows you briefly. Reward
  and spectacle instead of punishment. Don't add lives or death.
- **Readable without reading.** Icons over words on anything a kid touches.
- Kid-facing controls and adult-facing controls live on **opposite sides** of the
  screen so small hands don't hit the wrong one.
- Keep the pace gentle. Speed ramps are tuned slow on purpose.

## The clamp bug, which shipped twice

Both of these were live on the public site, in the game with **no fail state**:

```js
waitLeft = Math.max(18, waitLeft - CUT);          // wiggle: meant to shorten
reelProg = Math.min(reelProg + BOOST, cap);       // tap: meant to speed up
```

Each is a clamp that pushes the value the **wrong way** once it is already past
the bound. A wait already under 18 got put *back up* to 18, so a child tapping
faster than once every 18 frames reset the timer for ever and never got a bite
at all. Reel progress already past the cap got pulled *back* to it, holding a
fish short of the boat for ever. Both soft-locked the game, and both did it to
whoever tapped hardest — the exact opposite of "mashing is always rewarded".

Neither was visible by playing at a normal speed, and both survived a full test
suite, because every existing test happened to tap every 10 frames. The guard is
`fishing: mashing catches more, at every possible tapping speed`, which sweeps
every cadence from one tap a frame to one every 40 and asserts the catch count
rises as tapping gets faster. **When you write a clamp, clamp the delta, not the
total** — and if a rule says "faster is better", test the whole range, not one
convenient speed.

## A button can pass "never worse" and still do nothing

The clamp bug above is a button that made things *worse*. Star Wings shipped
its first draft with the opposite failure, and it is harder to see: a button
that was neither better nor worse, because it was **saturated**.

The rocket's gun fired on a clock at five shots a second, and a tap added a
shot on top. That looked right, and the "mashing is never worse" rule was
satisfied. But waves arrive on a fixed spawn clock, and the automatic gun
alone was already killing everything that crossed the rocket's line — so
extra bullets had nothing left to hit. Measured across five seeds and every
cadence from one tap a frame to one every forty, **the score was flat**.
Mashing every single frame scored no better than never touching the screen.
The button was decoration and no test would have noticed, because nothing
regressed and nothing threw.

Two things came out of it, both worth reusing:

- **A resource the player spends has to be scarce, or spending it faster
  buys nothing.** The fix was to slow the automatic gun to a floor (a
  "you're always doing something" rate) and make a tap worth half the gap.
  Same rule, ten times the range.
- **Measure the thing the button actually drives, not the headline score.**
  Zaps are spawn-limited, so they saturate no matter what. Boss fights are
  not — there is no clock, only damage — so `wings: mashing shoots more`
  asserts on *frames spent in boss fights*, which falls five to one across
  the range and cannot be faked. The score is still checked, but only for
  "never worse", with a stated tolerance and a named reason: killing a
  critter before it shoots removes a slow bubble that was itself worth a zap
  to pop, so a masher clears a fractionally quieter sky.

If a game gains a button, ask what would happen if a child held it down for
ever, and then go and measure it rather than reasoning about it.

## A debounced save can starve for ever

`saveBest()` in every game defers the storage write so a burst of score changes
costs one write. In Oliver Run and Daddy Smash the events are seconds apart and
a plain debounce — `clearTimeout` then re-arm — is fine. In Tower Climb a floor
is gained roughly every forty frames, so the re-arm always beat the 1200ms
timer and **the write never happened at all**: a run that climbed to floor 138
saved 120, and closing the tab mid-climb lost the lot.

Throttle instead of debouncing when the thing being saved can change faster
than the delay: if a timer is already pending, leave it alone. The first change
then always lands within the delay, and a burst still costs one write. Treasure
Boat throttles for the same reason — gold moves every few frames when the net
is being mashed. Worth checking the other three if their pacing ever changes.

## A flag that is only ever cleared in one mode

Treasure Boat has two modes, sailing and ashore, and `tow` — the dolphins
pulling the boat along — was wound down inside `sail()`, which does not run
while somebody is standing on an island. A boat that landed *during* a tow kept
`tow` set for the rest of the game, and `tow` is one of the things that holds
the rescue off. A child who pressed nothing at all was quietly marooned on the
first island the dolphins ever took them to, and every test still passed because
nothing throws and no score goes backwards. When a game gains a second mode,
every timer and flag wants asking: who clears this in the *other* mode?

## Careful with

- **The kids' real names are in this code.** Free GitHub Pages requires a public
  repo. Don't set up public hosting or push to a public remote without asking me
  first — see the privacy table in README.md.
- Audio can't start until a real user gesture. Anything that plays a sound must
  be downstream of a tap or keypress, and must go through `KidKit.audio`.
- Emsile's name spelling is unconfirmed — leave it as-is unless I say otherwise.
