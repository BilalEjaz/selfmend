---
phase: 05-runner-agnostic-core
plan: 02
subsystem: testing
tags: [playwright, fixture, wrap-page, runner-agnostic, never-false-green, raw-mode]

# Dependency graph
requires:
  - phase: 05-runner-agnostic-core
    provides: public wrapPage(page, opts) + HealContext.emit + (suite,test) scope source (05-01)
provides:
  - The @playwright/test fixture refactored onto the shared wrapPage core (single code path, WRAP-04)
  - Optional WrapPageOptions.replayTimeoutMs so the adapter passes its test-timeout-mirrored replay budget through
  - tests/wrap-page.spec.ts raw-mode integration proof (heal-green + wrong-scope/absent-element controls + throwing onHeal/scope fail-safe)
affects: [phase-06-persistence-output, phase-07-docs-recipes]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Adapter-over-core: the @playwright/test fixture is one thin adapter (scope=suite:file/test:titlePath, onHeal=testInfo.attach) over the public wrapPage, no parallel proxy/heal copy"
    - "Raw-mode never-false-green is control-tested directly on a launched-Chromium page outside the runner"

key-files:
  created:
    - tests/wrap-page.spec.ts
  modified:
    - src/integration/fixture.ts
    - src/integration/wrap-page.ts

key-decisions:
  - "Added an optional WrapPageOptions.replayTimeoutMs so the fixture passes its exact Math.min(testInfo.timeout,5000) budget through the public core, keeping per-action timing byte-identical (raw adopters still get the fixed 5000ms default)"
  - "The fixture's page override now delegates wholesale to wrapPage(page, {store, config, onHeal, scope, replayTimeoutMs}); the internal wrapPage(realPage, nextOccurrence, makeCtx) proxy and the per-test occurrence counter it owned are deleted (the core owns them now)"

patterns-established:
  - "scope=() => ({ suite: testInfo.file, test: testInfo.titlePath.join(' > ') }) reproduces the pre-refactor store keys byte-for-byte"
  - "onHeal as the adapter emit: dispatch SelfmendEvent to attachHealEvent/attachRefusedEvent keyed on event.kind for byte-identical attachments"

requirements-completed: [WRAP-04, WRAP-01]

# Metrics
duration: 9min
completed: 2026-06-02
---

# Phase 5 Plan 02: Fixture Refactor onto the Shared Core (WRAP-04) Summary

**The `@playwright/test` fixture is now one thin adapter over the public `wrapPage` core (scope=suite:file/test:titlePath, onHeal=testInfo.attach), with byte-identical keys, attachments, and boxed reporter output proven by the unchanged 141 unit + 23 e2e suite, plus a new raw-mode integration spec that proves heal-green, never-false-green under a wrong/absent scope, and fail-safe behaviour under a throwing onHeal/scope on a launched-Chromium page outside the runner.**

## Performance

- **Duration:** ~9 min
- **Tasks:** 2 (1 refactor, 1 integration spec)
- **Files modified:** 3 (1 created, 2 modified)

## Accomplishments
- Refactored `fixture.ts` so the `page` override delegates wholesale to the public `wrapPage` core, a SINGLE code path (WRAP-04). The internal `wrapPage(realPage, nextOccurrence, makeCtx)` proxy and the per-test occurrence counter the fixture used to own are deleted; the core now builds the occurrence counter, the auto-resetting scope-lifetime controller, and the locator-proxy heal loop.
- The adapter supplies the two @playwright/test-specific seams: `scope = () => ({ suite: testInfo.file, test: testInfo.titlePath.join(" > ") })` (the exact old testFile/testTitle mapping, so store keys `suite :: test :: selector :: occurrence` are byte-identical, D-09) and `onHeal` = the existing `testInfo.attach` path (`attachHealEvent`/`attachRefusedEvent` keyed on `event.kind`, so the `selfmend-heal` attachment name and bodies are byte-identical, D-08).
- Added an optional `WrapPageOptions.replayTimeoutMs` so the adapter passes its `Math.min(testInfo.timeout, 5000)` budget through, keeping the per-action wall-clock budget byte-identical; raw adopters still get the fixed 5000ms raw-mode default.
- WRAP-04 HARD GATE met: `npx vitest run` 141 passed, `npx playwright test` 23 (pre-existing) + 5 (new) = 28 passed, and the boxed reporter output is identical to before (3 locators healed: `page.locator(.btn-primary) -> [data-testid="submit-btn"]` @ 1.00 across heal/offline/report specs; 1 could-not-heal: ambiguous-no-heal @ best 1.00).
- Added `tests/wrap-page.spec.ts`: a raw-mode integration proof driving a launched-Chromium `page` (NOT the healingFixture) through the public `wrapPage` with an in-process `BaselineStore`, heal-green (onHeal gets a `kind:"healed"` event naming the stable testid), wrong-scope control (no heal, fails normally), absent-element control (no heal, fails normally), throwing-onHeal fail-safe (still heals green, throw swallowed), throwing-scope() fail-safe (coarse-default fallback, run proceeds).
- Pure matching core (`scoring.ts`, `decision.ts`, `types.ts`, all of `src/matching/`) byte-untouched (`git diff --stat src/matching/` empty); `tsc --noEmit` clean.

## Task Commits

Each task was committed atomically:

1. **Task 1: Refactor the fixture onto the shared wrapPage core**, `7cc2f3a` (refactor)
2. **Task 2: Raw-mode wrap-page integration proof**, `10546e2` (test)

## Files Created/Modified
- `tests/wrap-page.spec.ts`, NEW. 5 raw-mode cases (heal-green, wrong-scope control, absent-element control, throwing onHeal, throwing scope) driving `wrapPage` on a launched-Chromium page; one browser launched in `beforeAll`, closed in `afterAll`; each test opens its own context/page.
- `src/integration/fixture.ts`, the `page` override delegates to the public `wrapPage` with `scope`/`onHeal`/`replayTimeoutMs`; the internal `wrapPage`/`makeCtx` proxy removed; now imports `wrapPage` from `wrap-page.js` and drops the `wrapLocator`/`createOccurrenceCounter`/`HealContext`/`Locator`/`Page` imports it no longer needs.
- `src/integration/wrap-page.ts`, `WrapPageOptions` gains an optional `replayTimeoutMs`; `wrapPage` uses `opts.replayTimeoutMs ?? RAW_REPLAY_TIMEOUT_MS` for the per-action replay cap.

## Decisions Made
- **Pass-through replay budget over a fixed raw default.** The pre-refactor fixture capped the replay at `Math.min(testInfo.timeout, 5000)`; the public core hard-codes 5000. With the default 30000ms test timeout both resolve to 5000, so behaviour was already identical, but I made `replayTimeoutMs` an explicit adapter option so the fixture stays byte-identical even under a project that sets a sub-5000ms test timeout. This is a correctness requirement for the zero-behaviour-change gate (D-10), not a feature.

## Deviations from Plan

None - plan executed exactly as written. The `replayTimeoutMs` adapter option (above) is the intended mechanism for the D-10 byte-identical-timing requirement, not an unplanned change.

## Issues Encountered
- The refactor introduces a value-level import cycle (`fixture.ts` imports `wrapPage` from `wrap-page.ts`; `wrap-page.ts` imports `PAGE_LOCATOR_FACTORIES`/`buildPageSelector` from `fixture.ts`). It resolves cleanly because every cross-module reference is used at call-time (inside the `page` fixture callback / inside the proxy get-trap), not at module-init time, `tsc` is clean and the full suite is green.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- WRAP-04 is closed: the fixture and the runner-agnostic core are one code path, proven by the unchanged regression suite. Phase 6 (standalone `loadBaseline`/`saveBaseline`/`mergeBaselines` + `onHeal`-driven persistence + `renderHealSummary`) can build on the now-public `wrapPage` + `BaselineStore` surface; the raw-mode spec already constructs an in-process store and would extend naturally to a load/save round-trip.

## Self-Check: PASSED
- `tests/wrap-page.spec.ts` exists on disk.
- Both task commits (`7cc2f3a`, `10546e2`) exist in git history.
- Verification gate green: `tsc --noEmit` clean, `npx vitest run` 141 passed, `npx playwright test` 28 passed (23 pre-existing unchanged + 5 new), boxed reporter output byte-identical, `git diff --stat src/matching/` empty.

---
*Phase: 05-runner-agnostic-core*
*Completed: 2026-06-02*
