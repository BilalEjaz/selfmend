---
phase: 02-trust-hardening
plan: 01
subsystem: pure matching core + config
tags: [matching, decision-gate, margin, scoring-invariant, config, zod, tdd]
requires:
  - "src/matching/decision.ts decide() floor gate (Phase 1)"
  - "src/matching/types.ts Decision/ScoredCandidate/HealEvent (Phase 1)"
  - "src/matching/scoring.ts SIGNAL_WEIGHTS + score() (Phase 1, unchanged)"
  - "src/config/schema.ts thresholdSchema pattern (Phase 1)"
provides:
  - "decide(scored, { floor, margin }) with absolute-gap margin gate + bestScore on every no-heal"
  - "Decision heal:false arm widened with bestScore: number | null"
  - "ambiguous no-heal reason now emitted by decide()"
  - "DEFAULT_MARGIN constant + global margin config key (validated [0,1])"
  - "weight-ordering invariant test (identity > structure by >margin)"
affects:
  - "src/integration/locator-proxy.ts (decide call site updated to { floor, margin })"
  - "plan 02-02 will consume the widened decide() contract (bestScore + ambiguous) for refused-event reporting"
tech-stack:
  added: []
  patterns:
    - "Options-object signature for multi-gate decide() (room for future gate params)"
    - "Epsilon-tolerant inclusive boundary comparison to absorb IEEE-754 drift"
    - "Relative-magnitude invariant tests (no magic numbers) so fixed weights re-tune freely"
key-files:
  created:
    - ".planning/phases/02-trust-hardening/02-01-SUMMARY.md"
  modified:
    - "src/matching/decision.ts"
    - "src/matching/types.ts"
    - "src/matching/decision.test.ts"
    - "src/matching/scoring.test.ts"
    - "src/config/schema.ts"
    - "src/config/schema.test.ts"
    - "src/integration/locator-proxy.ts"
    - "src/integration/step-identity.test.ts"
decisions:
  - "Margin gate is an absolute gap with an inclusive >= boundary; a tiny GAP_EPSILON (1e-9) absorbs float subtraction drift so the documented exact-gap case (0.95 vs 0.90) heals (D-01)"
  - "Floor checked before margin so two below-floor candidates report below-floor, not ambiguous (D-03 load-bearing order)"
  - "Weight-ordering invariant proven against the existing fixed SIGNAL_WEIGHTS with no scorer change (D-09)"
metrics:
  duration: 5 min
  completed: 2026-05-31
  tasks: 3
  files: 8
---

# Phase 02 Plan 01: Margin Gate, bestScore, Weight Invariant & margin Config Summary

Hardened the pure heal core test-first: added the absolute second-best margin gate beside the existing confidence floor, widened every no-heal return with `bestScore`, pinned the weight-ordering invariant relatively, and added the global `margin` config key (default 0.05) — all Playwright/fs-free and tsc-clean.

## What Was Built

- **Task 1 (decide() margin gate + bestScore):** `decide(scored, floor)` became `decide(scored, { floor, margin })`. Logic order is load-bearing (D-03): empty -> `no-candidates`/`bestScore: null`; sort desc; `winner.score < floor` -> `below-floor`; else if a runner-up exists AND `winner.score - runnerUp.score < margin` -> `ambiguous`; else heal. The `Decision` `heal:false` arm now carries `bestScore: number | null` (D-04). Solo candidates trivially pass the margin gate (D-02). The single call site in `locator-proxy.ts` was updated to pass `{ floor: threshold, margin }`.
- **Task 2 (weight-ordering invariant):** Added a test-only invariant to `scoring.test.ts` asserting an identity-preserving candidate (same testId/role/text, drifted tag/ordinal/parent) out-scores a structure-only candidate by more than the default margin (0.05). Asserted relatively (ordering + `> 0.05` gap), never by magic numbers. `SIGNAL_WEIGHTS` and `score()` are untouched (D-09).
- **Task 3 (margin config key):** Added `DEFAULT_MARGIN = 0.05` beside `DEFAULT_THRESHOLD` with the same "raising is safer" warning, a `marginSchema` reusing the `thresholdSchema` `[0,1]` pattern with margin-specific readable messages, and a global `margin` key on `configSchema`. `threshold` is unchanged and not renamed (D-08); margin is global-only (D-07).

## Verification

- `npx vitest run` — 47 passed (6 files). Decision suite 12, scoring suite 8, config suite 17.
- `npx tsc --noEmit` — clean across the widened `Decision` contract and `SelfmendConfig`.
- Purity: `git grep` finds no Playwright/`node:fs`/network imports in `decision.ts` or `scoring.ts`.
- `scoring.ts` source confirmed untouched via `git diff` (only `scoring.test.ts` changed).

## TDD Gate Compliance

MVP+TDD active. Each behavior-adding task followed RED -> GREEN:
- Task 1: `test(02-01)` RED commit `104deb6` (5 failing) -> `feat(02-01)` GREEN commit `ae556a0`.
- Task 3: `test(02-01)` RED commit `7891ca3` (6 failing) -> `feat(02-01)` GREEN commit `f0925bf`.
- Task 2 is a test-only invariant (modifies only `scoring.test.ts`, no source) — exempt from the gate; committed as a single `test(02-01)` commit `ed9a1df`. It passed against the unchanged scorer as the plan anticipated (no scorer code change expected). No REFACTOR commits were needed; GREEN code was already clean.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Inclusive exact-gap boundary refused due to IEEE-754 drift**
- **Found during:** Task 1 (GREEN)
- **Issue:** The documented boundary case (winner 0.95, runner-up 0.90, gap == margin 0.05) must heal, but `0.95 - 0.90` evaluates to `0.04999999999999982 < 0.05` in JS, so a naive `< margin` comparison refused it.
- **Fix:** Added a `GAP_EPSILON = 1e-9` so the gate compares `gap < margin - GAP_EPSILON`, preserving the documented inclusive `>= margin` heals / `< margin` refuses semantics without affecting any genuine within-margin refusal.
- **Files modified:** src/matching/decision.ts
- **Commit:** ae556a0

**2. [Rule 3 - Blocking] Widened SelfmendConfig broke an existing test fixture**
- **Found during:** Task 3 (tsc)
- **Issue:** Adding the required `margin` key to the inferred `SelfmendConfig` made `src/integration/step-identity.test.ts`'s hand-built config literal fail `tsc` (TS2741: `margin` missing).
- **Fix:** Added `margin: 0.05` to that test config literal. No production code affected; all other config consumers use `configSchema.parse(...)` which applies the default.
- **Files modified:** src/integration/step-identity.test.ts
- **Commit:** f0925bf

## Known Stubs

None. All deliverables are wired and tested.

## Notes for Plan 02-02

The widened `decide()` contract is ready to consume: `bestScore` is on every `heal:false` return and the `ambiguous` reason is now emitted. The transport/event/reporter widening (refused-event section, REP-02) is out of scope here and belongs to wave 2. The proxy call site already passes `ctx.config.margin`; no further core change is needed for 02-02 to attach refused events.

## Self-Check: PASSED

All four key files exist on disk and all five task commits (104deb6, ae556a0, ed9a1df, 7891ca3, f0925bf) are present in git history.
