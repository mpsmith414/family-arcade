# Family Arcade — working notes

Homemade browser games for my two young kids. Oliver (older) and Emsile (little
sister) are the characters in both games. Built to be played on a phone, a
tablet, and a TV with a controller.

Three games, deliberately unlike each other. Keep it that way: a fourth should
contrast with all three rather than land in between.

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
node test/smoke.js            # all three games, a minute or two, no dependencies
node test/smoke.js powers     # only tests matching "powers"
node test/smoke.js fishing    # only the Emsile Fishing block
node test/smoke.js daddy      # only the Daddy Smash block
node test/smoke.js levels     # only the fourteen-worlds block
```

The harness draws to a no-op canvas, so it proves the game does not throw and
that the numbers add up — it says nothing about whether the art looks right.
For that, serve the folder and screenshot it in a real browser; Chromium and
Playwright are already on the box. Doing that caught two things the tests could
not: the fish book's bottom row sitting under the on-screen buttons, and every
uncaught silhouette leaking its hard-coded highlights.

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
across the element). Daddy Smash is the only caller today; the second movement
game must not grow its own copy.

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

## Careful with

- **The kids' real names are in this code.** Free GitHub Pages requires a public
  repo. Don't set up public hosting or push to a public remote without asking me
  first — see the privacy table in README.md.
- Audio can't start until a real user gesture. Anything that plays a sound must
  be downstream of a tap or keypress, and must go through `KidKit.audio`.
- Emsile's name spelling is unconfirmed — leave it as-is unless I say otherwise.
