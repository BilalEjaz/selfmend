# Phase 2: Trust Hardening - Research

**Researched:** 2026-05-31
**Domain:** Pure heuristic heal-decision hardening for an offline Playwright self-healing plugin (`selfmend`)
**Confidence:** HIGH (extends well-tested, in-repo Phase 1 code; mechanics locked in CONTEXT.md; only the default margin VALUE is a calibrated [ASSUMED] starting point)

## Summary

Phase 2 hardens an already-shipping heal decision rather than designing a new one. Phase 1 left exactly the right seams: `decide(scored, floor)` already sorts candidates and already retains `runnerUpScore` in the emitted `HealEvent`, the `NoHealReason` union already reserves `"ambiguous"`, the scorer (`scoring.ts`) already normalizes a weighted sum and is structured so weights re-tune without a rewrite, and the worker→main transport (`testInfo.attach`) is the sanctioned channel the reporter reads. The work is therefore additive: add a second gate (absolute second-best margin), widen the scorer's signal set with constants that are already mostly present in the `Fingerprint`/`CandidateDescriptor` shapes, widen the attachment contract to carry refused attempts without breaking the successful-heal shape, and add a "could not heal" section to the reporter. All of `scoring.ts` and `decision.ts` stay pure (no Playwright/fs), per D-09 and the Phase 1 purity contract.

The single number requiring calibration is the default `margin`. The literature (Similo's peer-reviewed weighted-sum localizer; Healenium's production `score-cap` default of 0.5) is decisive on the *mechanism* — a separate disambiguation gate beyond an absolute floor — but does not publish an absolute-gap value, because Similo always picks the single highest scorer and Healenium gates only on absolute probability. The margin is `selfmend`'s own named guard against look-alike elements. The defensible posture given the existing conservative `0.9` floor is a **small but non-trivial default margin of `0.05`** (5 points of score, same 0..1 units), reasoned below: large enough to refuse two genuine look-alikes that score within a few points, small enough that a legitimate sole-survivor heal (which usually clears the floor with a wide gap over structural-only also-rans) is not refused.

**Primary recommendation:** Add `margin` as a second global config key (default `0.05`, validated `[0,1]` like `threshold`); change `decide(scored, floor)` to `decide(scored, { floor, margin })`; emit `reason: "ambiguous"` when `topScore >= floor` but `topScore - runnerUpScore < margin`; extend the scorer with `accessibleName`, and treat the existing `neighbourSignature`/`parentTag`/`ordinal`/`attrs`/`tag` signals as the structural tier with identity signals dominant; widen the `selfmend-heal` attachment into a tagged union (`kind: "healed" | "refused"`) so the reporter renders two sections. Build every gate test-first (vitest for the pure core, one Playwright integration test where an ambiguous duplicate must FAIL).

## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Margin gate uses an ABSOLUTE GAP: heal only if `topScore - runnerUpScore >= margin`, `margin` in 0..1 score units. (Not a ratio, not gap+ratio.)
- **D-02:** A solo candidate (no runner-up) trivially passes the margin gate and heals if it clears the floor. The margin gate only constrains the multi-candidate / look-alike case.
- **D-03:** Both gates must pass to heal: `topScore >= floor` AND `topScore - runnerUpScore >= margin`. Failing either is a no-heal with a distinct reason (`below-floor` vs `ambiguous`). Default margin VALUE left to research/planning (lean-safe); discussion locks only the mechanism.
- **D-04:** After the existing healed box, the reporter prints a SEPARATE "could not heal" section listing each refused attempt: locator, reason (`no-candidates` / `below-floor` / `ambiguous`), and best candidate score seen.
- **D-05:** Refused-heal events travel worker→reporter the same way successful heals do (`testInfo.attach`, existing transport). The heal-event/attachment contract WIDENS to carry refused attempts with reason + best score (extend, do not break, the Phase 1 `HealEvent` shape).
- **D-06:** A refused heal still lets the test fail normally (MATCH-04). The report section is additive observability, never a substitute for the failure. No false greens.
- **D-07:** Floor and margin are GLOBAL config only (set once in the plugin config, validated by zod alongside `threshold`/`enabled`/`testIdAttr`). No per-test/per-call override this phase.
- **D-08:** Naming: keep existing `threshold` key as the floor (do not rename/break Phase 1 config); add a new `margin` key. Both validated in `[0, 1]` with readable zod errors.
- **D-09:** Scoring signal weights are FIXED internal constants, calibrated by us against the literature (Similo/Healenium), documented, NOT exposed in user config. Keep the scorer structured so weights could be exposed later without a rewrite.

### Claude's Discretion
- Exact default values for `margin` and any floor recalibration.
- The specific additional signals to add for "multi-signal" scoring and their relative weights.
- The internal representation of refused-heal events.
- The precise reporter formatting of the could-not-heal section.
- Constraint on all of the above: keep `scoring.ts` and `decision.ts` pure (Playwright/fs-free) and build the new gate/weights test-first (TDD).

### Deferred Ideas (OUT OF SCOPE)
- Per-test / per-call override of floor and margin (kept global, D-07).
- Exposing signal weights in config (deferred; scorer kept structured to allow it later, D-09).
- Cross-run persistence + parallel-worker-safe store (Phase 3).
- Network-blocked offline proof + npm publish (Phase 4).

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MATCH-02 | A heal is accepted only when the top candidate clears an absolute confidence floor (hardened/proven). | Floor gate already exists in `decide()`. Phase 2 hardens it with test-first proofs (empty / below-floor) and keeps it as the first of two gates (D-03). See "Testing the Gates" + "decide() signature". |
| MATCH-03 | A heal is accepted only when the top beats the second-best by a configurable margin, preventing ambiguous matches. | New absolute-gap gate (D-01); default `0.05` calibrated below; `runnerUpScore` already retained. See "Margin Gate" + "Default Margin Calibration". |
| MATCH-04 | When no candidate clears both gates, the plugin does not heal and the locator fails normally (no false greens). | Three refusal paths (`no-candidates`, `below-floor`, `ambiguous`) all re-throw the original error in `locator-proxy.ts`. See "Testing the Gates (MATCH-04 proofs)". |
| REP-02 | Summary distinguishes healed from failed-to-heal (visible audit trail). | Reporter gains a second section fed by widened attachment contract. See "Refused-Heal Contract" + "Reporter Two-Section Layout". |
| CFG-02 | User can configure the confidence floor and the margin gate. | `threshold` already configurable; add `margin` to `configSchema` (D-08). See "Config Schema Extension". |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Multi-signal weighted scoring | Pure matching core (`scoring.ts`) | — | Deterministic, offline, Playwright-free; the core IP. Browser only supplies the already-serialized `Fingerprint`/`CandidateDescriptor`. |
| Floor + margin gate decision | Pure matching core (`decision.ts`) | — | Pure function over `ScoredCandidate[]` + thresholds; the false-green guard lives here in code (D-03). |
| Config validation (floor + margin) | Config (`schema.ts`, zod) | — | User-supplied numbers cross a trust boundary; validated `[0,1]` once at load (CFG-02). |
| Refused-heal event creation | Integration (`locator-proxy.ts`) | Pure core (`decision.ts` returns reason+bestScore) | The proxy is where the live failure is observed and where `attach` is called; `decide()` returns the structured reason but never touches Playwright. |
| Worker→main transport | Integration (`events.ts`, `testInfo.attach`) | — | The only sanctioned worker→main channel (issue #31559). Both healed and refused events ride it. |
| Two-section rendering | Reporter (`reporter.ts`, main process) | — | Summary-only by construction (no DOM/page); reads attachments in `onTestEnd`, renders in `onEnd`. |

## Standard Stack

No new dependencies. Phase 2 is pure logic plus formatting on the existing stack.

### Core (already installed, verified in package.json)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | `^6` (devDep) | Plugin language, strict types | Already the project's language; the discriminated-union widening leans on exhaustive `switch` checks. |
| zod | `^4` (dep) | Validate `margin` (and existing `threshold`) | Already the config trust boundary (`thresholdSchema` pattern reused for `margin`). |
| picocolors | `^1` (dep) | Colorize the could-not-heal section | Already used by the reporter's boxed summary; reuse for the new section. |
| `@playwright/test` | `>=1.42` peer / `^1.60` dev | Reporter + fixture + integration test runner | Reporter API (`onTestEnd`/`onEnd`) and `testInfo.attach` are the existing transport. |
| vitest | `^4` (devDep) | Unit-test the pure scorer + decision gates | Phase 1 already TDD'd config/scorer/decision in vitest; `tdd_mode: true` in config. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Absolute-gap margin | Relative ratio (`runnerUp/top`) or combined gap+ratio | REJECTED by D-01 — absolute gap chosen for interpretability and documentation/tuning. Do not research alternatives. |
| Widening the existing attachment | A second attachment name (`selfmend-refused`) | Viable, but the reporter must read both; a single tagged-union attachment keeps one parser path and one wire contract. Recommend the tagged union (see Refused-Heal Contract). Note: if the planner prefers a distinct name, the reporter must filter both names in `onTestEnd`. |

**Installation:** None. `npm install` / `pnpm install` unchanged.

## Package Legitimacy Audit

No external packages are added in this phase. All libraries above are already in `package.json` and were vetted in Phase 1. slopcheck/registry audit is N/A — zero net-new installs.

| Package | Registry | Disposition |
|---------|----------|-------------|
| (none added) | — | N/A — Phase 2 adds no dependencies |

## Key Research Findings

### 1. Default Margin Calibration (MATCH-03, D-01/D-03)

**Recommendation: default `margin = 0.05`** (5 points on the 0..1 score scale). `[ASSUMED — calibrated starting value; confirm against the fixture app during planning/implementation]`

**Reasoning:**

- **The literature fixes the mechanism, not the number.** `[CITED: dl.acm.org/doi/10.1145/3571855]` Similo computes a weighted similarity sum per candidate and **always returns the single highest scorer** — it has no second-best gate at all; disambiguation is implicit in the weighting. `[CITED: automatetheplanet.com/healenium-self-healing-tests + github.com/healenium/healenium-web]` Healenium gates only on an absolute `score-cap` (default `0.5` = 50% match probability) and has no separate margin. So neither published precedent yields an absolute-gap value to copy. The second-best margin is `selfmend`'s own named guard (called out in `.planning/research/PITFALLS.md` Pitfall 1 and `SUMMARY.md` as the specific defense against duplicate/look-alike elements that an absolute floor alone misses). `[VERIFIED: codebase grep — .planning/research/PITFALLS.md lines 19-21]`

- **It must be calibrated against the existing 0.9 floor, not in isolation.** With `floor = 0.9`, both candidates in a refusable case already score ≥ 0.9, so the *available headroom* for a gap is at most 0.1. A margin near or above 0.1 would make the gate almost unsatisfiable for two high-scoring candidates (it would refuse virtually all multi-candidate heals, including legitimate ones where the true element edges out a structural look-alike). A margin of `0.05` sits at the midpoint of that headroom: two candidates both above 0.9 but within 5 points are declared `ambiguous`; a true match that beats its nearest rival by more than 5 points heals.

- **How the scorer's shape supports 0.05.** The Phase 1 scorer normalizes by realized weight and skips absent signals. A genuine match that retains its `data-testid` (weight 6, dominant) while a look-alike shares only `role`+`tag`+structure will typically open a gap far larger than 0.05 on the test-id signal alone — so the common "real heal among structurally similar elements" case clears 0.05 comfortably. The dangerous case the margin targets is **two elements that share the identity signals too** (two real "Delete" buttons, two rows of a duplicated list): there the gap collapses toward 0, well under 0.05, and the gate correctly refuses. This is the intended behavior.

- **Posture is lean-safe (D-03):** when uncertain, refuse. `0.05` errs slightly toward refusing rather than toward false-greening; raising it later (a safety-increasing change) is a minor version, lowering it is effectively breaking (per `PITFALLS.md` Pitfall 8 / semver guidance). Document `0.05` with the same "raising = safer, lowering trades safety for green-ness" warning the threshold carries.

- **No floor recalibration recommended.** The existing `DEFAULT_THRESHOLD = 0.9` is already conservative and matched to the Phase 1 fixture proofs (the heal test asserts `score >= 0.9`). Leave the floor at 0.9; the margin is the *new* safety surface this phase adds. `[VERIFIED: codebase grep — src/config/schema.ts line 11, tests/heal.spec.ts line 62]`

**Open calibration item for planning:** the exact `0.05` should be sanity-checked by adding an ambiguous-duplicate case to the fixture app (two near-identical buttons) and confirming (a) the duplicate is refused as `ambiguous`, and (b) the existing single-survivor heal in `heal.spec.ts` still heals (its gap over any structural-only candidate must exceed 0.05). If (b) ever fails, the issue is scorer weighting, not the margin.

### 2. Multi-Signal Weighting (MATCH-01 deepening, D-09)

The scorer already implements most of the Similo-style multi-signal model. `[VERIFIED: codebase read — src/matching/scoring.ts SIGNAL_WEIGHTS]` Current weights:

| Signal | Current weight | Tier | Keep / change |
|--------|---------------|------|---------------|
| `testId` | 6 | Identity (strongest) | Keep. The single dominant identity signal. |
| `text` | 4 | Identity | Keep. Accessible-name/text via fuzzy similarity. |
| `role` | 3 | Identity | Keep. Stable ARIA role. |
| `attrs` | 2 | Semi-stable | Keep. name/type/etc. exact-match fraction. |
| `tag` | 1 | Structural | Keep. |
| `parentTag` | 0.5 | Structural (weak) | Keep. |
| `neighbourSignature` | 0.5 | Structural/volatile (weak) | Keep. |
| `ordinal` | 0.25 | Volatile (weakest) | Keep. |

**Finding:** the existing ordering already satisfies the defensible principle the literature supports — **identity signals (test-id, accessible name/text, role) dominate; semantic attributes are mid; structural/positional signals (tag, parent, neighbour, ordinal) are weak tiebreakers.** `[CITED: dl.acm.org/doi/10.1145/3571855 — Similo weights parameters by cross-version reliability; SUMMARY.md / FEATURES.md restate "semantic over positional".]` This is exactly Pitfall 2's prescription (`PITFALLS.md`: stable signals dominant, volatile ones weak tiebreakers). `[VERIFIED: codebase read — .planning/research/PITFALLS.md Pitfall 2]`

**Recommended additions/changes for "multi-signal hardening" (Claude's discretion, D-09):**

1. **Add an explicit `accessibleName` signal distinct from raw `text`.** `[ASSUMED]` Playwright's `ariaSnapshot()` (≥1.49, available on the dev `^1.60`) yields role+name; the capture side can populate an accessible name separately from `textContent`. Accessible name is a more stable identity signal than raw inner text (which can carry counts/timestamps). Suggested weight `4` (peer of `text`), so a match that preserves the accessible name scores high even when visible text drifts. **Note:** this requires a `Fingerprint`/`CandidateDescriptor` field addition; if planning wants to keep the contract frozen this phase, treat `text` as already covering accessible-name (the capture already whitespace-collapses it) and defer the split. Recommend the split only if the fixture proofs show raw text causing instability.

2. **Keep `neighbourSignature` as a weak structural signal (weight 0.5).** Similo's "Neighbor Text" is one of its more useful parameters `[CITED: Similo paper — neighbour text parameter]`, but for the look-alike case (two identical list rows) neighbour text is what *differs*, so it is a legitimate weak tiebreaker. Do not promote it above identity signals — promoting positional/neighbour signals is exactly the brittleness Pitfall 2 warns against.

3. **Do NOT add DOM-path/XPath as a heavy signal.** `ordinal` + `parentTag` already capture cheap structural position at low weight. A full DOM path is brittle to re-layout (Healenium's documented weakness, `FEATURES.md`) and should stay out or remain at ≤ `ordinal`'s weight.

**Net recommendation:** the FIXED constants in `SIGNAL_WEIGHTS` are already a defensible, literature-aligned ordering. Planning should (a) document the rationale inline (already partly done in code comments), (b) optionally add `accessibleName` at weight 4 if the capture side can supply it cleanly, and (c) add unit tests that assert the *ordering invariant* (an identity-preserving candidate must outscore a structure-only candidate) rather than asserting exact magic numbers, so weights can re-tune without breaking tests. Keep `score()` pure and the `[0,1]` clamp + divide-by-zero guard intact.

### 3. Refused-Heal Contract Widening (REP-02, D-04/D-05)

Two distinct `HealEvent` types exist today and must not be conflated:

- **Pure** `HealEvent` in `src/matching/types.ts`: `{ newSelector, score, runnerUpScore? }` — what `decide()` returns inside the `heal: true` branch. `[VERIFIED: codebase read]`
- **Transport** `HealEvent` in `src/integration/events.ts`: `{ testName, originalSelector, healedTarget, score }` — what crosses the wire via `attach` and what the reporter parses. `[VERIFIED: codebase read]`

REP-02 needs the **transport** contract to carry refused attempts too. Recommended approach — **a tagged union on the wire, parsed defensively, that preserves the Phase 1 healed shape exactly:**

```typescript
// src/integration/events.ts — WIDENED transport contract (additive)
export const HEAL_ATTACHMENT_NAME = "selfmend-heal"; // unchanged

// Phase 1 successful-heal payload — UNCHANGED fields, gains an optional discriminant.
export interface HealedEvent {
  kind: "healed";            // NEW discriminant; absence === "healed" for back-compat
  testName: string;
  originalSelector: string;
  healedTarget: string;
  score: number;
}

// NEW: a refused attempt. Carries the reason and the best score seen (D-04).
export interface RefusedEvent {
  kind: "refused";
  testName: string;
  originalSelector: string;
  reason: "no-candidates" | "below-floor" | "ambiguous"; // NoHealReason minus no-fingerprint*
  bestScore: number | null;  // null when there were no candidates to score
}

export type SelfmendEvent = HealedEvent | RefusedEvent;
```

**Why a tagged union over a second attachment name:** one wire name, one parser, one attachment stream the reporter already reads in `onTestEnd`. The reporter's existing `parseHealEvent` already validates fields defensively and skips bad entries (T-05-02). Extend it to a `parseEvent` that branches on `kind` (treating a missing `kind` as `"healed"` so any in-flight Phase 1 attachment still parses — back-compat). `[VERIFIED: codebase read — reporter.ts parseHealEvent]`

***`no-fingerprint` decision:** `locator-proxy.ts` re-throws on no stored fingerprint *before* calling `decide()` (line 303). For REP-02 the planner must decide whether "we never saw this locator pass, so we can't heal" is worth surfacing as a refused row. **Recommendation: yes, but as a separate concern** — it is arguably noise (it fires for every never-captured failing locator). Suggest: only surface `no-fingerprint` if cheap, otherwise scope REP-02's refused section to the three *post-scoring* reasons (`no-candidates`, `below-floor`, `ambiguous`) which are the ones that prove the gates worked. Flag this as an Open Question for planning.

**Where refused events are created (D-05):**

- `decide()` already returns `{ heal: false, reason }`. **Widen its no-heal return to also carry the best score seen** so the proxy doesn't re-derive it: `{ heal: false, reason, bestScore: number | null }`. `bestScore` is `ranked[0]?.score ?? null`. This keeps the score computation in the pure core. `[VERIFIED: codebase read — decision.ts already sorts and has `ranked[0]`]`
- `locator-proxy.ts` is the single call site. On `!decision.heal`, before re-throwing the original error (line 316), attach a `RefusedEvent` via a new `attachRefusedEvent(testInfo, {...})` helper alongside the existing `attachHealEvent`. **Critical (D-06):** still `throw err` after attaching — the attach is additive observability and must never suppress the failure. Also attach the refused event for the `no-candidates` case (empty candidate list still calls `decide`, which returns `no-candidates`). For the replay-failure path (line 331-337) do NOT attach a refused event — that is a found-but-broken target, semantically different, and the existing code already re-throws the original error there (WR-03).

### 4. `decide()` Signature Change (MATCH-02 + MATCH-03)

**Recommended:** change `decide(scored: ScoredCandidate[], floor: number)` to `decide(scored: ScoredCandidate[], opts: { floor: number; margin: number })`. `[VERIFIED: codebase read — single call site]`

Rationale: an options object is the cleanest extension (matches CONTEXT.md D-code-context which explicitly anticipates `decide(scored, { floor, margin })`), reads self-documenting at the call site, and leaves room for future gate params without further signature churn. The single call site is `locator-proxy.ts` line 315:

```typescript
// BEFORE
const decision = decide(scored, ctx.config.threshold);
// AFTER
const decision = decide(scored, { floor: ctx.config.threshold, margin: ctx.config.margin });
```

New decision logic (pure, in `decision.ts`):

```typescript
export function decide(scored: ScoredCandidate[], opts: { floor: number; margin: number }): Decision {
  if (scored.length === 0) return { heal: false, reason: "no-candidates", bestScore: null };
  const ranked = [...scored].sort((a, b) => b.score - a.score);
  const winner = ranked[0]!;
  if (winner.score < opts.floor) return { heal: false, reason: "below-floor", bestScore: winner.score };
  const runnerUp = ranked[1];
  // D-02: solo candidate trivially passes the margin gate.
  if (runnerUp !== undefined && winner.score - runnerUp.score < opts.margin) {
    return { heal: false, reason: "ambiguous", bestScore: winner.score };
  }
  return {
    heal: true,
    newSelector: winner.candidate.uniqueSelector,
    event: {
      newSelector: winner.candidate.uniqueSelector,
      score: winner.score,
      ...(runnerUp !== undefined ? { runnerUpScore: runnerUp.score } : {}),
    },
  };
}
```

Note the gate **order matters for the reason** (D-03): check floor first (`below-floor`), then margin (`ambiguous`). The `Decision` `heal:false` arm widens to `{ heal: false; reason: NoHealReason; bestScore: number | null }` in `types.ts`. The `"ambiguous"` reason is already declared in the `NoHealReason` union — no union change needed, only the new `bestScore` field. `[VERIFIED: codebase read — types.ts lines 108-112]`

### 5. Testing the Gates (MATCH-04 proofs) — TDD, `tdd_mode: true`

`nyquist_validation: false` in config, so the formal Validation Architecture section is omitted; but `tdd_mode: true` and the Phase 1 RED→GREEN→REFACTOR discipline apply. Test layout mirrors Phase 1: pure-core tests in `src/matching/*.test.ts` (vitest), integration in `tests/*.spec.ts` (Playwright). `[VERIFIED: codebase glob — src/matching/decision.test.ts, scoring.test.ts; tests/heal.spec.ts]`

**Pure unit tests (vitest, `src/matching/decision.test.ts` — extend existing):**

| Case | Input | Expected |
|------|-------|----------|
| Empty candidates | `decide([], { floor: 0.9, margin: 0.05 })` | `{ heal: false, reason: "no-candidates", bestScore: null }` |
| Below floor | one candidate score `0.7` | `{ heal: false, reason: "below-floor", bestScore: 0.7 }` |
| Ambiguous (within margin) | two candidates `0.95` and `0.93` (gap 0.02 < 0.05) | `{ heal: false, reason: "ambiguous", bestScore: 0.95 }` |
| Boundary: gap exactly == margin | `0.95` and `0.90` (gap 0.05, margin 0.05) | `heal: true` (gate is `< margin` → refuse; `>= margin` → heal, consistent with inclusive floor) |
| Solo above floor (D-02) | one candidate `0.95` | `heal: true`, no `runnerUpScore` |
| Clear winner | `0.97` and `0.80` (gap 0.17) | `heal: true`, `runnerUpScore: 0.80` |
| Floor takes precedence over margin | top `0.85`, runner `0.84` (both below floor) | `below-floor` (floor checked first), not `ambiguous` |

**Scorer ordering-invariant tests (vitest, `src/matching/scoring.test.ts` — extend):** assert an identity-preserving candidate (same test-id, drifted class) outscores a structure-only candidate (same tag/position, different test-id) by more than the default margin — proves the weights produce gaps the margin gate can act on. Assert by *ordering/relative magnitude*, not exact numbers (so weights re-tune freely).

**Config test (vitest, `src/config/schema.test.ts` — extend):** `margin` defaults to `0.05`; out-of-range (`-0.1`, `1.5`) and wrong-type rejected with readable zod messages; valid `0..1` accepted.

**Playwright integration test (`tests/ambiguous-no-heal.spec.ts` — NEW):** the load-bearing MATCH-04 proof. Add an **ambiguous fixture** to `tests/fixture-app/` — a page with two near-identical buttons (e.g. two `<button>Delete</button>` rows sharing role+text+tag, differing only in a row index). Capture against one on a "good" page; on a "broken" page mutate the captured one's selector so it no longer resolves, leaving two equally-plausible survivors. Assert via the expected-failure wrapper (`await expect(async () => { ... }).rejects.toThrow()`, the pattern already used in `heal.spec.ts` line 78) that the action FAILS (no heal), and assert **no `kind:"healed"` attachment** while **one `kind:"refused"` with `reason:"ambiguous"`** was attached. This proves: ambiguity fails normally (D-06) AND is reported (REP-02). `[VERIFIED: codebase read — heal.spec.ts uses exactly this expected-failure idiom]`

**Reporter test (vitest, `src/reporter/reporter.test.ts` — extend):** feed mixed attachments (some healed, some refused with each reason) and assert `render()` produces the healed box AND a separate "could not heal" section listing locator + reason + best score; assert N=0-refused prints no empty refused section (mirror the existing N=0 healed-box guard).

### Reporter Two-Section Layout (REP-02, D-04)

`SelfmendReporter` collects events in `onTestEnd` (already iterates `result.attachments`) and renders in `onEnd`. `[VERIFIED: codebase read — reporter.ts]` Recommended:

- Maintain two arrays: `private heals: HealedEvent[]` and `private refused: RefusedEvent[]`. In `onTestEnd`, `parseEvent` branches on `kind` and pushes to the right array.
- `render()` returns: the existing healed box first (unchanged for back-compat), then, if `refused.length > 0`, a separate clearly-labelled section. Suggested header `selfmend: N locators could NOT heal` in a warning color (e.g. `pc.yellow`/`pc.red`), one indented row per refusal: `<test name>` / `  <originalSelector>  ✗  <reason>  (best <score|—>)`. Reuse the existing box-drawing + `visibleLength`/`stripAnsi` helpers so layout survives no-color terminals.
- Keep the reporter summary-only (D-05 from Phase 1): no page/DOM, never heals. The refused section reads exclusively from attachments.

## Architecture Patterns

### Data Flow (Phase 2 additions in **bold**)

```
passing run ─▶ wrapLocator (proxy) ─▶ action succeeds ─▶ captureFingerprint ─▶ store
                                                                                  │
broken run ─▶ wrapLocator action ─▶ real TimeoutError ─▶ store.get(key)? ─┐       │
                                                                          ▼       │
                                              findCandidates ─▶ score() each ─────┘
                                                          │
                                                          ▼
                              decide(scored, { floor, margin })  ◀── config (zod: threshold + MARGIN)
                                   │                         │
                          heal:true│                         │heal:false {reason, bestScore}
                                   ▼                         ▼
                       rebind + replay              **attachRefusedEvent** ─┐  then THROW err (D-06)
                                   │                                        │
                       attachHealEvent (kind:"healed")  ───────────────────┤
                                   │                                        │
                                   ▼                                        ▼
                        testInfo.attach("selfmend-heal", SelfmendEvent)  [worker→main, #31559]
                                                          │
                                                          ▼
                          SelfmendReporter.onTestEnd  ─▶ parseEvent (branch on kind)
                                                          │
                                          ┌───────────────┴────────────────┐
                                          ▼                                ▼
                                   heals[] (box)               **refused[] (could-not-heal section)**
                                          └──────────── onEnd render() ────┘
```

### Anti-Patterns to Avoid
- **Suppressing the failure when attaching a refused event.** The attach is observability; `throw err` must still run (D-06). A try/catch around attach must never swallow the original error.
- **Importing Playwright or fs into `decision.ts`/`scoring.ts`.** Purity is contractual (verified by `tsc` + grep in Phase 1). The `bestScore` and reason are computed purely; only the proxy attaches.
- **Renaming `threshold`.** D-08 — keep the floor key as `threshold`; add `margin` beside it. Renaming breaks Phase 1 configs.
- **A margin ≥ ~0.1 with a 0.9 floor.** Leaves no headroom for two high scorers; refuses nearly all multi-candidate heals.
- **Promoting positional/neighbour signals above identity signals.** Reintroduces Pitfall 2 brittleness.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Config range validation + readable errors | A custom number-range checker | The existing `thresholdSchema` zod pattern, copied for `margin` | Already the trust boundary; consistent error messages (CFG-02 / D-08). |
| Worker→main delivery of refused events | A custom IPC / global singleton | The existing `testInfo.attach` transport (`events.ts`) | Custom worker↔main IPC is unavailable (#31559); attach is the sanctioned channel (D-05). |
| Box/section drawing + color-safe width | A new formatter | The reporter's existing `boxLine`/`visibleLength`/`stripAnsi` helpers | Already handles no-color terminals and CI log capture. |
| Text/edit-distance similarity | A new similarity lib | The existing `levenshtein`/`tokenOverlap`/`textSimilarity` in `scoring.ts` | Core IP, deterministic, offline; already tested. |

## Common Pitfalls

### Pitfall 1: Margin gate calibrated in isolation from the floor
**What goes wrong:** picking `margin` without accounting for the 0.9 floor's 0.1 headroom; a too-large margin refuses legitimate heals, a too-small one is a no-op.
**How to avoid:** calibrate against the fixture app — confirm the existing single-survivor heal still heals AND a new ambiguous-duplicate fixture is refused. `0.05` is the recommended midpoint.
**Warning signs:** the Phase 1 `heal.spec.ts` heal starts failing after adding the gate (margin too large), or the ambiguous fixture heals anyway (margin too small / scorer weights too flat).

### Pitfall 2: Refused-event attach suppressing the test failure
**What goes wrong:** wrapping the attach so an attach error (or the attach itself) prevents `throw err`, producing a false green — the exact failure mode this phase exists to prevent.
**How to avoid:** attach, then unconditionally `throw err`. Mirror the WR-03 ordering already used for successful heals (attach only after success; here, attach then re-throw). Add the integration test that asserts the action rejects.
**Warning signs:** ambiguous integration test passes (action resolves) instead of rejecting.

### Pitfall 3: Conflating the two `HealEvent` types
**What goes wrong:** widening the pure `HealEvent` (types.ts) when REP-02 needs the transport `HealEvent` (events.ts) widened, or vice versa.
**How to avoid:** the refused-event widening is on the **transport** type in `events.ts` (the wire/reporter view). The pure `decide()` return gains only `bestScore` on its `heal:false` arm. Keep the two modules' types distinct as Phase 1 did.

### Pitfall 4: Breaking back-compat on the attachment wire
**What goes wrong:** adding a required `kind` field that makes old/healed-only attachments unparseable.
**How to avoid:** in `parseEvent`, treat a missing `kind` as `"healed"`; validate refused fields only when `kind === "refused"`. Skip malformed entries (existing T-05-02 behavior) rather than crashing.

## Security Domain

`security_enforcement` is not set in `.planning/config.json` (no `security` key). This phase adds no network, fs, or new external input surface beyond one config number. The only relevant control:

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V5 Input Validation | yes | `margin` validated `[0,1]` via zod (`thresholdSchema` pattern), like the existing `threshold` (CFG-02 / D-08). Reject NaN/out-of-range/wrong-type with readable messages. |
| V6 Cryptography | no | — |
| V2/V3/V4 Auth/Session/Access | no | — (offline test plugin, no auth surface) |

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malformed/oversized attachment crashes reporter | Denial of Service | `parseEvent` validates every field, skips bad entries (existing T-05-02 pattern), never throws in `onTestEnd`. |
| Refused-event payload leaking raw DOM content | Information Disclosure | Refused event carries only `originalSelector`, `reason`, `bestScore` (a number) — derived signals only, never raw element content (consistent with T-05-03). |

## State of the Art

| Old (Phase 1) | New (Phase 2) | Impact |
|---------------|---------------|--------|
| `decide(scored, floor)` — single floor gate | `decide(scored, { floor, margin })` — floor + absolute-gap margin gate | Adds the duplicate-element guard; one call site updated. |
| `heal:false` returns `{ reason }` | returns `{ reason, bestScore }` | Reporter can show the best score seen on a refusal (D-04). |
| Transport `HealEvent` = healed only | `SelfmendEvent = HealedEvent | RefusedEvent` (tagged union) | Both sections in the report; back-compat via implicit `kind:"healed"`. |
| Reporter prints healed box only | healed box + separate "could not heal" section | REP-02 audit trail. |
| Config: `enabled`, `threshold`, `testIdAttr` | + `margin` (global, `[0,1]`, default 0.05) | CFG-02. |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Default `margin = 0.05` is the right starting value given a 0.9 floor | Default Margin Calibration | Too high → refuses legitimate heals (Phase 1 heal test could fail); too low → no-op gate. Mitigated by calibrating against an ambiguous fixture during implementation. Confirm before locking. |
| A2 | An `accessibleName` signal (weight ~4) is worth adding distinct from `text` | Multi-Signal Weighting | Low — optional; defaults to leaving `text` as-is if capture can't supply it cleanly. Requires a `Fingerprint`/`CandidateDescriptor` field add. |
| A3 | Surfacing `no-fingerprint` refusals is noise; scope refused section to the 3 post-scoring reasons | Refused-Heal Contract | Low — a reporting-completeness choice; flagged as Open Question for the planner. |
| A4 | A tagged-union single attachment is preferable to a second attachment name | Refused-Heal Contract | Low — both work; tagged union is one parser path. Planner may choose the second-name variant. |
| A5 | Keep the floor at 0.9 (no recalibration) | Default Margin Calibration | Low — 0.9 is already proven by Phase 1 fixture tests; changing it would ripple to existing proofs. |

## Open Questions (RESOLVED)

All three are resolved for planning; each resolution is adopted by the Phase 2 plans as noted.

1. **Should `no-fingerprint` refusals appear in the could-not-heal section?**
   - Known: `locator-proxy.ts` re-throws on no stored fingerprint before scoring (line 303).
   - Unclear: whether it is useful signal or noise (fires for every never-captured failing locator).
   - Recommendation: scope REP-02's refused section to the three post-scoring reasons (`no-candidates`, `below-floor`, `ambiguous`); revisit if users want to see uncaptured-locator misses.
   - **RESOLVED:** Scope the refused section to the 3 post-scoring reasons only (exclude `no-fingerprint`). Implemented in Plan 02 Task 1.

2. **Add a dedicated `accessibleName` fingerprint field this phase, or defer?**
   - Known: `ariaSnapshot()` (≥1.49) can supply it; capture lives in Phase 1 `fingerprint/capture.ts` (Playwright-coupled).
   - Recommendation: defer unless the ambiguous-fixture calibration shows raw `text` causing instability; the existing signal set is already literature-aligned.
   - **RESOLVED:** Defer; do not add a fingerprint field this phase. The existing `text` signal covers it. Reflected in Plan 01 Task 2.

3. **Exact `margin` default (0.05 vs 0.03 vs 0.07)?**
   - Recommendation: start at `0.05`, lock after running the ambiguous-fixture + existing-heal calibration in implementation. This is the one number to validate empirically.
   - **RESOLVED:** Default `margin = 0.05`, validated empirically in Plan 02 Task 4 (ambiguous duplicate must fail AND the existing single-survivor heal must still heal). Floor stays 0.9.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| vitest | Pure-core unit tests | ✓ (devDep) | `^4` | — |
| @playwright/test | Integration ambiguous-fail test | ✓ (devDep) | `^1.60` | — |
| zod | `margin` validation | ✓ (dep) | `^4` | — |
| picocolors | Could-not-heal section color | ✓ (dep) | `^1` | — |

No missing dependencies. No external tools or services needed (offline by design).

## Sources

### Primary (HIGH confidence)
- Codebase reads: `src/matching/decision.ts`, `scoring.ts`, `types.ts`; `src/config/schema.ts`; `src/reporter/reporter.ts`; `src/integration/events.ts`, `locator-proxy.ts`; `tests/heal.spec.ts`; `package.json`; `.planning/config.json` — exact current contracts and seams.
- `.planning/phases/02-trust-hardening/02-CONTEXT.md` — locked decisions D-01..D-09.
- `.planning/REQUIREMENTS.md` — MATCH-02/03/04, REP-02, CFG-02 scope.
- `.planning/research/PITFALLS.md` (Pitfall 1 false-green trap + margin gate; Pitfall 2 signal stability) and `SUMMARY.md`/`FEATURES.md` — the margin gate named as the duplicate-element guard; semantic-over-positional weighting.
- Similo: https://dl.acm.org/doi/10.1145/3571855 — weighted multi-signal sum, highest scorer wins (no second-best gate; confirms the margin is our own design).

### Secondary (MEDIUM confidence)
- Healenium `score-cap` default 0.5: https://www.automatetheplanet.com/healenium-self-healing-tests/ ; https://github.com/healenium/healenium-web — absolute-probability gate, no separate margin.
- Similarity-based localization follow-up (Similo++): https://www.arxiv.org/pdf/2505.16424 — corroborates weighting-by-reliability approach.

### Tertiary (LOW confidence — flagged for empirical calibration)
- The specific `margin = 0.05` default — calibrated reasoning from the 0.9-floor headroom; no published absolute-gap value exists to cite. Validate against the fixture app.

## Metadata

**Confidence breakdown:**
- Contract/seam findings (decide signature, attachment widening, reporter sections): HIGH — read directly from the code; Phase 1 deliberately left these seams.
- Signal weighting: HIGH on ordering principle (literature + existing code align); MEDIUM on whether to add `accessibleName`.
- Default margin value: MEDIUM — mechanism is HIGH/locked; the number is a calibrated [ASSUMED] starting point requiring fixture validation.
- Testing approach: HIGH — mirrors proven Phase 1 vitest + Playwright expected-failure patterns.

**Research date:** 2026-05-31
**Valid until:** ~2026-06-30 (stable; pure-logic phase on a frozen Phase 1 base, no fast-moving externals)
