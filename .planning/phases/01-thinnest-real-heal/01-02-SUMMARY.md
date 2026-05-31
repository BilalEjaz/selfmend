---
phase: 01-thinnest-real-heal
plan: 02
subsystem: matching
tags: [typescript, scoring, levenshtein, jaccard, decision, tdd, vitest]

# Dependency graph
requires:
  - phase: 01-01
    provides: package skeleton, tsconfig (strict, nodenext), vitest config, zod config layer
provides:
  - "Pure Playwright-free matching contracts (Fingerprint, CandidateDescriptor, ScoredCandidate, Decision, HealEvent)"
  - "Deterministic offline weighted scorer score(fingerprint, candidate) -> [0,1]"
  - "Conservative-floor heal decision decide(scored[], floor) -> heal | no-heal + reason (false-green guard)"
affects: [capture, candidate-finder, rebind, integration, reporter, fixture]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure, dependency-free core IP: scoring + decision import nothing from Playwright or fs"
    - "Hand-rolled text similarity (Jaccard token overlap + Levenshtein), no new dep per STACK.md"
    - "Named weight table (SIGNAL_WEIGHTS) + exported per-signal scorers for Phase 2 re-calibration"
    - "Discriminated-union Decision with reserved NoHashReason 'ambiguous' for the Phase 2 margin gate"

key-files:
  created:
    - src/matching/types.ts
    - src/matching/scoring.ts
    - src/matching/scoring.test.ts
    - src/matching/decision.ts
    - src/matching/decision.test.ts
  modified: []

key-decisions:
  - "Absent-on-both signals do not participate in scoring, so missing signals never dilute the score toward 0 (weighted average over realized signals only)"
  - "Inclusive floor: score == floor heals; below floor refuses (false-green guard)"
  - "HealEvent retains runnerUpScore so the Phase 2 second-best margin gate layers on without contract changes"

patterns-established:
  - "TDD RED->GREEN per behavior-adding module: failing test committed as test(...), implementation as feat(...)"
  - "ESM .js import extensions, JSDoc on every export, defensive [0,1] clamp on scorer output"

requirements-completed: [MATCH-01]

# Metrics
duration: 4min
completed: 2026-05-31
---

# Phase 01 Plan 02: Pure Scorer + Heal Decision Summary

**Deterministic, offline, Playwright-free matching core: a weighted signal scorer (Jaccard + Levenshtein text similarity) and a conservative-floor heal/no-heal decision that refuses to false-green a genuinely-gone or below-floor element, all TDD-built.**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-05-31T01:28:36Z
- **Completed:** 2026-05-31T01:32:15Z
- **Tasks:** 3
- **Files modified:** 5 created

## Accomplishments
- `types.ts` contracts (Fingerprint, CandidateDescriptor, ScoredCandidate, Decision, NoHealReason, HealEvent) that capture, candidate-finder, rebind, and reporter (plan 04) build against directly, with no Playwright/fs dependency.
- Pure weighted `score(fingerprint, candidate) -> [0,1]`: identity signals (test-id, role, accessible name) weighted above volatile ones (ordinal, neighbour signature, class tokens); fuzzy text similarity via hand-rolled token overlap + Levenshtein; deterministic and bounded.
- Pure `decide(scored[], floor) -> Decision`: empty -> `no-candidates`; best below floor -> `below-floor` (the false-green guard, T-02-01/D-09); clear winner heals to its `uniqueSelector`; runner-up score retained for the Phase 2 margin gate.
- 15 matching tests green (7 scorer, 8 decision); 26 total across the repo; `tsc --noEmit` clean; zero Playwright/fs imports in `src/matching`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Define pure matching contracts** - `41ea267` (feat)
2. **Task 2: Pure weighted scorer** - `1c6a672` (test, RED) -> `94646bb` (feat, GREEN)
3. **Task 3: Pure heal-decision with conservative floor** - `d3d8ed8` (test, RED) -> `9dd4310` (feat, GREEN)

_TDD tasks 2 and 3 each have a RED test commit followed by a GREEN implementation commit._

## Files Created/Modified
- `src/matching/types.ts` - Pure shared contracts for the matching core and downstream tiers.
- `src/matching/scoring.ts` - Deterministic weighted scorer with named weight table and exported per-signal scorers (textSimilarity, levenshtein, exactSimilarity, attrsSimilarity).
- `src/matching/scoring.test.ts` - Scorer suite: identity-weighting, weak/disjoint lows, determinism, [0,1] bounds, normalized-text partial-drift.
- `src/matching/decision.ts` - Floor-gated heal/no-heal decision; non-mutating sort; exhaustive discriminated union.
- `src/matching/decision.test.ts` - Decision suite: no-candidates, removed-element/below-floor refusal, clear winner, ordering, inclusive floor, ambiguous-duplicates (Phase 1 top-pick + runner-up retained).

## Decisions Made
- **Signals absent on both sides do not participate** in the weighted average, so an empty test-id or missing attrs never drags an otherwise-strong match toward 0. This makes identity-weighted matching robust when capture omits a signal.
- **Inclusive floor** (`score >= floor` heals). A candidate exactly at the conservative threshold is healable; everything strictly below refuses.
- **`HealEvent.runnerUpScore` is captured now** (omitted only when there is a single candidate) so the Phase 2 second-best margin gate can be added without reworking the `Decision` contract. `NoHealReason` already reserves `ambiguous` for that gate.
- **No refactor-only commit** for tasks 2/3: the GREEN implementations already extract the weight table to named constants and keep the union exhaustive, satisfying the plan's refactor goal within the GREEN commit.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None. The MVP+TDD gate held: both behavior-adding tasks went RED (failing import, no tests run) before implementation, then GREEN. CRLF line-ending warnings from git on Windows are cosmetic and do not affect content.

## Threat Surface
No new security surface beyond the plan's threat model. T-02-01 (false green) and T-02-02 (scorer determinism) are mitigated in code and proven by tests; T-02-03 (types-only, PII at capture) unchanged. `src/matching` imports nothing from Playwright, fs, or the network.

## Known Stubs
None. Both modules are fully implemented and exercised by tests; no placeholder data paths.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Contracts (`types.ts`) are ready for plan 04 (capture, candidate-finder, rebind) and the reporter to consume directly.
- The scorer's `SIGNAL_WEIGHTS` and the decision's floor are the calibration surface for Phase 2; the margin gate slots into `decide` using the already-retained runner-up score and the reserved `ambiguous` reason.
- No blockers. The live locator-rebind hook (phase blocker) is unaffected by this pure-core plan.

## Self-Check: PASSED

All 5 source files and the SUMMARY exist; all 5 task commits (41ea267, 1c6a672, 94646bb, d3d8ed8, 9dd4310) present in git log.

---
*Phase: 01-thinnest-real-heal*
*Completed: 2026-05-31*
