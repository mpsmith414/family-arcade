# Family Arcade — working notes

Homemade browser games for my two young kids. Oliver (older) and Emsile (little
sister) are the characters in both games. Built to be played on a phone, a
tablet, and a TV with a controller.

Three games, deliberately unlike each other. Keep it that way: a fourth should
contrast with all three rather than land in between.

- `games/oliver-run` — endless runner, tap to jump, 18 bosses, scores distance.
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
node test/smoke.js            # all three games, ~35s, no dependencies
node test/smoke.js powers     # only tests matching "powers"
node test/smoke.js fishing    # only the Emsile Fishing block
node test/smoke.js daddy      # only the Daddy Smash block
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
```

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

Gamepad mapping is deliberate: **almost every button jumps**, because a
five-year-old shouldn't have to find the right one. Only X/Y are a separate
action. Don't "fix" this by narrowing it.

## Design rules for these games

- **One button.** Tap to jump, nothing else. Any new ability must map onto that.
  Daddy Smash is the exception and it goes the other way — no buttons, only
  steering. Either way the rule behind the rule holds: one thing to do, and a
  kid who mashes or flails at it is never worse off than one who doesn't.
- **No fail states.** Nothing kills the player, ever. There's no game over in
  Oliver Run by design — hitting a big obstacle just slows you briefly. Reward
  and spectacle instead of punishment. Don't add lives or death.
- **Readable without reading.** Icons over words on anything a kid touches.
- Kid-facing controls and adult-facing controls live on **opposite sides** of the
  screen so small hands don't hit the wrong one.
- Keep the pace gentle. Speed ramps are tuned slow on purpose.

## Careful with

- **The kids' real names are in this code.** Free GitHub Pages requires a public
  repo. Don't set up public hosting or push to a public remote without asking me
  first — see the privacy table in README.md.
- Audio can't start until a real user gesture. Anything that plays a sound must
  be downstream of a tap or keypress, and must go through `KidKit.audio`.
- Emsile's name spelling is unconfirmed — leave it as-is unless I say otherwise.
