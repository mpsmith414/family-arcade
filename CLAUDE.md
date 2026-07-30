# Family Arcade — working notes

Homemade browser games for my two young kids. Oliver (older) and Emsile (little
sister) are the characters in `games/oliver-run`. Built to be played on a phone,
a tablet, and a TV with a controller.

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
node test/smoke.js            # ~8s, no dependencies
node test/smoke.js powers     # only tests matching "powers"
```

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
```

Feel values for the sky lane and the glide all live in the `TUNE` object at the
top of `games/oliver-run/index.html`. Change those rather than hunting through
the game loop. Anything sky-lane related must draw from `skyRnd`, never
`Math.random()` — the ground-lane regression test asserts an exact fingerprint
of the `Math.random()` stream, and one stray draw on the render path breaks it.
That test is what proves the younger child's game is untouched by everything
added above it, so treat a failure there as a real defect, never a flaky test.

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

Gamepad mapping is deliberate: **almost every button jumps**, because a
five-year-old shouldn't have to find the right one. Only X/Y are a separate
action. Don't "fix" this by narrowing it.

## Design rules for these games

- **One button.** Tap to jump, nothing else. Any new ability must map onto that.
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
