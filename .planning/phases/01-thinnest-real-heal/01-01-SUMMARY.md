---
phase: 01-thinnest-real-heal
plan: 01
subsystem: package-skeleton + config
tags: [scaffold, build, tsdown, vitest, playwright, config, zod, tdd]
requires: []
provides:
  - selfmend package skeleton (dual ESM/CJS + .d.ts via tsdown)
  - validated config single-source-of-truth (configSchema, defaultConfig, SelfmendConfig)
  - offline HTML fixture app (index.html + broken.html)
affects:
  - all downstream Phase 1 plans (config + fixtures consumed by capture/heal/reporter)
tech-stack:
  added:
    - "typescript@^6 (6.0.3)"
    - "tsdown@^0.22 (0.22.1)"
    - "vitest@^4 (4.1.7)"
    - "@playwright/test@^1.60 (1.60.0, dev) + peerDependency >=1.42"
    - "zod@^4 (4.4.3)"
    - "picocolors@^1 (1.1.1)"
    - "publint@^0.3, @arethetypeswrong/cli@^0.18 (publish-safety gates)"
  patterns:
    - "Dual-package exports map with per-format types (.d.mts/.d.cts) — attw + publint clean"
    - "Config defaults derived via configSchema.parse({}) so defaults can never drift from the schema"
    - "Vitest scoped to src/**/*.test.ts (pure logic); Playwright runner reserved for browser integration"
key-files:
  created:
    - package.json
    - tsconfig.json
    - tsdown.config.ts
    - vitest.config.ts
    - playwright.config.ts
    - .gitignore
    - src/index.ts
    - src/config/schema.ts
    - src/config/schema.test.ts
    - src/config/defaults.ts
    - tests/fixture-app/index.html
    - tests/fixture-app/broken.html
  modified: []
decisions:
  - "D-01/D-02: package + import path named selfmend"
  - "D-08: enabled defaults to true (on-by-default healing)"
  - "D-09: threshold defaults to 0.9 (conservative; calibration deferred to Phase 2, assumption A2)"
  - "testIdAttr defaults to data-testid"
  - "Exports map fixed to tsdown's actual output (.mjs/.cjs); per-format type conditions for correct CJS+ESM resolution"
metrics:
  duration_min: 3
  completed: 2026-05-31
  tasks: 2
  files: 12
---

# Phase 1 Plan 01: Package Skeleton + Config Layer Summary

Stood up the `selfmend` dual ESM/CJS package (peerDependency on `@playwright/test`, runtime deps zod+picocolors, no postinstall, fully offline) plus a test-first, zod-validated config layer (CFG-01: on-by-default `enabled`, conservative `0.9` `threshold`, `data-testid` test-id attr) and the offline HTML fixture app every Phase 1 integration test will run against.

## What Was Built

- **Build/test toolchain:** `package.json` with a dual-package `exports` map, `tsconfig` (`strict`, `nodenext`, declarations), `tsdown.config.ts` (ESM+CJS+`.d.ts`, `@playwright/test` never bundled), `vitest.config.ts` (pure-logic scope), `playwright.config.ts` (single-worker chromium, offline `file://`), `.gitignore`.
- **Config module (TDD):** `src/config/schema.ts` (zod `configSchema` + inferred `SelfmendConfig`), `src/config/defaults.ts` (`defaultConfig` derived from the schema), `src/config/schema.test.ts` (11 tests).
- **Fixture app:** `tests/fixture-app/index.html` (stable Submit button: text + `data-testid="submit-btn"` + role + class + aria-label, plus a `control-only` element) and `broken.html` (same semantic button with primary selector mutated to `primary-action`/`btn-cta`; `control-only` deliberately absent for the future no-false-green test).

## TDD Gate Compliance

RED → GREEN sequence verified in git history for the `tdd="true"` task:
- RED: `5d1c7ff` test(01-01) — suite failed (modules absent), confirmed before implementing.
- GREEN: `765124a` feat(01-01) — 11/11 tests pass.
- REFACTOR: none needed; schema already extracts shared constraints (`thresholdSchema`, named default constants) with readable messages. No churn-only commit made.

## Verification

- `pnpm exec vitest run src/config` → 11 passed.
- package.json build check → peerDependency (not dependency) on `@playwright/test`, no postinstall, `exports` present.
- `pnpm exec tsc --noEmit` clean; `pnpm exec tsdown` builds dist (ESM+CJS+d.mts+d.cts).
- `publint` → All good; `attw --pack` → No problems (green node10 / node16-CJS / node16-ESM / bundler).
- Both fixture HTML files exist and are offline-openable.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Exports map pointed at non-existent files**
- **Found during:** Task 2 (post-build validation).
- **Issue:** Plan/initial `exports` used `dist/index.js` and a single `dist/index.d.ts`, but tsdown emits `index.mjs` (ESM), `index.cjs` (CJS), and per-format `index.d.mts`/`index.d.cts`. Consumers would fail to resolve the package and types would masquerade.
- **Fix:** Rewrote `exports` with per-condition `import`/`require` blocks each carrying the correct `types` + `default`; updated `main`/`module`/`types`. Verified with `publint` + `attw` (both clean).
- **Files modified:** package.json
- **Commit:** 765124a

**2. [Rule 3 - Blocking] tsdown `external` option deprecated**
- **Found during:** Task 2 build.
- **Issue:** `external: [...]` emitted a deprecation warning in tsdown 0.22.
- **Fix:** Switched to `deps.neverBundle: ["@playwright/test"]` — same effect (peer stays unbundled, T-01-03), no warning.
- **Files modified:** tsdown.config.ts
- **Commit:** 765124a

## Authentication Gates

None.

## Known Stubs

None blocking. The selfmend reporter registration in `playwright.config.ts` is a documented commented-out placeholder, intentionally deferred to plan 01-05 per the plan text.

## Threat Flags

None. All trust boundaries in the plan's threat register were mitigated as planned: supply-chain gate cleared (Task 0, user-approved), config validated via zod (T-01-01), no network in any npm script (T-01-02), `@playwright/test` declared peer-only and confirmed unbundled (T-01-03).

## Commits

- `1055495` feat(01-01): scaffold dual ESM/CJS selfmend package + framework configs + offline fixture app
- `5d1c7ff` test(01-01): add failing config schema suite (CFG-01 RED)
- `765124a` feat(01-01): implement zod config schema + defaults (CFG-01 GREEN) + exports fix

## Self-Check: PASSED

All 12 created files exist on disk; all 3 task commits (1055495, 5d1c7ff, 765124a) present in git history.
