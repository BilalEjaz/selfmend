---
phase: 05-runner-agnostic-core
plan: 01
subsystem: testing
tags: [playwright, locator-proxy, weakmap, zod, runner-agnostic, self-healing]

# Dependency graph
requires:
  - phase: 01-thinnest-real-heal
    provides: wrapLocator + HealContext + createOccurrenceCounter (the seam generalized here)
  - phase: 03-persistence-parallel-worker-safety
    provides: occurrence-key + describeArgs identity (preserved byte-identical)
provides:
  - Public wrapPage(page, { store, config?, onHeal?, scope? }) returning a bare wrapped Page
  - resetScope(page) WeakMap-backed explicit occurrence reset for same-scope retries
  - HealContext with pluggable emit(SelfmendEvent) + (suite,test) scope source (no testInfo)
  - createScopeController (live scope, coarse default, auto-reset, explicit reset) + resolveConfig merge
  - Public exports: wrapPage, resetScope, BaselineStore, SelfmendEvent/HealedEvent/RefusedEvent
affects: [05-02-fixture-refactor, phase-06-persistence-output, phase-07-docs-recipes]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pluggable transport seam: HealContext.emit decouples the core from @playwright/test"
    - "WeakMap side-table keyed by the returned proxy preserves a bare-Page return while attaching per-page state"
    - "Live identity source read per locator creation (scope()) instead of a value captured once"

key-files:
  created:
    - src/integration/wrap-page.ts
    - src/integration/scope-lifetime.test.ts
    - src/integration/config-merge.test.ts
    - src/integration/emit-seam.test.ts
  modified:
    - src/integration/locator-proxy.ts
    - src/integration/fixture.ts
    - src/index.ts
    - src/integration/occurrence.test.ts
    - src/integration/step-identity.test.ts

key-decisions:
  - "emit is guarded on BOTH the refused and the healed path so a throwing/rejecting emit never suppresses the original error nor fails a successful heal (D-08/T-05-01)"
  - "resolveConfig parses the partial directly through configSchema (all keys default) — equivalent to a merge over defaultConfig but with schema validation in one step"
  - "Raw-mode replayTimeoutMs fixed at 5000ms (no testInfo.timeout to mirror outside the fixture)"
  - "PAGE_LOCATOR_FACTORIES exported from fixture.ts so the fixture and wrapPage share one factory surface (WRAP-04 single source of truth)"

patterns-established:
  - "Scope-lifetime controller: tracks last-seen (suite,test) tuple, rebuilds the occurrence counter on change, exposes explicit reset"
  - "Fire-and-forget onHeal: call but never await, swallow throw + rejected promise"

requirements-completed: [WRAP-01, WRAP-02, WRAP-03]

# Metrics
duration: 14min
completed: 2026-06-02
---

# Phase 5 Plan 01: Runner-Agnostic Core Seam Summary

**Public `wrapPage(page, opts)` + `resetScope(page)` over a refactored `HealContext` that swaps `testInfo`/`testFile`/`testTitle` for a pluggable `emit(SelfmendEvent)` and a live `(suite, test)` scope source, with byte-identical store keys and the pure matching core untouched.**

## Performance

- **Duration:** ~14 min
- **Started:** 2026-06-02T11:00:56Z
- **Completed:** 2026-06-02T11:14:00Z
- **Tasks:** 3 (2 TDD)
- **Files modified:** 9 (4 created, 5 modified)

## Accomplishments
- Lifted the internal page-wrapping seam into a public runner-agnostic core: `wrapPage(page, { store, config?, onHeal?, scope? })` returns the BARE wrapped Page (drop-in), with a sibling WeakMap-backed `resetScope(page)`.
- Refactored `HealContext` to carry a pluggable best-effort `emit(SelfmendEvent)` and a `(suite, test)` scope source; the core no longer imports or references the Playwright test-info object (`grep -L "testInfo"` lists `locator-proxy.ts` = zero matches).
- Built the scope-lifetime controller test-first: live `scope()` read per locator creation, coarse `{suite:"",test:""}` default, auto-reset on tuple change, explicit reset for retries, and a throwing-`scope()` fail-safe.
- Preserved the cross-run key `suite :: test :: selector :: occurrence` byte-identical (`spec.ts suite > case page.locator(button) 0`), so committed baselines keep matching; the `@playwright/test` fixture maps `suite=testInfo.file`, `test=titlePath` exactly as before.
- The pure matching core (`scoring.ts`, `decision.ts`, `types.ts`) is byte-untouched (`git diff --stat src/matching/` empty); full suite stays green at 141 vitest tests; `tsc --noEmit` clean; package build OK.

## Task Commits

Each task was committed atomically:

1. **Task 1: Scope-lifetime controller + config merge (TDD)** — `ccbb141` (test, RED) → `73eab4b` (feat, GREEN)
2. **Task 2: HealContext emit + scope seam (TDD)** — `f8c5d23` (test, RED) → `6a1f814` (feat, GREEN)
3. **Task 3: Public wrapPage + resetScope + exports** — `13ab2fc` (feat)

## Files Created/Modified
- `src/integration/wrap-page.ts` — NEW. `createScopeController`, `resolveConfig`, public `wrapPage`, `resetScope`, and the `WrapPageOptions`/`Scope`/`ScopeSource` types.
- `src/integration/locator-proxy.ts` — `HealContext` drops `testInfo`/`testFile`/`testTitle`, adds `emit` + `suite`/`test`; `wrapLocator` keys from `ctx.suite`/`ctx.test`; refused/healed events emitted via guarded `ctx.emit`.
- `src/integration/fixture.ts` — builds `emit` from `attachHealEvent`/`attachRefusedEvent`, maps `suite=testInfo.file` / `test=titlePath`; exports `PAGE_LOCATOR_FACTORIES`.
- `src/index.ts` — exports `wrapPage`, `resetScope`, `WrapPageOptions`/`Scope`/`ScopeSource`, `BaselineStore`, and `SelfmendEvent`/`HealedEvent`/`RefusedEvent`.
- `src/integration/scope-lifetime.test.ts`, `src/integration/config-merge.test.ts`, `src/integration/emit-seam.test.ts` — NEW unit coverage.
- `src/integration/occurrence.test.ts`, `src/integration/step-identity.test.ts` — migrated to the emit + scope shape, asserting byte-identical keys.

## Decisions Made
- `emit` is guarded on BOTH the refused and the healed path. The pre-refactor code only guarded the refused-attach; extending the guard to the healed-emit is a correctness requirement (a throwing `onHeal` must not turn a successful heal into a failure) — D-08 / T-05-01.
- `resolveConfig` parses the partial straight through `configSchema` (every key has a `.default()`), which is equivalent to a merge over `defaultConfig` while validating out-of-range values in one step.
- Raw-mode `replayTimeoutMs` fixed at 5000ms (no `testInfo.timeout` outside the fixture).

## Deviations from Plan

None - plan executed exactly as written. The healed-path emit guard (above) is the intended D-08 best-effort invariant, not an unplanned change.

## Issues Encountered
- The `grep -L "testInfo"` proof initially failed because three doc-comments still contained the literal token `testInfo`. Reworded the comments (to "the Playwright test-info object" / "from the test file path") so the core has zero `testInfo` matches while keeping the docs accurate. No code behaviour changed.
- A `noUncheckedIndexedAccess` TS error on `events[0].kind` in the emit-seam test — fixed with optional chaining (`events[0]?.kind`).

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- The seam Plan 05-02 sits on is ready: `wrapPage`/`HealContext.emit`/scope source are public and tested. Plan 05-02 refactors the `@playwright/test` fixture fully onto this core (WRAP-04 zero-behaviour-change), with the existing 141 unit + e2e suite as the regression gate. The fixture is already partly migrated here (it builds `emit` and maps `suite`/`test`), so 05-02 is a consolidation, not a rewrite.
- D-11 never-false-green in raw mode (a deliberately-wrong `scope()` yields a missed heal, not a wrong heal) is still to be CONTROL-tested in raw mode in Plan 05-02 per CONTEXT; the invariant itself is unchanged (lives in the pure `decide()`).

## Self-Check: PASSED
- All 4 created files exist on disk.
- All 5 task commits (`ccbb141`, `73eab4b`, `f8c5d23`, `6a1f814`, `13ab2fc`) exist in git history.
- Verification gate green: 23 plan-named tests + 141 full-suite tests pass, `tsc --noEmit` clean, `grep -L "testInfo" src/integration/locator-proxy.ts` lists the file (zero matches), `git diff --stat src/matching/` empty.

---
*Phase: 05-runner-agnostic-core*
*Completed: 2026-06-02*
