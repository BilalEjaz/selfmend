---
phase: 01-thinnest-real-heal
plan: 05
subsystem: reporter, public-entry
tags: [playwright, reporter, picocolors, public-entry, import-swap, install, readme]

# Dependency graph
requires:
  - phase: 01-04
    provides: healingFixture, HealEvent + selfmend-heal attachment transport, BaselineStore, live heal loop
  - phase: 01-01
    provides: package skeleton, dual ESM/CJS exports map, config schema + defaults
provides:
  - "Summary-only Reporter (REP-01): onTestEnd collects selfmend-heal attachments, onEnd renders a boxed picocolors block; never heals (D-05)"
  - "Public selfmend entry (D-02/D-03): re-exported healing test + unchanged expect for a true one-line import swap"
  - "Composable healingFixture export (D-04) + SelfmendConfig type + SelfmendReporter + HealEvent transport on the public surface"
  - "Integration proofs: boxed summary lists a real heal (REP-01); import swap runs an unchanged test green (INST-01/INST-02)"
  - "README: zero-friction install, one-line import swap, reporter wiring, enabled/threshold config, offline/no-telemetry framing"
affects: [phase-2-reporter-margin-column, phase-4-publish]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Reporter is summary-only by construction (D-05): reads testInfo attachments, has no page/DOM access, cannot rebind — heal/report concerns kept disjoint"
    - "Defensive attachment parsing: malformed selfmend-heal entries are skipped, never crash the run (T-05-02)"
    - "Summary prints derived signals only (original selector + healed target + score), never raw DOM text (T-05-03)"
    - "Named-only public exports: a mixed default+named entry forces CJS consumers onto .default; reporter resolved via the selfmend/reporter subpath"
    - "test = healingFixture re-exported as test; expect re-exported unchanged so the swap is a true drop-in and assertions stay sacred"

key-files:
  created:
    - src/reporter/reporter.ts
    - tests/report.spec.ts
    - tests/install.spec.ts
    - README.md
  modified:
    - src/index.ts
    - playwright.config.ts
    - package.json
    - tsdown.config.ts
  deleted: []

key-decisions:
  - "Reporter never heals (D-05): it reads selfmend-heal attachments in the main process and only renders — the heal loop lives entirely in the plan-04 fixture/proxy, keeping the trust boundary clean"
  - "Boxed block format (D-06): header 'selfmend: N locators healed' plus one indented row per heal (test, original selector, healed target, confidence); margin column deferred to Phase 2 (D-07/REP-02)"
  - "N=0 prints a single dim line rather than an empty box or a crash"
  - "Public entry is named-only (no default export) and adds a selfmend/reporter subpath so import and require both resolve cleanly without .default trip-ups"

requirements-completed: [REP-01, INST-01, INST-02]

# Metrics
duration: 3min
completed: 2026-05-31
---

# Phase 01 Plan 05: Reporter + Public Entry Summary

**Closes the Walking Skeleton loop: a summary-only Reporter aggregates the plan-04 `selfmend-heal` attachments and prints a boxed `selfmend: N locators healed` block at end of run, and the public `selfmend` entry re-exports a healing-extended `test` so a one-line import swap turns on healing with existing tests unchanged — both proven by integration tests and confirmed live by the human checkpoint.**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-05-31T02:58:47+01:00
- **Completed:** 2026-05-31T03:01:39+01:00
- **Tasks:** 3 (2 auto + 1 human-verify checkpoint, approved)
- **Files:** 4 created, 4 modified

## Accomplishments

- `src/reporter/reporter.ts` — a `@playwright/test/reporter` Reporter (default export `SelfmendReporter`) that is SUMMARY-ONLY (D-05). `onTestEnd` reads the `selfmend-heal` attachments off the `TestResult` and collects each `HealEvent`; `onEnd` renders a boxed `picocolors` block (D-06): header `selfmend: N locators healed`, one indented row per heal with test name, original selector, healed target, and confidence score. No margin column in Phase 1 (D-07; that is REP-02). N=0 prints a single dim line; malformed attachments are skipped, not fatal.
- `src/index.ts` — the public `selfmend` entry (D-02). Re-exports the plan-04 `healingFixture` as `test` (D-03 one-line import swap), re-exports `expect` unchanged so the swap is truly one line and assertions stay off the heal path, and exposes `healingFixture` (D-04 composable), `SelfmendConfig` + `configSchema` + `defaultConfig` (CFG-01), `SelfmendReporter`, and the `HealEvent`/`HEAL_ATTACHMENT_NAME`/`attachHealEvent` transport.
- `tests/report.spec.ts` — runs the plan-04 broken-selector heal scenario and asserts the end-of-run output contains the `selfmend: N locators healed` header and a row with the original selector, healed target, and score (REP-01).
- `tests/install.spec.ts` — imports `{ test, expect }` from the local entry, runs a normal `getByRole(...).click()` + `expect(...)` test against the fixture app unchanged, proving the import swap works with no rewrite and assertions are not routed through the heal path (INST-01/INST-02).
- `README.md` — zero-friction install (`npm/pnpm add selfmend`, peer `@playwright/test`), the one-line import swap, adding the reporter to the Playwright config, the `enabled`/`threshold` config (CFG-01), and the offline/no-telemetry guarantee framed as a feature.
- `playwright.config.ts` wired with the reporter; `package.json` exports/`tsdown.config.ts` extended with the `selfmend/reporter` subpath so import and require resolve cleanly.

## Task Commits

1. **Task 1: Summary-only boxed reporter** — `2b38506` (feat) — `src/reporter/reporter.ts`, `playwright.config.ts`, `tests/report.spec.ts`.
2. **Task 2: Public entry + import-swap proof + README** — `f533f0d` (feat) — `src/index.ts`, `tests/install.spec.ts`, `README.md`, `package.json`, `tsdown.config.ts`.
3. **Task 3: Human-verify checkpoint** — APPROVED by the user. Verified live: 6/6 heal+report tests pass; the boxed summary correctly shows the live heal `page.locator(.btn-primary) -> [data-testid="submit-btn"]` at confidence 1.00; the no-false-green control still fails normally.

## Files Created/Modified

- `src/reporter/reporter.ts` — `SelfmendReporter`: `onTestEnd` collects, `onEnd` renders the boxed picocolors summary; box sized to the widest line; plain when colors unsupported.
- `src/index.ts` — public entry: `test` (= healingFixture), `expect`, `healingFixture`, `SelfmendConfig`/`configSchema`/`defaultConfig`, `SelfmendReporter`, `HealEvent` transport.
- `playwright.config.ts` — reporter added to the reporters list.
- `package.json`, `tsdown.config.ts` — `selfmend/reporter` subpath export added.
- `tests/report.spec.ts` — REP-01 boxed-summary integration proof.
- `tests/install.spec.ts` — INST-01/INST-02 import-swap + unchanged-test proof.
- `README.md` — install, import swap, reporter wiring, config, offline framing.

## Decisions Made

- **Reporter never heals (D-05):** healing stays entirely in the plan-04 fixture/proxy; the reporter only reads attachments in the main process and renders. This keeps the heal/report trust boundary disjoint by construction (the reporter has no page or DOM access).
- **Boxed format (D-06), no margin column (D-07):** Phase 1 reports test/original/healed/confidence; the runner-up margin column is Phase 2 (REP-02), enabled by the runner-up score the plan-02 `HealEvent` already retains — no contract change needed.
- **Named-only public exports:** a mixed default+named entry forces CJS consumers onto `.default`; the entry is named-only and the reporter resolves via the `selfmend/reporter` subpath for clean import/require ergonomics.

## Deviations from Plan

None — plan executed exactly as written. Both auto tasks landed as specified, and the human-verify checkpoint was approved without rework.

## Issues Encountered

None. No auto-fix attempts were needed; no fix-attempt limit was approached.

## Threat Surface

All four threats in the plan's register are mitigated in code and exercised by tests:
- **T-05-01** (reporter accidentally healing): reporter is summary-only (D-05) — reads attachments, no DOM/page access, cannot rebind.
- **T-05-02** (malformed selfmend-heal attachment): attachments parsed defensively; malformed entries skipped, the run never crashes.
- **T-05-03** (heal summary leaking page text): summary prints original selector + healed target + score only — derived signals, not raw DOM content.
- **T-05-04** (assertions routed through heal): `tests/install.spec.ts` asserts `expect(...)` does not heal; the plan-04 action-method partition keeps assertions sacred and `expect` is re-exported unchanged.

No new security surface beyond the register.

## Known Stubs

None. The reporter renders real collected `HealEvent`s and the public entry re-exports the live plan-04 fixture; the checkpoint confirmed a real heal rendered in the boxed summary end-to-end.

## User Setup Required

None — fully offline, no external service, no API key.

## Next Phase Readiness

- Phase 1 (Thinnest Real Heal) is complete: install + one-line import swap, capture, pure-scored match through the conservative floor, live rebind, and a boxed console summary — all offline on a single-worker case.
- Phase 2 adds the margin gate (MATCH-03) and the REP-02 margin column to this reporter, plus configurable floor/margin (CFG-02); the `HealEvent` already carries the runner-up score the column needs.
- Phase 4 publishing reuses this README's zero-friction install section and the dual ESM/CJS exports (now including the `selfmend/reporter` subpath).
- No blockers.

## Self-Check: PASSED

All 4 created files exist (`src/reporter/reporter.ts`, `tests/report.spec.ts`, `tests/install.spec.ts`, `README.md`) and 4 modified files updated (`src/index.ts`, `playwright.config.ts`, `package.json`, `tsdown.config.ts`). Both plan commits present in git log (`2b38506`, `f533f0d`). Human checkpoint approved: 6/6 heal+report tests pass, boxed summary shows the live heal at confidence 1.00, no-false-green control still fails.

---
*Phase: 01-thinnest-real-heal*
*Completed: 2026-05-31*
