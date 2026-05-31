---
phase: 02-trust-hardening
verified: 2026-05-31T04:45:00Z
status: passed
score: 16/16
overrides_applied: 0
---

# Phase 02: Trust Hardening Verification Report

**Phase Goal:** The matcher becomes trustworthy: multi-signal weighted scoring, both trust gates (confidence floor + second-best margin) enforced in the pure core, no-force-green, and a console audit trail that distinguishes healed from could-not-heal.
**Verified:** 2026-05-31T04:45:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | decide() enforces BOTH gates in the right order: floor then margin | VERIFIED | decision.ts lines 57-76: floor gate at line 58, margin gate at line 71-75. Load-bearing order: floor checked first so two below-floor candidates return `below-floor` not `ambiguous`. |
| 2 | Every no-heal return carries `bestScore` (number or null) | VERIFIED | types.ts line 140: `bestScore: number \| null` on heal:false arm. decision.ts returns it in all three refusal paths (lines 45, 59, 75). |
| 3 | `ambiguous` reason is emitted for within-margin look-alikes | VERIFIED | decision.ts line 75: `return { heal: false, reason: "ambiguous", bestScore: winner.score }`. decision.test.ts line 103-115: explicit test case with 0.95/0.93 pair (gap 0.02 < 0.05). |
| 4 | Margin gate is inclusive: gap exactly equal to margin heals | VERIFIED | decision.ts line 73: `gap < opts.margin - GAP_EPSILON` (epsilon absorbs IEEE-754 drift). decision.test.ts lines 117-128: boundary case 0.95/0.90 heals. |
| 5 | Solo candidate trivially passes the margin gate (D-02) | VERIFIED | decision.ts line 62: `runnerUp` is undefined, so the `runnerUp !== undefined &&` guard at line 71 short-circuits. decision.test.ts lines 130-137. |
| 6 | `margin` is a global config key defaulting to 0.05, validated [0,1] | VERIFIED | schema.ts lines 26-41: `DEFAULT_MARGIN = 0.05`, `marginSchema` z.number min 0 max 1. schema.test.ts confirms default, boundaries, and rejection of -0.1/1.5/"high". |
| 7 | `threshold` is NOT renamed (back-compat, D-08) | VERIFIED | schema.ts line 56: `threshold: thresholdSchema.default(DEFAULT_THRESHOLD)` unchanged. schema.test.ts line 54 asserts `threshold === 0.9`. |
| 8 | Ambiguous duplicate FAILS the action (no heal) | VERIFIED | `npx playwright test tests/ambiguous-no-heal.spec.ts` passes: test asserts `.rejects.toThrow()` and the action rejects. Output shows "refused-ambiguous" event, no heal attachment. |
| 9 | Single-survivor heal still heals (calibration: 0.05 refuses duplicates AND permits real heals) | VERIFIED | `npx playwright test tests/heal.spec.ts` passes alongside ambiguous test. Reporter output confirms single heal at score 1.00. |
| 10 | No false greens: refused path attaches event THEN unconditionally re-throws | VERIFIED | locator-proxy.ts lines 334-346: `attachRefusedEvent` wrapped in try/catch, `throw err` is OUTSIDE and unconditional. Cannot be suppressed. |
| 11 | SelfmendEvent is a tagged union with back-compat for missing `kind` | VERIFIED | events.ts line 87: `type SelfmendEvent = HealedEvent \| RefusedEvent`. reporter.ts line 213: `if (o.kind === "refused")` else falls through to `parseHealed` (missing kind -> healed). |
| 12 | Malformed attachments are skipped defensively (never crash) | VERIFIED | reporter.ts lines 246-262: parseRefused returns null for unknown reason or bad bestScore; parseHealed returns null for missing fields. onTestEnd line 47: `if (!event) continue`. |
| 13 | Reporter renders healed box first, then SEPARATE could-not-heal section | VERIFIED | reporter.ts lines 70-75: `render()` builds healedBlock then refusedBlock. renderRefusedSection line 118: `if (n === 0) return null`. Live output confirmed from full PW test run: two distinct bordered sections. |
| 14 | Reporter zero-refusal guard: no empty could-not-heal section printed | VERIFIED | reporter.ts line 118: `if (n === 0) return null`. render() at line 73: `if (refusedBlock === null) return healedBlock`. |
| 15 | Reporter is summary-only: no page/DOM access | VERIFIED | Grep of reporter.ts for `page.`, `Page`, `evaluate`, `document.`, `window.` returns zero matches. Imports only from `@playwright/test/reporter` (Reporter type) and events.ts. |
| 16 | Pure src/matching/types.ts has no Playwright/fs imports | VERIFIED | types.ts imports: none. Grep for `playwright\|node:fs\|http\|fetch` in types.ts and decision.ts returns only comment lines (not import statements). |

**Score:** 16/16 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/matching/decision.ts` | decide(scored, { floor, margin }) with bestScore on every no-heal | VERIFIED | Lines 40-88. Options-object signature, GAP_EPSILON for IEEE-754, bestScore on all 3 refusal paths. |
| `src/matching/types.ts` | Decision heal:false arm widened with bestScore | VERIFIED | Lines 131-141. `bestScore: number \| null` on heal:false arm. NoHealReason includes "ambiguous". |
| `src/config/schema.ts` | margin config key + DEFAULT_MARGIN constant | VERIFIED | Lines 26-66. DEFAULT_MARGIN = 0.05, marginSchema, configSchema.margin with default. |
| `src/integration/events.ts` | SelfmendEvent = HealedEvent \| RefusedEvent tagged union + attachRefusedEvent helper | VERIFIED | Lines 33-126. Full tagged union, RefusedReason scoped to 3 post-scoring reasons, attachRefusedEvent present. |
| `src/integration/locator-proxy.ts` | decide() called with { floor, margin }; refused event attached then original error re-thrown | VERIFIED | Lines 315-347. decide() call with options object, try/catch around attach, unconditional throw err outside. |
| `src/reporter/reporter.ts` | could-not-heal section fed by parsed refused events | VERIFIED | Lines 116-142. renderRefusedSection present with N=0 guard, warning-colored header, locator/reason/bestScore per row. |
| `tests/fixture-app/ambiguous.html` | Two near-identical Delete buttons sharing data-testid | VERIFIED | Two `<button data-testid="delete-item">Delete</button>` in `#row-a` and `#row-b`. |
| `tests/fixture-app/ambiguous-broken.html` | Broken page where .btn-delete-primary is gone but both duplicates remain | VERIFIED | `.btn-delete-primary` renamed to `.btn-delete-cta`; both rows intact. |
| `tests/ambiguous-no-heal.spec.ts` | Playwright proof that ambiguous duplicate fails and is reported refused | VERIFIED | Asserts `.rejects.toThrow()`, no healed attachment, exactly one refused/ambiguous event with bestScore >= 0.9. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/matching/decision.ts` | `src/matching/types.ts` | `from "./types.js"` import | VERIFIED | Line 1 of decision.ts imports Decision, ScoredCandidate. |
| `src/integration/locator-proxy.ts` | `src/integration/events.ts` | `attachRefusedEvent` import + call | VERIFIED | Line 10: `import { attachHealEvent, attachRefusedEvent } from "./events.js"`. Line 335: called with refused event. |
| `src/integration/locator-proxy.ts` | `src/matching/decision.ts` | `decide(scored, { floor, margin })` | VERIFIED | Lines 315-318: `decide(scored, { floor: ctx.config.threshold, margin: ctx.config.margin })`. |
| `src/reporter/reporter.ts` | `src/integration/events.ts` | SelfmendEvent parse branching on `kind` | VERIFIED | Line 212-214: `if (o.kind === "refused") return parseRefused(o)`. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `reporter.ts` | `this.refused: RefusedEvent[]` | onTestEnd parsing attachments from TestResult | Yes — parsed from real attachment bytes written by locator-proxy | FLOWING |
| `reporter.ts` | `this.heals: HealEvent[]` | onTestEnd parsing attachments from TestResult | Yes — same attachment channel | FLOWING |
| `locator-proxy.ts` | `decision` | `decide(scored, { floor, margin })` | Yes — scored from real DOM candidates via findCandidates | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Vitest unit suite green | `npx vitest run` | 52 passed (6 files) | PASS |
| TypeScript compilation clean | `npx tsc --noEmit` | 0 errors | PASS |
| Ambiguous duplicate FAILS, not heals | `npx playwright test tests/ambiguous-no-heal.spec.ts tests/heal.spec.ts` | 4 passed; ambiguous -> refused/ambiguous bestScore 1.00; single-survivor heal -> healed 1.00 | PASS |
| Full Playwright suite passes (no regressions) | `npx playwright test` | 17 passed (18.8s) | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| MATCH-02 | 02-01-PLAN | Confidence floor gate | SATISFIED | decision.ts gate 1 (line 58), decision.test.ts floor cases |
| MATCH-03 | 02-01-PLAN | Margin gate preventing ambiguous matches | SATISFIED | decision.ts gate 2 (line 71-75), ambiguous-no-heal.spec.ts empirical proof |
| MATCH-04 | 02-02-PLAN | No false greens when gates fail | SATISFIED | locator-proxy.ts unconditional re-throw (line 346), Playwright integration test |
| REP-02 | 02-02-PLAN | Could-not-heal section distinct from healed box | SATISFIED | reporter.ts renderRefusedSection, live output shows two separate bordered sections |
| CFG-02 | 02-01-PLAN | Confidence floor + margin both configurable | SATISFIED | schema.ts margin key (line 61), threshold unchanged (line 56) |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none) | — | — | — | — |

No `TBD`, `FIXME`, `XXX`, `TODO`, or placeholder patterns found in any Phase 2 modified files. No empty implementations. No stubs.

### Human Verification Required

None. All goal-critical behaviors are verified programmatically:
- Both gates enforced in correct order: confirmed by unit tests and code inspection
- Ambiguous case genuinely fails (not silently healed): confirmed by Playwright test with `.rejects.toThrow()` assertion and explicit attachment check
- No-false-green unconditional re-throw: confirmed by code reading (throw outside try/catch)
- Reporter sections: confirmed by live reporter output in test run showing two distinct bordered boxes

### Gaps Summary

None. All 16 must-haves are verified.

---

## Verification Summary

Phase 02 goal is **fully achieved**. The evidence chain is complete:

1. **Pure core (Plan 01):** `decide()` enforces floor-then-margin in the correct order with `bestScore` on every refusal. `ambiguous` reason is real, not cosmetic. `margin` config key is validated [0,1] beside an unchanged `threshold`. The pure modules contain no Playwright/fs/network imports.

2. **Integration + observability (Plan 02):** The transport is a proper tagged union. The proxy attaches a refused event then throws unconditionally (the attach is inside try/catch; the throw is outside it). The reporter renders a separate could-not-heal section with N=0 guard.

3. **Empirical calibration proof:** `npx playwright test tests/ambiguous-no-heal.spec.ts tests/heal.spec.ts` — the ambiguous duplicate receives `reason: "ambiguous"`, `bestScore: 1.00`, no heal attachment; the single-survivor heal still heals at score 1.00. The 0.05 margin refuses look-alikes and permits real heals simultaneously.

4. **Full suite:** 52 vitest tests, 17 Playwright tests, 0 tsc errors — all green.

---
_Verified: 2026-05-31T04:45:00Z_
_Verifier: Claude (gsd-verifier)_
