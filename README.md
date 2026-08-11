# Family Arcade

Homemade games for the kids. Plain HTML/JS — no build step, no npm, no server code.
Runs in any modern browser, installs to a home screen, and works offline.

```
index.html                       the arcade menu
manifest.webmanifest             app name / icon / fullscreen landscape
sw.js                            offline cache  (bump CACHE when you change a game)
shared/kidkit.js                 reusable: storage, input+gamepad, audio, music, kid lock
games/oliver-run/index.html      game one — fast one-tap runner
games/emsile-fishing/index.html  game two — slow one-tap fishing, 15 creatures to collect
games/daddy-smash/index.html     game three — chase round the living room, no buttons at all
games/tower-climb/index.html     game four — climb an endless tower, steer and tap
test/harness.js, test/smoke.js   headless tests for all four  (node test/smoke.js)
icons/                           app icons
```

The four games are deliberately unlike each other. Oliver Run is fast and loud
and scores distance; Emsile Fishing is still and quiet, runs at 84 bpm instead of
132, and scores a picture book you fill in. Daddy Smash is the odd one out on
purpose: no button at all, just steering round one room while Daddy chases both
kids, and **getting caught is the reward** — he body-slams you onto the couch,
you bounce, you run off again. Tower Climb is the only one you both steer *and*
tap: a Donkey-Kong-shaped maze of floors that goes up for ever, scoring how many
you climb. Nobody loses any of them.

Tower Climb's trick is that **it cannot be failed by being bad at it**. Ladders
are escalators — walk into one and you ride it up, no button and no timing.
Springs fire the moment you stand on them, a long fall turns into a slow float
on a cloud, and the critters are trampolines rather than hazards. If seven
seconds go by without any height being gained — a child who has put the tablet
down, or one leaning on a single direction with their back to a wall — a bunch
of balloons comes and fetches them. Tapping to jump is the fast route, never the
only one. Every eight floors the tower tops out at a bell, and ringing it flies
you up into a new one.

## Putting it online

### GitHub (with GitHub Pages)

Read the privacy note below first — it matters for a game with your kids' names in it.

**No git installed? Use the website.**

1. github.com → New repository → name it `family-arcade`
2. "uploading an existing file" → drag in **the contents of this folder**
   (`index.html`, `sw.js`, `shared/`, `games/`, `icons/`, `.nojekyll`) — not the
   `arcade` folder itself, or every URL gains an extra `/arcade/`
3. Commit
4. Settings → Pages → Source: *Deploy from a branch* → `main` / `/ (root)` → Save
5. Wait a minute. Live at `https://<you>.github.io/family-arcade/`

**With git:**

```bash
cd arcade
git init -b main
git add .
git commit -m "Family arcade: Oliver Run"
git remote add origin https://github.com/<you>/family-arcade.git
git push -u origin main
```

Then do step 4 above. To update later:

```bash
git add . && git commit -m "tweak" && git push
```

Relative paths are used throughout, so the `/family-arcade/` subpath works with no
changes — service worker scope, manifest and all.

### ⚠️ Every time you push a change, bump the cache

In `sw.js`, change `const CACHE = 'arcade-v1'` to `v2`, `v3`, and so on. Skip this
and phones will keep serving the old game from cache and you'll think your fix
didn't work. This is the single most common way to waste an hour on a PWA.

### Privacy: free GitHub Pages means a public repo

On a free GitHub account, Pages only works from a **public** repository — private
repos need GitHub Pro. So the source, including the characters named after your
kids, would be publicly searchable. Three ways to handle it:

| | Source | Site URL | Cost |
|---|---|---|---|
| Public repo + GitHub Pages | public | public | free |
| **Private repo + Cloudflare Pages / Netlify** | **private** | public but unlisted | free |
| Private repo + GitHub Pages | private | public | GitHub Pro |

The middle row is usually the right answer for a family project: keep the repo
private on GitHub, then connect Cloudflare Pages or Netlify to it — both deploy
from private repos on their free tiers. You still get an HTTPS URL, but nothing
is indexed and the code isn't browsable. Cloudflare Access can put a login in
front of the site too, also free.

Note that a Pages *site* is public on every plan below Enterprise. Making the repo
private hides the source, not the URL.

## Installing as an app

- **iPhone / iPad** — open the URL in Safari → Share → Add to Home Screen
- **Android** — Chrome will prompt, or menu → Install app
- **Desktop** — install icon in the address bar

Launched from the home screen there's no address bar and no back gesture, which
is a better answer to "the kids keep closing it" than anything in-page.

## Controls

Everything is wired through `KidKit.input`, so every game gets all of these free:

| Input | Action |
|---|---|
| Tap / click | jump |
| Almost any key | jump |
| Arrow keys | menu navigation |
| Gamepad A/B/bumpers/triggers/d-pad, stick up | jump |
| Gamepad X or Y | secondary action (swaps the kids in Oliver Run, opens the fish book in Emsile Fishing, swaps which kid you are in Daddy Smash and in Tower Climb) |
| Gamepad Start | confirm in menus |

Daddy Smash and Tower Climb also need to *steer*, so they opt into the kit's
steering layer and get these on top:

| Input | Action |
|---|---|
| Hold a finger anywhere | run to it — the whole control scheme |
| Arrow keys or WASD, held | run that way |
| Left stick / d-pad, held | run that way |

In Tower Climb one finger does both jobs: hold it where you want to go and the
climber runs there, and every fresh tap is a jump. Only the finger's *side* is
read, never its height — a thumb parked at the bottom of a phone is how a small
child actually holds one, and reading that as "down" sent them back down every
ladder. Climbing down is on the keys and the stick, where it has to be asked
for on purpose.

Holding a finger down is the one to show a three-year-old: no virtual joystick to
find, no button to hit, the kid just runs to your fingertip.

A cheap Bluetooth controller paired to a Fire TV or Android TV makes this a couch
game. Apple TV has no browser at all — AirPlay from a phone instead.

### On a Fire TV, watch the cursor

Silk (and most TV browsers) draws a mouse cursor over the page and lets the left
stick shove it about. Two things follow from that, and both are handled:

- The games now fill the whole screen, so there is no dead border left for the
  cursor to sit in — a press anywhere on the page counts either way.
- If the cursor slides off the page entirely, the browser's own chrome takes the
  focus, and from that moment keys stop arriving and the gamepad reads as
  frozen. Nothing in a web page can move that cursor back, so the kit notices
  and covers the screen with **Press any button** — pressing anywhere over the
  game hands focus back, and if a controller is connected that same press takes
  the page fullscreen so there is no outside left to get lost in.

Best of all is to press 🔒 (kid lock) at the start: it goes fullscreen straight
away, and the cursor can never leave. **Steering with the d-pad rather than the
left stick also avoids the cursor entirely** — the d-pad arrives as arrow keys,
which never move it.

## Adding a game

1. `games/your-game/index.html`
2. Add `<script src="../../shared/kidkit.js"></script>` in the head
3. Copy a card in `index.html` and point `data-go` at it (and give `.art` a
   gradient of its own)
4. Add the new path to `FILES` in `sw.js` and bump `CACHE` to the next `arcade-vN`
5. `node test/smoke.js` — the harness takes any folder name under `games/`

### The bits worth reusing

```js
// saves that survive a reload, in any browser
KidKit.storage.set('best', 120);
const best = KidKit.storage.getNumber('best', 0);

// one handler for touch, keyboard, TV remote and gamepad
const pads = KidKit.input.create({
  element: document.getElementById('stage'),
  onPress:  () => jump(),
  onAction: () => doSomethingElse(),
  onNav:    dir => KidKit.input.moveFocus(dir)
});
// then call pads.poll() once per frame — that's what reads the gamepad

// add steer:true and you also get held/analogue movement
const pads = KidKit.input.create({ element: stage, steer: true, onPress: … });
pads.axis();     // {x, y, mag} from held arrows/WASD + stick + d-pad
pads.pointer();  // {active, nx, ny} — where a finger is being held, 0..1

// sound that actually starts on iPhones
KidKit.audio.tone(440, 0.12, 'square', 0.05);
KidKit.audio.noise(0.2, 0.07);

// chiptune loops: midi note numbers, -1 for a rest
const jukebox = KidKit.audio.music({
  level1: { bpm:132, wave:'square', drums:'light',
            lead:[72,-1,76,-1,79,-1,76,-1], bass:[48,48,-1,48] }
});
jukebox.play('level1');
jukebox.setEnabled(false);

// tap to lock, hold 3s to unlock
KidKit.kidLock(document.getElementById('lockBtn'), {
  onHold: pct => {},
  onChange: on => {}
});
```
