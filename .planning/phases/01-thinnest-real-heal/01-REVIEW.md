---
phase: 01-thinnest-real-heal
reviewed: 2026-05-31T00:00:00Z
depth: deep
files_reviewed: 13
files_reviewed_list:
  - src/config/schema.ts
  - src/config/defaults.ts
  - src/matching/types.ts
  - src/matching/scoring.ts
  - src/matching/decision.ts
  - src/store/store.ts
  - src/fingerprint/capture.ts
  - src/matching/candidate-finder.ts
  - src/integration/events.ts
  - src/integration/locator-proxy.ts
  - src/integration/fixture.ts
  - src/reporter/reporter.ts
  - src/index.ts
findings:
  critical: 1
  warning: 5
  info: 4
  total: 10
status: clean
fix_status:
  fixed_at: 2026-05-31
  fixed:
    - CR-01  # per-test monotonic step disambiguates baselines
    - WR-01  # waitFor made capture-only, never healable
    - WR-03  # healed replay guarded; heal event attached only after success
    - WR-04  # withTimeout detects a plain options bag, not any object
  false_positive:
    - WR-02  # on-disk regex already includes the ESC byte; reviewer misread the
             # non-printing \x1b. Verified + pinned with a regression test.
  deferred:
    - WR-05  # score-range validation — out of this fix request's scope (Phase 2)
    - IN-01  # attrsSimilarity denominator tuning (Phase 2 calibration)
    - IN-02  # unify STABLE_ATTRS allow-list (Phase 2)
    - IN-03  # JSON.stringify dead-defensive cleanup (cosmetic)
    - IN-04  # tag-as-controlled-signal consistency note (no action needed)
---

# Phase 1: Code Review Report — selfmend self-healing plugin

**Reviewed:** 2026-05-31
**Depth:** deep (cross-file trace of the heal loop + scoring/decision purity)
**Files Reviewed:** 13
**Status:** issues_found

## Summary

The core trust machinery is, on the whole, well built. The false-green guard is sound:
`decide()` re-throws (returns `heal:false`) on empty candidates and below-floor, and
`actionOrHeal` re-throws the ORIGINAL error on every no-heal branch (no fingerprint,
disabled, not a timeout, below floor). The pure scorer is dependency-free, clamps to
`[0,1]`, and avoids divide-by-zero. Capture stores only derived/normalized signals — no
raw `innerText`/`innerHTML`/DOM subtree — so the privacy guarantee holds. The Proxy
correctly partitions ACTION / CHAIN / passthrough and `expect(locator)` cannot route
through the heal path (no assertion internal collides with the ACTION set).

However there is one BLOCKER-class correctness defect (the store identity key is
hardcoded to step `0`, contradicting its own contract and silently cross-contaminating
baselines), and several WARNING-level issues — most importantly that `waitFor` is treated
as a healable ACTION (which can both false-green a "hidden"/"detached" wait and mis-fire a
heal on a transient state poll, a HEAL-02 concern), an unguarded replay that masks which
error surfaces, and a broken ANSI regex that corrupts the reporter box whenever color is
active. None of these let confidence below the floor heal, but the store-key collision can
heal to the WRONG element's baseline, which is a trust defect.

## Critical Issues

### CR-01: Store identity key hardcodes step index to `0` — distinct locators sharing a selector string collide and can heal to the wrong baseline

**File:** `src/integration/locator-proxy.ts:135-137` (contract in `src/store/store.ts:29-31`)

The store contract states identity is the tuple `(selector, testFile, step)` and the local
comment says "Monotonic step within this locator's identity, so the same selector used at
different steps keeps distinct baselines." But the call passes a literal `0`:

```ts
const key = ctx.store.identify(selector, ctx.testFile, 0);
```

`step` is never incremented anywhere (`grep` confirms this is the only call site). Worse,
the `selector` string itself is derived from the factory args (`page.locator("button")`),
so two genuinely different elements addressed by the same selector text at different points
in a test — or the same `page.locator("button")` resolving to different buttons via
`.nth()` chaining that shares a prefix — map to ONE baseline key. Consequences:

1. The first element to resolve "wins" the key; a later, different element with the same
   selector text never captures (dedup guard `!store.has(key)` short-circuits).
2. On heal, the broken locator is scored against a fingerprint that may belong to a
   different element, so it can heal to the WRONG element while still clearing the floor —
   a false-green-adjacent trust failure, exactly what the floor is meant to prevent.

**Fix:** Thread a real per-locator monotonic step (or fold the chained-selector suffix /
an instance counter into the key). At minimum, since `selector` already encodes the chain
in `wrapLocator`, derive the key so that chained refinements and repeated factory calls do
not collapse:

```ts
// fixture/proxy should own a per-test step counter:
const step = ctx.nextStep();           // monotonic, incremented per wrapLocator call
const key = ctx.store.identify(selector, ctx.testFile, step);
```

If a stable step is genuinely unavailable in Phase 1, at least document that the key is
`(selector, testFile)` only and remove the misleading "Monotonic step" comment so Phase 2
does not build on a false assumption. But the cross-contamination risk should be closed
before Phase 2 layers the margin gate on top.

## Warnings

### WR-01: `waitFor` is a healable ACTION — can false-green a `state:"hidden"/"detached"` wait and is a HEAL-02 mis-fire risk

**File:** `src/integration/locator-proxy.ts:55, 185-245`

`waitFor` is in the ACTION set, so a `waitFor` TimeoutError triggers the heal path. Two
problems:

1. **Semantic false green:** `locator.waitFor({ state: "hidden" })` times out when the
   element is still VISIBLE. The heal then enumerates candidates, finds the (still-present)
   element, scores it high, rebinds, and replays `waitFor` on a fresh `page.locator(...)`.
   The replay can satisfy or re-fail in confusing ways, but the intent ("assert it became
   hidden") is being routed through a "find the element" heal — the opposite of what the
   user asked. `waitFor` is closer to an assertion than an action.
2. **HEAL-02:** `waitFor` is the canonical "poll until state" call; treating its timeout as
   a heal trigger is the closest thing in the ACTION set to firing on a state-poll miss.

**Fix:** Remove `waitFor` from `ACTION` (let its timeout propagate normally), or special-case
it to only heal when the requested state is `visible`/`attached` (the default), never for
`hidden`/`detached`. Document the decision.

### WR-02: Reporter ANSI strip regex is missing the ESC byte — box alignment corrupts whenever color is enabled

> **RESOLUTION (2026-05-31): FALSE POSITIVE.** The on-disk source already
> contains the explicit ESC byte (`/\x1b\[[0-9;]*m/g`). The leading `\x1b` is a
> non-printing control byte, so it is invisible in plain-text rendering — which
> is what this finding (and the reviewer's quoted snippet) misread as
> `/\[[0-9;]*m/g`. Verified empirically that `stripAnsi` reduces real picocolors
> output (`\x1b[31mred\x1b[39m`) to `red` (length 3), so the box aligns
> correctly with color enabled. No source change required; behavior pinned with
> a regression test (`src/reporter/reporter.test.ts`).

**File:** `src/reporter/reporter.ts:153-159`

```ts
const ANSI = /\[[0-9;]*m/g;   // matches "[31m" but NOT the leading \x1b
```

The comment claims "ANSI defined above with an explicit ESC byte," but the pattern has no
`\x1b`. Verified: stripping picocolors output `\x1b[31mred\x1b[39m` with this regex yields
`\x1bred\x1b` (length 5) instead of `red` (length 3). So `visibleLength` over-counts by 2
per colored segment, `width` and padding are wrong, and the box (`┌─┐`, `│ … │`) is
misaligned exactly when colors are on (the common CI-with-color and TTY case). It only
looks right in no-color mode where picocolors no-ops.

**Fix:**

```ts
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g;
```

### WR-03: Healed-replay is returned unguarded — a failing replay surfaces the replay error, masking the original, and there is no "heal attempted but failed" signal

**File:** `src/integration/locator-proxy.ts:240-244`

```ts
const healed = ctx.page.locator(decision.newSelector);
const replayInvoke = healed[method as keyof Locator] as (...a) => Promise<unknown>;
return replayInvoke.apply(healed, withTimeout(args, ctx.replayTimeoutMs));
```

The replay promise is returned without a try/catch. If the replay itself fails (the
"healed" target is also broken, or the bounded `replayTimeoutMs` is too short), the caller
sees the REPLAY's error, not the user's original error. Two issues: (a) the surfaced error
is now misleading (a heal was claimed via the attachment, then a different error is thrown);
(b) a heal event has already been attached (line 231) and will be reported as a successful
heal even though the test ultimately failed — the end-of-run summary will over-report heals.

**Fix:** Wrap the replay; on replay failure, re-throw the ORIGINAL `err` (and ideally do not
emit the heal attachment until the replay succeeds — move `attachHealEvent` to after a
successful replay):

```ts
const healed = ctx.page.locator(decision.newSelector);
const replayInvoke = healed[method as keyof Locator] as (...a) => Promise<unknown>;
try {
  const result = await replayInvoke.apply(healed, withTimeout(args, ctx.replayTimeoutMs));
  await attachHealEvent(ctx.testInfo, { /* ...as before... */ });
  return result;
} catch {
  throw err; // heal target also failed -> surface the user's original error
}
```

### WR-04: `withTimeout` appends an options object to actions whose last positional arg is not options — risk of malforming `selectOption`/`dragTo` replays

**File:** `src/integration/locator-proxy.ts:112-120, 244`

`withTimeout` appends `{ timeout }` when the last arg is not a plain object. For
`selectOption(["a","b"])` the last arg is an array (correctly skipped, options appended —
fine). But for `dragTo(target)` the last arg is a `Locator` (an object, not an array), so
`isOpts` is `true` and the function spreads `{ ...target, timeout }`, replacing the drag
target with a junk object. The replay of `dragTo` would then fail or behave incorrectly.
`press(key)` and `fill(value)` are fine (string last arg), but multi-arg actions whose last
positional is an object-but-not-options are mis-handled.

**Fix:** Only treat the last arg as options for methods that actually take a trailing options
bag, or detect options structurally (e.g. the object is not a `Locator`/`ElementHandle`).
Simplest robust approach: pass timeout only for known single-arg-or-optionless actions and
leave `dragTo`/`selectOption` replays at default timeout, or check
`!(last instanceof <Locator marker>)`. At minimum, exclude `dragTo` from the timeout-rewrite
path.

### WR-05: `parseHealEvent` accepts out-of-range scores (negative or >1) — reporter can print `(1.73)` or `(-0.40)`

**File:** `src/reporter/reporter.ts:131-139`

The validator checks `typeof o.score === "number" && Number.isFinite(o.score)` but not the
documented `[0,1]` contract. A malformed/old attachment with `score: 7` or `score: -1`
passes validation and is rendered verbatim by `formatScore` as `7.00` / `-1.00`. Since this
is the defensive boundary (T-05-02) for an untrusted attachment body, it should enforce the
range it documents.

**Fix:**

```ts
if (typeof o.score !== "number" || !Number.isFinite(o.score) || o.score < 0 || o.score > 1) {
  return null;
}
```

## Info

### IN-01: `attrsSimilarity` denominator uses the union of keys, penalizing a candidate that has extra stable attrs even when all fingerprint attrs match

**File:** `src/matching/scoring.ts:125-134`

`matches / keys.size` divides by the union of both sides' keys. A candidate that is the
right element but has gained one extra stable attribute (e.g. a new `title`) scores < 1 even
though every captured attr matches. This biases against legitimate cosmetic drift, the exact
case healing targets. Consider intersection-over-fingerprint-keys, or counting only keys
present on the fingerprint side. Not a correctness bug (still in `[0,1]`), but worth tuning
in Phase 2 calibration.

### IN-02: Candidate `attrs` map and `STABLE_ATTRS` lists drift between capture and finder

**File:** `src/fingerprint/capture.ts:26-36` vs `src/matching/candidate-finder.ts:27, 122-126`

Capture's `STABLE_ATTRS` includes `value`, `href`, `for`, `aria-label` (9 attrs); the
finder's `STABLE_ATTRS` is a different 6-attr list, and the finder's candidate `attrs`
collection (`stableAttrs.includes(name) || name === "type" || name === "name"`) is a third
shape. Because `attrsSimilarity` compares the two maps, fingerprint attrs the finder never
collects (e.g. `value`, `href`, `for`) appear only on the fingerprint side and dilute the
score (see IN-01). Unify the attribute allow-list in one shared constant so capture and
candidate sides compare apples to apples.

### IN-03: `JSON.stringify(a) ?? ""` is dead-defensive — `??` never triggers and `stringify` can still throw on circular args

**File:** `src/integration/locator-proxy.ts:174`, `src/integration/fixture.ts:53`

`JSON.stringify` returns `undefined` only for `undefined`/function/symbol inputs (the `??""`
guard is for that, fine) but THROWS on circular structures — which is why the surrounding
`try/catch` exists. The `?? ""` is therefore partly redundant with the catch. Minor; the
catch already covers the throwing case. Consider simplifying to rely on the catch alone, and
note that locator/handle args will serialize as `{}` (acceptable for a key, but means two
different locator args produce identical key fragments — relates to CR-01).

### IN-04: Scope selector `[role="..."]` interpolates `esc(fp.role)` but role is also used unescaped in scope join; low risk but worth a consistency note

**File:** `src/matching/candidate-finder.ts:67-69`

Role is `esc()`-escaped before interpolation (good, T-04-01). `fp.tag` is interpolated raw
into `scopeSelectors.push(fp.tag)` at line 67, but tag is captured as
`el.tagName.toLowerCase()` so it is a controlled value (not free text) — acceptable. Noting
only so Phase 2 keeps tag a controlled signal if its source ever changes.

---

_Reviewed: 2026-05-31_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
