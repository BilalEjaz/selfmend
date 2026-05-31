---
phase: 01-thinnest-real-heal
plan: 03
subsystem: testing
tags: [playwright, proxy, locator, timeout, spike, self-heal, rebind]

requires:
  - phase: 01-thinnest-real-heal (01-01)
    provides: dual-package selfmend skeleton, playwright.config, offline fixture-app (index.html + broken.html)
provides:
  - "PROVEN live-rebind mechanism against @playwright/test 1.60: catch errors.TimeoutError, rebind to fresh page.locator(newSel), replay green"
  - "Confirmed Proxy re-wraps chained locators (getByRole(...).first()) without breaking strict-mode/auto-wait"
  - "Confirmed expect(locator) matchers bypass the heal path (assertions stay sacred)"
  - "Measured + bounded timeout-budget split (real attempt vs heal replay)"
  - "spike/FINDINGS.md: the locked timing/mechanics contract plan 04 implements"
affects: [01-04, integration, locator-proxy, fixture, rebind]

tech-stack:
  added: []
  patterns:
    - "Proxy-over-real-Locator: ACTION set heals-on-TimeoutError, CHAIN set re-wraps, everything else passes through"
    - "Two-budget timeout split: explicit timeout on real attempt + separate bounded replay timeout"

key-files:
  created:
    - spike/rebind-spike.spec.ts
    - spike/FINDINGS.md
    - spike/playwright.config.ts
  modified: []

key-decisions:
  - "Rebind = fresh page.locator(newSelector) (cannot reuse an ElementHandle, PW issue #10571); replay the action on it"
  - "TimeoutError detection: err instanceof errors.TimeoutError OR err.name === 'TimeoutError'; never pre-check count()"
  - "Timeout budget: explicit {timeout} on the real attempt + separate short replay budget; heal overhead measured at ~4% of the real attempt"
  - "Assertions need no special-casing: expect() routes through matchers, not the wrapped ACTION set, so scoping ACTION to real action methods keeps assertions sacred by construction"

patterns-established:
  - "Method-set partition: ACTION (heal) vs CHAIN (re-wrap) vs assertion-exclusion (pass-through)"
  - "Uniqueness gate (count()===1) on candidate selectors, but acceptance gated on score/floor — never on count alone"

requirements-completed: [HEAL-01, HEAL-02]

duration: 7min
completed: 2026-05-31
---

# Phase 01 Plan 03: Throwaway Rebind Spike Summary

**Proved on @playwright/test 1.60 that a wrapped click can catch the real errors.TimeoutError on a renamed selector and replay green via a fresh page.locator, that the Locator Proxy re-wraps chained locators, that assertions never reach the heal path, and that the heal overhead is ~4% of the real attempt — all locked into spike/FINDINGS.md for plan 04.**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-05-31T01:33Z
- **Completed:** 2026-05-31T01:40:35Z
- **Tasks:** 2
- **Files modified:** 3 (all in throwaway spike/)

## Accomplishments
- PROOF 1: wrapped `click()` on the renamed `[data-testid="submit-btn"]` (renamed to `primary-action` in broken.html) auto-waits to timeout, catches `errors.TimeoutError` with NO pre-check of `count()`, rebinds to a fresh `page.locator('[data-testid="primary-action"]')`, and replays green.
- PROOF 2: a chained `getByRole('button',{name}).first()` returns a re-wrapped Proxy that still heals; strict-mode and auto-wait intact; healed element passes `toBeVisible()`.
- PROOF 3: `expect(wrapped).toBeVisible()` against a missing element fails normally and never invokes the heal hook (assertions stay sacred).
- PROOF 4: measured the timeout-budget split — real attempt 1207ms, heal enumeration+replay 48ms, total 1255ms; heal is ~4% of the real attempt and bounded.
- SANITY: the same wrapper on the un-mutated baseline fires ZERO heals (HEAL-02: no premature heal on the green hot path).
- `spike/FINDINGS.md` records the copy-ready contract for plan 04: detection idiom, two-budget strategy with numbers, ACTION/CHAIN/assertion method partition, rebind selector approach, prior-art gotchas.

## Task Commits

1. **Task 1: Spike — catch TimeoutError + replay, chained-Proxy re-wrap, assertion exclusion** - `2e0f22c` (test)
2. **Task 2: Measure timeout budget + record FINDINGS** - `3891901` (docs)

_Note: this is throwaway spike code; both commits live under spike/, which is deleted once plan 04 consumes FINDINGS.md._

## Files Created/Modified
- `spike/rebind-spike.spec.ts` - Throwaway proof harness: Proxy-over-Locator wrapper + 5 tests (PROOF 1–4 + SANITY). PROVEN green on PW 1.60.
- `spike/FINDINGS.md` - Durable locked decisions feeding plan 04 (detection idiom, budget numbers, method partition, rebind approach, prior-art gotchas).
- `spike/playwright.config.ts` - Throwaway spike-local config (testDir: ".") so the spike runs without polluting the production config.

## Decisions Made
- Rebind produces a fresh selector string and calls `page.locator()` (ElementHandle->Locator is impossible, PW issue #10571).
- Detect TimeoutError via `instanceof errors.TimeoutError` OR `name === 'TimeoutError'`; never pre-check `count()` (the prior-art HEAL-02 violation).
- Two-budget timeout: explicit `{timeout}` on the real attempt + a separate bounded replay budget; net per-healed-action bound ≈ `realTimeout + replayTimeout`.
- Assertions need no special handling — they route through `expect` matchers, not the wrapped ACTION set, so they stay sacred by construction.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Spike not discoverable under root testDir; added spike-local playwright config**
- **Found during:** Task 1 (running the spike)
- **Issue:** Root `playwright.config.ts` pins `testDir: "tests"`, so `npx playwright test spike/rebind-spike.spec.ts` returned "No tests found". The plan's verify command could not run.
- **Fix:** Added `spike/playwright.config.ts` (`testDir: "."`) and ran via `npx playwright test --config=spike/playwright.config.ts`. Keeps the production config untouched; throwaway file deleted with spike/.
- **Files modified:** spike/playwright.config.ts
- **Verification:** 5 tests discovered and pass.
- **Committed in:** 2e0f22c (Task 1 commit)

**2. [Rule 3 - Blocking] __dirname undefined in ESM scope**
- **Found during:** Task 1 (first run)
- **Issue:** package.json has `"type": "module"`; the spec used `__dirname` to build file:// fixture URLs, throwing `ReferenceError: __dirname is not defined`.
- **Fix:** Replaced with ESM-safe `dirname(fileURLToPath(import.meta.url))`.
- **Files modified:** spike/rebind-spike.spec.ts
- **Verification:** Spec loads and all tests pass.
- **Committed in:** 2e0f22c (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 3 - blocking config/runtime issues)
**Impact on plan:** Both were mechanical blockers to running the spike; neither changes the proven mechanism or scope. No scope creep.

## Issues Encountered
None beyond the two blocking issues above. The rebind mechanism worked exactly as 01-RESEARCH.md predicted on the first green run.

## User Setup Required
None - no external service configuration required. The spike runs fully offline against file:// fixtures.

## Next Phase Readiness
- The riskiest unknown (the live locator-rebind hook) is **PROVEN** on the real engine. The phase-1 blocker logged in STATE.md ("Live locator-rebind mechanics flagged for a spike") is resolved.
- Plan 04 implements directly against `spike/FINDINGS.md`: the ACTION/CHAIN/assertion method partition, the TimeoutError detection idiom, the two-budget timeout strategy with measured numbers, and the fresh-page.locator rebind with uniqueness + floor gating.
- `spike/` is throwaway and slated for deletion once plan 04 consumes FINDINGS.md.

## Self-Check: PASSED
- spike/rebind-spike.spec.ts — FOUND
- spike/FINDINGS.md — FOUND
- spike/playwright.config.ts — FOUND
- Commit 2e0f22c — FOUND
- Commit 3891901 — FOUND

---
*Phase: 01-thinnest-real-heal*
*Completed: 2026-05-31*
