# Oliver Run — The High Road

**Date:** 2026-07-29
**Status:** Approved, ready for implementation planning
**Slice:** A of three (A: the high road · B: things to chase · C: Sky Run mode)

## The problem

Oliver is almost six. The game is fun for him but not challenging, and it is
going stale.

The cause is measurable. Run speed is
`Math.min(7.0, 4.2 + dist/5000)` — it climbs from 4.2 to a hard ceiling of 7.0
and then stops forever. At an average of ~5.6px/frame that ceiling arrives
after roughly 2,500 frames, about **42 seconds into a run**. After 42 seconds
the game cannot get any harder no matter how well he plays. There is nothing
left to master.

The obvious fix — make it harder — is blocked by a design rule that matters
more: nothing may ever kill the player, and the pace is gentle on purpose,
because Emsile plays this game too and she is three years younger.

## Goals

- Give Oliver a skill ceiling that he can keep climbing.
- Leave Emsile's experience **provably** identical.
- Deliver the "flying" he asked for, without a second button.
- Stay inside every hard constraint in `CLAUDE.md`.

## Non-goals

Unlock tracks, collectible trophies and persistent progress are slice B. A
separate flying mode is slice C. No new enemies, no new power-ups beyond the
glide, no changes to any boss.

## Constraints this design must respect

From `CLAUDE.md`, non-negotiable:

- **One button.** Any new ability maps onto the existing single input.
- **No fail states.** Nothing kills the player. No lives, no game over.
- **No build step, no npm, no dependencies.** Vanilla HTML/CSS/canvas/WebAudio.
- **`shared/kidkit.js` stays ES5-safe** — it loads on old smart-TV browsers.
- **Storage only via `KidKit.storage`**, never `localStorage` directly.
- **Relative paths only** — the site is served from a subpath.
- **Bump `sw.js` `CACHE`** after any game change.

## The shape of the answer

Two routes through the same level. The ground lane is exactly what exists
today: tap, smash, nothing can hurt you. Above it sits an optional sky lane
carrying the big rewards, reachable only by precise jumping. Oliver gets a
ceiling; Emsile never has to look up.

---

## 1. Teach KidKit what "held" means

`KidKit.input.create()` currently returns `{poll, padCount, lastSource}` and the
input layer registers **no release events whatsoever** — the only `pointerup`
and `keyup` handlers in the file belong to the audio unlock and the kid lock.
Every input is edge-only. "Hold" does not exist as a concept anywhere in the
arcade.

Hold belongs in the kit, not the game: `CLAUDE.md` states the kit owns input,
and that a second copy of a kit responsibility inside a game is the wrong
answer.

### Changes

Add to `KidKit.input.create()`:

- `pointerup` / `pointercancel` / `pointerleave` on the element
- `keyup` on the window, tracking a set of currently-down keys
- released-edge detection in the existing gamepad `poll()` loop
- a `blur` handler on the window that force-releases everything

New public surface, purely additive:

```js
const pads = KidKit.input.create({
  onPress: () => jump(),
  onHold:  (down, source) => { holding = down; },   // new
});
pads.held;   // new: true while any input is down
```

### Requirements

- **ES5 only.** No arrow functions, no `const`/`let`, no `Set`. Use an object
  as a key map, as the existing `padState` does.
- **Purely additive.** A game that passes no `onHold` and never reads `.held`
  must behave byte-identically to today. Oliver Run's current behaviour is the
  regression case.
- **The blur case is mandatory, not a nicety.** If the window loses focus
  mid-hold the release event never arrives and Oliver glides forever. Alt-tab,
  a notification, or the phone locking all trigger this.
- **Held is the union of all sources.** Keyboard, touch and gamepad each track
  independently; `.held` is true if any of them is down. Releasing one key while
  another is still down must not clear the hold.
- Bump `KidKit.version` to `1.1.0`.

---

## 2. Glide

While the button is held **and** Oliver is falling (`hero.vy > 0`) **and** he is
not grounded, clamp descent to a slow float. It can never gain height.

That last property is the whole design. Reaching a platform stays entirely a
matter of nailing the jump; the glide only buys hang time to line up the next
one. It is also the reason there is no fuel meter, nothing to manage, and
nothing to run out of — "hold to float" is the entire explanation a
five-year-old needs.

### Interactions with what already exists

| System | Behaviour |
|---|---|
| Rocket Boots (double jump) | Unchanged. Glide works out of the second jump. |
| Tiny / Giant (`hero.sc`) | Unchanged. Glide is velocity-only, not size-dependent. |
| Riding the dog | Glide **and** platform landing both inactive. `heroBase()` is already overridden to the dog's back; keeping two base-height overrides from compounding is worth more than covering this edge case. You can still jump off the dog as today. |
| Coyote time / jump buffer | Untouched. Glide only affects descent velocity. |
| Sister's replay trail | Already records `hero.y` per frame, so she copies the float for free. Add a `glide` flag to trail entries **only** so her cape animates. |

### Requirements

- Gliding must not affect horizontal speed, score, or the SUPER meter.
- The cape spreads visually while gliding so the state is obvious without text.
- Holding the button while grounded does nothing at all (no charge, no effect).

---

## 3. The sky lane

A new `platforms` array, spawned and scrolled exactly like the existing
`structs`.

### Why two tiers, and why these heights

Every level is tuned to the same jump apex, which makes one set of heights work
everywhere:

| Level | gravity | jump | apex |
|---|---|---|---|
| Rooftop City | .70 | -14.6 | 152.3px |
| Dino Jungle | .70 | -14.6 | 152.3px |
| Space Station | .70 | -14.6 | 152.3px |
| Coral Reef | .55 | -12.9 | 151.3px |

The underwater level reaches the same height with different gravity, so this is
deliberate tuning, not a coincidence — and the sky lane can rely on it.

- **Tier 1** top surface at `GROUND - 130` — reachable from the ground with 22px
  of margin.
- **Tier 2** top surface at `GROUND - 260` — reachable only from tier 1, again
  with 22px.

Both heights refer to the **top surface** of the platform, which is the line the
landing test uses.

Two hops to the top *is* the difficulty. Power-ups make it easier, which is a
pleasant synergy that falls out for free: Tiny raises the apex to 184px, Giant
to 171px, Rocket Boots to 191px.

### The one invasive change

Today `heroBase()` returns a constant (`GROUND`, or `GROUND - RIDE_H` on the
dog) and landing is a single `hero.y >= base` test. One-way platforms make this
dynamic:

- If Oliver is **falling** and his **feet** cross a platform's top edge while
  horizontally overlapping it, he lands on it.
- Rising through a platform from below never collides — one-way, always.
- When the platform he is standing on scrolls off, he falls. This costs nothing.

**The collision test must use foot position, not the body box.** One of the two
bugs `CLAUDE.md` remembers was a hitbox that stretched to the ground while
jumping; this is the same failure mode waiting to happen again, and `hero.sc`
scaling under Giant/Tiny makes it easier to get wrong.

This is the riskiest change in the slice and the only place existing physics is
rewritten rather than extended.

### Rules that keep it gentle

- Platforms spawn **only during the `run` phase** — never during `warn` or a
  boss fight, so they cannot tangle with the air bosses' flight paths.
- A consequence worth stating outright: **Boss Rush never has a sky lane**, because
  that mode only ever cycles `warn → boss → victory` and has no `run` phase.
  This is intended — Boss Rush is already the high-intensity mode and adding
  platforms to it would fight the boss patterns.
- They arrive in **clusters** of 2–4 with clear stretches of plain ground
  running between them, rather than a continuous ceiling.
- The first cluster of a `run` phase is delayed (`firstCluster`, default 480
  frames) so a run always opens on plain ground.
- **Falling off costs nothing.** You land on the ground lane and carry on.

---

## 4. Bigger, shinier stars

Gold stars spawn only on the sky lane, and are the reason to go up there.

- Visibly larger than a normal star, with a sparkle ring and a rainbow shimmer,
  so the draw is obvious from the ground lane.
- Worth 5× a normal star (`goldPoints` 50 vs 10).
- They charge SUPER faster. This is **not** a new system: `addCharge(2)` already
  fires on every star pickup, so a gold star passes a bigger number. More SUPER
  means more confetti, which is the reward loop the game already runs on.

---

## 5. Proving Emsile's game did not change

### The separate-PRNG decision

If platform spawning drew from `Math.random()` it would shift the entire RNG
stream, and every seeded run would diverge — obstacle placement, star heights,
boss order, all of it. Existing behaviour would still be correct but
unverifiable.

So **all sky-lane randomness uses its own PRNG instance**, seeded separately,
via the `rnd(seed)` helper the backdrop generators already use. The
`Math.random()` stream stays untouched.

This constrains the drawing code too: platform and gold-star rendering must
derive any shimmer or sparkle from the frame counter `t`, **never** from
`Math.random()`, or the guarantee breaks on the render path.

### The regression guarantee

> A run with no jump and no hold input consumes an **identical**
> `Math.random()` sequence before and after this change, and therefore produces
> an identical score, level order and boss order.

Stated precisely: with no jump input Oliver never leaves the ground, so he never
touches a platform, never collects a gold star, and never triggers the `burst()`
call that would perturb the stream. The baseline must be captured from the
current build **before** any code changes.

### Harness work

`h.holdJump()` presses and releases on a cadence, which is the opposite of a
sustained hold. Add `h.hold(true/false)` for a genuine held input.

### New tests

- Glide slows descent, and **never** increases height.
- Landing works on tier 1 from the ground, and on tier 2 only from tier 1.
- Gold stars are unreachable without using a platform.
- No platforms exist during `warn` or boss phases.
- Losing window focus mid-hold releases the glide.
- Glide is inactive while riding the dog.
- The existing 20,000-frame endurance run still completes clean.
- **The regression guarantee above, as an exact equality.**

---

## 6. Tuning and rollout

Every number affecting feel goes in a single `TUNE` object at the top of the
game, so tuning is one line at a time with Oliver watching, not a hunt through
2,400 lines.

These are starting values, chosen to be adjusted rather than defended:

| Key | Default | Meaning |
|---|---|---|
| `glideVyMax` | `2.4` | Max descent px/frame while held. Turns a 21-frame fall from apex into ~63 frames of float. |
| `tier1Y` | `GROUND - 130` | Tier 1 top surface. |
| `tier2Y` | `GROUND - 260` | Tier 2 top surface. |
| `platWidth` | `90..160` | Platform width range. |
| `clusterSize` | `2..4` | Platforms per cluster. |
| `clusterGap` | `420..780` | Frames of plain ground running between clusters. |
| `firstCluster` | `480` | Frames into a `run` phase before the first cluster can spawn. |
| `goldPoints` | `50` | vs `10` for a normal star. |
| `goldCharge` | `5` | vs `2` for a normal star. |
| `goldPerCluster` | `1..3` | Gold stars distributed across a cluster. |

Every range above is drawn from the sky-lane PRNG, never `Math.random()`.

Rollout order:

1. Bump `KidKit.version` to `1.1.0`.
2. Bump `sw.js` `CACHE` to `arcade-v2`. **Skipping this means phones keep
   serving v1 and it looks like nothing shipped** — `CLAUDE.md` calls this the
   number one time sink.
3. Push; GitHub Pages rebuilds in about 20 seconds.

Then the checks no harness can make: that holding a finger on a phone screen
feels right, that hold works on the TV gamepad, and above all whether Oliver
reaches for the sky lane without being told it exists.

## Risks

| Risk | Mitigation |
|---|---|
| Dynamic `heroBase()` breaks ground-lane feel | Exact-equality regression test, captured before any change |
| Foot-vs-body hitbox bug returns | Explicit foot-position test; harness coverage under Giant and Tiny |
| Glide feels bad to a 6-year-old | Single `TUNE` value; nothing else depends on the rate |
| Platforms clutter the screen for Emsile | Clusters with gaps, ramp-in delay, none during boss phases |
| Stuck glide after focus loss | Mandatory `blur` force-release, with a test |

## Acceptance criteria

1. Holding any input — touch, key or gamepad — makes Oliver float while falling.
2. Floating never gains height.
3. Tier 1 is reachable from the ground; tier 2 only from tier 1.
4. Gold stars exist only on the sky lane and are worth ~5× a normal star.
5. Falling from any height causes no penalty of any kind.
6. No platforms appear during `warn` or boss phases.
7. A no-input run scores identically to the pre-change build.
8. `node test/smoke.js` passes in full, including the new tests.
9. `KidKit.version` is 1.1.0 and `sw.js` `CACHE` is `arcade-v2`.
