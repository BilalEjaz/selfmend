---
phase: 07-recipes-docs
plan: 01
subsystem: docs
tags: [examples, recipes, type-check, ci, single-source-of-truth, offline]
requires:
  - "Phase 5 public wrapPage(page, { store, config?, onHeal?, scope? }) + resetScope(page)"
  - "Phase 6 loadBaseline/saveBaseline/mergeBaselines + renderHealSummary public exports"
  - "src/index.ts published export surface (values + types)"
  - "package.json exports map (selfmend self-resolves after build)"
provides:
  - "examples/{plain-script,cucumber,mocha-jest}.ts: three compilable recipes that import ONLY the published selfmend API (DOC-01 engineering half)"
  - "examples/shims/frameworks.d.ts: type-only Cucumber/Mocha/Jest shim, zero new dependency"
  - "tsconfig.examples.json + scripts/check-examples.mjs + check:examples npm script (ROADMAP Phase 7 criterion 3 machine-checked spine)"
  - "A gated CI step that fails when any recipe stops compiling against the published types"
  - "The single source of truth 07-02 embeds byte-for-byte into the README"
affects:
  - "package.json scripts block (check:examples added; verify chain extended)"
  - ".github/workflows/ci.yml (one new gated step adjacent to publint/attw)"
tech-stack:
  added: []
  patterns:
    - "Examples-as-spec: README recipes are real .ts files type-checked against the BUILT package, so a recipe can never silently rot"
    - "Type-only framework shim kept a GLOBAL SCRIPT (no top-level import/export, inline import() type) so declare module registers as an ambient module under moduleResolution nodenext"
    - "Standalone tsconfig (not extending the base, whose rootDir:src is wrong for examples/), noEmit pure type gate"
key-files:
  created:
    - examples/plain-script.ts
    - examples/cucumber.ts
    - examples/mocha-jest.ts
    - examples/shims/frameworks.d.ts
    - tsconfig.examples.json
    - scripts/check-examples.mjs
  modified:
    - package.json
    - .github/workflows/ci.yml
decisions:
  - "selfmend import resolution: NATURAL self-resolution via the package exports map (no tsconfig paths fallback). After npm run build, the example imports of \"selfmend\" resolve cleanly through package.json exports to dist/index.d.mts under moduleResolution nodenext; no paths map to dist types was needed."
  - "Kept the framework shim a global script: the first attempt made it a module (top-level import type + export {}), under which declare module \"@cucumber/cucumber\" stopped being globally visible and tsc reported TS2307. Removing the top-level import/export and referencing Page via an inline import(\"@playwright/test\").Page restored ambient registration."
  - "Mocha/Jest hook globals declared as bare declare function (ambient) rather than declare global, consistent with the global-script shim."
  - "Added check:examples into the verify chain BEFORE npm test, AFTER typecheck, so a recipe break surfaces before the slower unit run."
metrics:
  tasks: 3
  files: 8
  commits: 4
  completed: 2026-06-02
---

# Phase 7 Plan 01: Compilable Examples Spine Summary

Three real TypeScript recipes (plain script, Cucumber, Mocha/Jest) that import and exercise ONLY the published selfmend API, backed by a type-only framework shim, a standalone strict tsconfig, an npm smoke check that builds the package then type-checks the recipes against the built types, and a gated CI step, so ROADMAP Phase 7 criterion 3 (recipes provably compile against the published API) has a machine-checked spine and the examples are the single source of truth 07-02 will embed.

## What Was Built

- **DOC-01 (engineering half)**: `examples/plain-script.ts`, `examples/cucumber.ts`, `examples/mocha-jest.ts`. Each imports only confirmed exports from `"selfmend"` (`wrapPage`, `resetScope`, `loadBaseline`, `saveBaseline`, `mergeBaselines`, `renderHealSummary`, `BaselineStore`, and the types `SelfmendEvent`) plus `chromium`/`Page` from `@playwright/test`. Each shows the full raw-mode wiring per its lifecycle: a long-lived page wrapped once, `scope()` returning `{ suite, test }` read live (never the page URL), baseline load at the start and save at the end, and heal output via collecting `onHeal` events into a `SelfmendEvent[]` then `renderHealSummary(events)`.
- **Cucumber adopter pattern**: `createPage` once per feature, `scope` keyed on two stable identifiers (`this.featureName` + `this.scenarioName`) read live, the wrapped page assigned to `this.page` in a `Before` hook (so step defs / page objects stay untouched), `resetScope(this.page)` in the same `Before` hook for same-scope retries, baseline loaded once in `BeforeAll`, summary printed + saved in `AfterAll`.
- **Mocha/Jest**: one file covers both (shared `before`/`after`/`beforeEach` names). `before()` loads the baseline + wraps one long-lived page; `beforeEach()` updates the live `currentTestName`; `after()` prints the summary + saves. A clearly separated `mergeWorkerBaselines` block shows `mergeBaselines(workerStoreA, workerStoreB)` for the parallel-worker case (each worker keeps its own store), with a comment noting the result is order-independent.
- **Type-only shim**: `examples/shims/frameworks.d.ts` declares `@cucumber/cucumber` (the hook/step symbols + a minimal `SelfmendWorld`) and the Mocha/Jest hook globals. NO `@cucumber/cucumber`, `mocha`, or `jest` was installed; no entry was added to `dependencies` or `devDependencies`.
- **Gate**: `tsconfig.examples.json` (standalone, strict, `module`/`moduleResolution` nodenext, `noEmit`, includes `examples/**/*.ts` + the shim) and `scripts/check-examples.mjs` (runs `npm run build` then `tsc -p tsconfig.examples.json`, non-zero on either failure). `package.json` gained `"check:examples": "node scripts/check-examples.mjs"`, wired into the `verify` chain. `.github/workflows/ci.yml` gained a `Check examples (docs smoke)` step gated to `matrix.node == 24 && matrix.playwright == '1.60.0'`, adjacent to publint/attw.

## How It Works

The smoke check builds the package first so `dist/` and the published `.d.mts`/`.d.cts` exist, then runs a noEmit `tsc` over `examples/`. The example imports of `"selfmend"` resolve through the package's OWN exports map (the package self-resolves its name to `dist/index.d.mts` under nodenext), so the recipes are checked against the PUBLISHED types, not `src/`. The Cucumber/Mocha/Jest symbols resolve through the type-only shim, which is a global script (no top-level import/export) so its `declare module "@cucumber/cucumber"` registers as an ambient module that the recipe's nodenext ESM import can see. Because the README (07-02) embeds these files byte-for-byte, a published-API change that breaks a recipe fails `check:examples` locally and on the gated CI leg.

## selfmend Import-Resolution Mechanism (recorded per plan output requirement)

NATURAL self-resolution via the package exports map. No `tsconfig` `paths` fallback to `dist/index.d.mts` was used or needed. After `npm run build`, `import { ... } from "selfmend"` in the example files resolved cleanly to the built types through `package.json` `exports` under `moduleResolution: nodenext`. The plan's fallback (a paths map to the built dist types) was NOT triggered.

## API Warts Revealed by the Recipes

None. Every wiring the three recipes needed was expressible with the published surface exactly as exported:

- `wrapPage(raw, { store, scope, onHeal })` returns a bare `Page`, drop-in.
- `loadBaseline(path)` returns a usable store (empty on first run), `saveBaseline(path, store)` is the symmetric save.
- `renderHealSummary(events)` takes the `SelfmendEvent[]` collected off `onHeal`.
- `resetScope(page)` and `mergeBaselines(...stores)` are public and typed as documented.

No runtime `src/` file was touched. One non-API friction worth noting for 07-02 prose (NOT an API gap): under `moduleResolution: nodenext`, an ambient `declare module` shim must live in a GLOBAL-SCRIPT `.d.ts` (no top-level `import`/`export`); the first module-form shim produced TS2307 until converted. This is a TypeScript resolution nuance for the shim, not a selfmend API wart, and does not affect adopters (who install the real framework).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Framework shim had to be a global script for nodenext ambient resolution**
- **Found during:** Task 2 (first `npm run check:examples`).
- **Issue:** The shim was first written as a module (top-level `import type { Page }` + `export {}`). Under `moduleResolution: nodenext`, that made `declare module "@cucumber/cucumber"` a module-local augmentation, no longer globally visible, so `examples/cucumber.ts` reported `TS2307: Cannot find module '@cucumber/cucumber'`. (The Mocha/Jest globals resolved, confirming the file was loaded but the module declaration was not ambient.)
- **Fix:** Removed the top-level `import`/`export`, referenced `Page` via an inline `import("@playwright/test").Page` type, and declared the Mocha/Jest hooks as bare `declare function`. The shim is now a global script and the ambient module registers. `check:examples` exits 0.
- **Files modified:** `examples/shims/frameworks.d.ts` (staged with Task 2 since it is part of making the gate pass).
- **Commit:** 40cbe07

**2. [Rule 1 - Scope-adjacent] Two pre-existing em dashes in ci.yml comments**
- **Found during:** Task 3 (the plan's verify check exits 3 if any em dash exists in ci.yml).
- **Issue:** Lines 82 and 91 of `.github/workflows/ci.yml` (pre-existing comments, not added by this plan) contained U+2014, which is a hard project rule violation (CLAUDE.md / em-dash gate) and tripped the Task 3 verify.
- **Fix:** Replaced both em dashes with commas in the existing comments. No behaviour change; comment-only.
- **Files modified:** `.github/workflows/ci.yml`
- **Commit:** 839b76c

## Verification

- `npm run check:examples`: exit 0 (build + `tsc -p tsconfig.examples.json` clean against the built published API).
- `npm run typecheck` (main `tsc --noEmit`): exit 0 (project still clean).
- Em-dash gate: the three examples, the shim, the script, tsconfig.examples.json, package.json, and ci.yml all free of U+2014.
- `git diff --stat HEAD~3 HEAD -- src/`: empty (no runtime `src/` file changed across all three task commits).
- `git diff package.json`: only the scripts block changed; no new `dependencies` / `devDependencies` entry; no `@cucumber/cucumber` / `mocha` / `jest` install.
- Task verifies: Task 1 node existence/wrapPage/em-dash check exit 0; Task 2 `npm run check:examples` exit 0; Task 3 ci.yml `check:examples` + `Check examples` present, em-dash-free, exit 0.

## Self-Check: PASSED

- FOUND: examples/plain-script.ts
- FOUND: examples/cucumber.ts
- FOUND: examples/mocha-jest.ts
- FOUND: examples/shims/frameworks.d.ts
- FOUND: tsconfig.examples.json
- FOUND: scripts/check-examples.mjs
- FOUND: package.json (check:examples in scripts + verify chain)
- FOUND: .github/workflows/ci.yml (Check examples (docs smoke) gated step)
- FOUND commit fe29a6a (Task 1), 40cbe07 (Task 2), 839b76c (Task 3)
