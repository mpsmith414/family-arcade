# Daddy Smash — Play as Daddy

**Date:** 2026-07-30
**Status:** Approved, ready for implementation planning

## The ask

Make Daddy a third character you can swap to, so you can chase the kids instead
of running from them. Catching one triggers the smash set piece automatically,
exactly as it fires today.

## Why it is not just "let the player steer Daddy"

Daddy is deliberately slower than a kid: `DAD_WALK` is `0.53` against
`KID_SPEED` `0.72`. The comment above `updateDaddy()` says so outright — he
catches you by cutting corners and by lunging, **never** by out-running you.

Hand his steering to a human with nothing else changed and a player jogs round
the room behind two kids on autopilot and never touches either of them. The same
comment names that outcome the real failure state: getting smashed is the
reward, so a long dry spell is the only way this game can go wrong.

So the lunge has to fire for a human driver too. That is the substance of this
change; the rest is plumbing.

## Goals

- Daddy is a third selectable character, from the menu and from the in-game 🔁.
- Catching a kid as Daddy runs the existing set piece untouched.
- Playing as Oliver or Emsile behaves exactly as it does today.

## Non-goals

No second human player. No new set piece, no new sound, no changes to the
giggle meter, the pillow party, or the room. No change to scoring — see below.

## Constraints this design must respect

From `CLAUDE.md`, non-negotiable:

- **Daddy Smash has no buttons at all, only steering.** That is deliberate and
  by request. Anything added here must not become a button.
- **No fail states.** Nothing kills anybody, and there is no game over.
- **A kid who mashes or flails is never worse off than one who doesn't.**
- **No build step, no npm, no dependencies.** Vanilla HTML/CSS/canvas/WebAudio.
- **Storage only via `KidKit.storage`**, never `localStorage` directly.
- **Relative paths only** — the site is served from `/family-arcade/`.
- **Bump `sw.js` `CACHE`** after any game change.

## Scoring: explicitly unchanged

Playing as Daddy counts smashes on the same `slams` counter and shares the same
`daddy-smash-best` record.

This was raised and decided. The known consequence: as a kid, Best means "times
I got smashed"; as Daddy it means "kids I caught", and an adult playing Daddy
will probably set a number the kids cannot beat. That is accepted. **Do not
"fix" it during implementation by adding a second record key.**

---

## 1. Who the player is

`playerIdx` (`index.html:466`) widens from `0 | 1` to `0 | 1 | 2`, where `2` is
Daddy. `player()` returns whichever of the three is being driven.

The change that keeps the diff small: **give `daddy` a `def` object of the same
shape the kids carry**, `{ id:'daddy', name:'Daddy', face:'🧔' }`, set in
`resetCast()`. Every existing line that reads `player().def.name` or
`player().def.id` — the HUD at `index.html:533`, the storage write at `815`, the
landmark tag via `whereIsPlayer()` — then works untouched for all three.

```js
const player = () => playerIdx === 2 ? daddy : kids[playerIdx];
```

`other()` (`index.html:479`) exists solely to label the swap button. It is
replaced by a next-in-cycle helper:

```js
const nextIdx = () => (playerIdx + 1) % 3;
const atIdx   = i => i === 2 ? daddy : kids[i];
```

`player()` must stay a function, not a cached reference: `resetCast()` rebuilds
the `kids` array on every `startGame()`.

### Why an index rather than a flag

An `asDaddy` boolean alongside `playerIdx` would encode one fact in two
variables that can drift apart, and every call site becomes a conditional. A
`.controlled` flag on each entity generalises better but is a far wider diff
across a 1,650-line file for a cast of three.

---

## 2. Steering Daddy, and the auto-lunge

`updateDaddy()` (`index.html:915`) splits into a steering source and a shared
mode machine. Only the steering source knows whether a human is driving.

Everything else stays common to both: the `dizzy` branch, the `hunger` boost,
the `wind` → `lunge` sequence, the stomp footsteps, the near-miss `WHOOSH!`, and
the catch test at `index.html:984` that calls `startSmash()`.

### Target selection

The AI commits to one kid for 420–700 frames via `pickTarget()` and
`daddy.chase`, so that the little sister gets a turn even when the player parks
the controller. That logic is for a driver who is not looking at the screen.

A human is looking at the screen, so when a human drives, the lunge targets
**the nearest catchable kid** — not held, not in their post-smash `safe` window,
falling back to the nearest not-held kid. "The one I am next to" is what a
player aiming at a kid means.

`daddy.chase`, `daddy.chaseCd` and `pickTarget()` remain in use for the AI path
and are untouched.

### The lunge trigger

Unchanged in form: a catchable target within `d < 24`, `daddy.lungeCd <= 0`, and
`target.safe <= 0` moves him from `walk` into `wind`. The player steers Daddy
near a kid and he winds up and lunges on his own.

During `wind` and `lunge` the player has no steering — `wind` drifts at
`DAD_WALK*0.22` and `lunge` is committed along `daddy.lx/lz`. That is the
existing feel and it is kept: the wind-up is the tell that makes a near miss
read as a near miss.

The lunge auto-aims at the target through the existing `lerp` in the `wind`
phase.

### The hunger boost stays on for a human

`hunger` grows while nobody is caught and adds up to +34% speed. It exists to
end dry spells, and an adult who is bad at cutting corners needs it for the same
reason the AI does. Leaving it on also means the anti-dry-spell guarantee is one
mechanism, not two.

---

## 3. The set piece is untouched

`startSmash()`, `land()`, `endSmash()` and the whole grab → carry → raise →
drop → bounce → free sequence are unchanged, including the `slams` counter, the
`"<name> got smashed!"` shout, the giggle award, and the caught kid's 130-frame
`safe` head start.

One deliberate extension. At `index.html:705` the held kid wiggles harder while
the player waggles the stick, gated on `k === player()`. When the player is
Daddy no kid is the player, so the raise phase would go dead. Extend the gate so
wiggling counts when the player is **either** the held kid **or** Daddy. The
raise stays interactive from whichever side you are on.

---

## 4. Menu, swap, and storage

- **Start screen:** a third `🧔 Daddy` pick button beside Oliver and Emsile.
  `pickKid(i)` widens to three and sets `aria-pressed` across all three.
- **The 🔁 button:** cycles `Oliver → Emsile → Daddy → Oliver`. Its face shows
  who you would become next. It is still X/Y on a pad via `onAction`.
- **Storage:** the existing `daddy-smash-kid` key now also accepts `'daddy'`.
  Values saved by the current build still load. The lookup at `index.html:477`
  widens to search all three ids and still falls back to Oliver on anything
  unrecognised.
- **Subtitle:** the start screen currently reads "Run away from Daddy!", which
  is now only half true. It needs to cover both sides.

### `startGame()`

`daddy.prefer = playerIdx` (`index.html:843`) means "he comes for the player
first" and is meaningless when the player *is* Daddy. When `playerIdx === 2` it
falls back to `0`.

### Swapping mid-set-piece is deliberately not special-cased

Swap to Daddy while he is carrying a kid, or while he is dizzy, and you take
over a character on rails and get control when it ends. This already happens
today if you swap to the kid currently being carried — `updateKid()` returns
early on `k.held`. Consistency beats a new rule, and blocking the swap would be
invisible to a child and read as a broken button.

---

## 5. HUD and the ring

- `kidTag` shows `Daddy` — free, via the `def` object.
- `whereIsPlayer()` follows Daddy round the landmarks — free, `player()` is
  already the only input.
- The pulsing yellow "this is you" ring is drawn in `drawKid()`
  (`index.html:1554`). `drawDaddy()` needs the same ring when the player is
  Daddy, or you lose yourself the moment you swap.
- The kid footstep patter at `index.html:894` is gated on `k === player()`, so
  it falls silent when you are Daddy. That is correct — Daddy already has his
  own heavier `sfx.stomp()`.

### Daddy gets the little hop too

`press()` (`index.html:776`) gives the player kid a hop on a tap. Daddy gets the
same, because it is three lines: `hop:0` in the `resetCast()` daddy literal, a
decrement beside the other timers in `updateDaddy()`, and the sine offset
`drawKid()` already uses at `index.html:1520` applied in `drawDaddy()`.

**`hop:0` in the literal is required, not cosmetic.** `press()` tests
`p.hop <= 0`, and `undefined <= 0` is `false`, so without the field a tap while
playing as Daddy would silently do nothing and look like a dead button.

---

## 6. What must not change

The existing Daddy Smash tests are the regression guard. They must pass
untouched — not adjusted to fit the new code — with exactly one exception,
below:

- boots to the menu with nobody smashed
- starts and gets smashed from touch, keyboard, and gamepad
- steering with held arrows, WASD, stick, d-pad, and a finger
- letting go of a key really lets go
- near misses fill the giggle meter without anybody being caught
- both kids get smashed, not just the one you drive
- the pillow party arrives, then packs itself away
- best smash count and kid choice survive a reload
- 20,000 frames idle, and 20,000 frames running

Playing as a kid must be identical, because that is the game the children
actually play.

### The one test that must change, and why

`daddy: swapping which kid you are` (`test/smoke.js:1141`) asserts
Oliver → X → Emsile → 🔁 → **Oliver**. Under a three-way cycle the second swap
lands on Daddy, so this test fails by design, not by accident.

Update it to walk the full cycle — Oliver → Emsile → Daddy → Oliver — keeping
its existing shape: one swap by gamepad X, one by clicking `swapBtn`, and the
closing assertion that the chase carries on and `slams` still climbs afterwards.

This is the only permitted edit to an existing test. Any *other* daddy test that
starts failing is a defect in the change, not a test that needs updating.

---

## 7. New tests

In the daddy block of `test/smoke.js`, using the existing harness API
(`h.click`, `h.text`, `h.num`, `h.store`, `h.stick`, `h.keyDown`/`keyUp`,
`h.reload`):

1. **Catching as Daddy fires the smash.** Pick Daddy, steer at a kid, and
   `slams` increments and the shout names a kid.
2. **The auto-lunge fires with no button pressed.** A run driven only by
   steering — never `h.tap()` — still lands catches.
3. **Picking Daddy survives a reload.** `kidTag` reads `Daddy` and
   `h.store['daddy-smash-kid'] === 'daddy'` before and after `h.reload()`.
4. **The 🔁 button cycles all three**, Oliver → Emsile → Daddy → Oliver, read
   off `kidTag`.
5. **20,000 frames as Daddy never throws**, matching the existing endurance
   tests for the other two characters.
6. **Neither kid is left uncontrolled.** Over a long run as Daddy, both kids get
   caught — proving both are on autopilot and fleeing, not standing still.

## 8. Rollout

1. Bump `sw.js` `CACHE` to `arcade-v7`. Skipping this means phones keep serving
   v6 and it looks like nothing shipped — `CLAUDE.md` calls this the number one
   time sink.
2. `node test/smoke.js` green in full.
3. Push to `main`; GitHub Pages rebuilds in about a minute.

Then the check no harness can make: whether chasing actually feels like the
chase, and whether a five-year-old can catch anybody at all.

## Risks

| Risk | Mitigation |
|---|---|
| A human Daddy can never catch anyone | Auto-lunge on the AI's own trigger, plus the hunger boost; test 2 asserts catches from steering alone |
| Playing as a kid quietly changes | Five existing tests must pass unmodified |
| `player()` returning Daddy breaks a kid-only assumption | Audit all 19 `player()` / `playerIdx` sites in `index.html`; the non-obvious ones are called out in sections 1, 3, 4 and 5 |
| Losing track of which character is yours | The ring, drawn under Daddy too |
| Stale `kids` reference after `resetCast()` | `player()` stays a function, never a cached entity |

## Acceptance criteria

1. Daddy can be chosen on the start screen and reached by cycling 🔁 in play.
2. Steering Daddy into a kid catches them with no button press of any kind.
3. A catch as Daddy runs the existing set piece and increments `slams`.
4. Both kids flee on autopilot while you are Daddy, and both get caught over a
   long run.
5. The choice of Daddy survives a reload.
6. The "this is you" ring is drawn under whichever of the three you are driving.
7. Scoring and the `daddy-smash-best` record are unchanged.
8. `node test/smoke.js` passes in full, with `daddy: swapping which kid you are`
   as the only existing test edited.
9. `sw.js` `CACHE` is `arcade-v7`.
