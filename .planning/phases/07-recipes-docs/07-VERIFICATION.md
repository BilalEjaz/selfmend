---
phase: 07-recipes-docs
verified: 2026-06-02T17:20:00Z
status: passed
score: 3/3
overrides_applied: 0
re_verification: false
---

# Phase 7: Recipes & Docs Verification Report

**Phase Goal:** A developer can follow the README to wire `wrapPage` into Cucumber, Mocha/Jest, or a plain script, and understands exactly what selfmend will and will not do, including the never-false-green guarantee and the honest limits.
**Verified:** 2026-06-02T17:20:00Z
**Status:** PASSED
**Re-verification:** No (initial verification)

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | README documents `wrapPage` with a working recipe for each of Cucumber, Mocha/Jest, and a plain script, each showing `scope()` wiring, baseline load/save, and heal output | VERIFIED | README.md lines 140-433: `## Using selfmend without @playwright/test` with `### Plain script`, `### Cucumber`, `### Mocha / Jest`; each has `scope()`, `loadBaseline`/`saveBaseline`, `renderHealSummary` |
| 2 | Docs state the never-false-green guarantee for raw mode AND the honest limits so an adopter is not surprised | VERIFIED | README.md lines 435-473: `### The never-false-green guarantee in raw mode` (3 named claims) + `### Honest limits` (4 named limits including Page-level only, Cypress/Selenium out, missed-heal-not-wrong-heal, parallel needs `mergeBaselines`) |
| 3 | Each recipe is runnable as written: code blocks compile against the published API surface, validated by a docs/example smoke check | VERIFIED | `npm run verify` exit 0 (163 unit tests, `check:examples` and `check:readme` both passed); `npx playwright test` 29/29 passed |

**Score:** 3/3 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `examples/plain-script.ts` | Compilable plain-script recipe, imports only published selfmend API | VERIFIED | Exists, 73 lines, imports `wrapPage`, `loadBaseline`, `saveBaseline`, `renderHealSummary`, `SelfmendEvent` from `selfmend`; type-checks via `check:examples` |
| `examples/cucumber.ts` | Compilable Cucumber recipe with scope/baseline/heal | VERIFIED | Exists, 86 lines, imports all required selfmend symbols; Cucumber symbols resolve via shim; type-checks cleanly |
| `examples/mocha-jest.ts` | Compilable Mocha/Jest recipe with parallel note | VERIFIED | Exists, 90 lines, shows `mergeBaselines` for parallel workers; Mocha/Jest globals resolve via shim; type-checks cleanly |
| `examples/shims/frameworks.d.ts` | Type-only shim, zero new runtime dep | VERIFIED | Exists, global script (no top-level import/export), declares `@cucumber/cucumber` ambient module + Mocha/Jest globals; no framework installed |
| `tsconfig.examples.json` | Standalone strict tsconfig, nodemext/noEmit | VERIFIED | Exists, standalone (does not extend base), `module: nodenext`, `moduleResolution: nodenext`, `strict: true`, `noEmit: true` |
| `scripts/check-examples.mjs` | Build + tsc gate for examples against built API | VERIFIED | Exists, runs `npm run build` then `tsc -p tsconfig.examples.json`; `check:examples ok` printed on success |
| `scripts/check-readme-examples.mjs` | Byte-equality gate: README fenced blocks vs examples/ | VERIFIED | Exists, keyed on exact headings, trims one trailing newline, exits 1 on drift with first-difference index; `check:readme ok` printed on success |
| `README.md` | Three runner-agnostic recipes + never-false-green + honest limits | VERIFIED | All six required sections present; all prose in plain maintainer voice; em dash count: 0 |
| `CHANGELOG.md` | Public `[0.2.0] - 2026-06-02` entry | VERIFIED | Entry present, names `wrapPage`, `scope()`, `resetScope`, `loadBaseline`/`saveBaseline`, `mergeBaselines`, `onHeal`, `renderHealSummary`; scope statement included |
| `package.json` | `check:examples` and `check:readme` in verify chain; version still `0.1.2`; no new deps | VERIFIED | `verify` script: `... && npm run check:examples && npm run check:readme && npm test`; `"version": "0.1.2"`; no new entries in `dependencies` or `devDependencies` |
| `.github/workflows/ci.yml` | CI step for `check:examples` on publish-validation leg | VERIFIED | `Check examples (docs smoke)` step at line 109, gated `if: matrix.node == 24 && matrix.playwright == '1.60.0'`, runs `npm run check:examples` |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| README.md recipe fenced blocks | `examples/plain-script.ts`, `examples/cucumber.ts`, `examples/mocha-jest.ts` | `scripts/check-readme-examples.mjs` byte-equality | WIRED | `check:readme` exits 0; parser extracts block after each named heading, trims trailing newline, asserts byte-equality; run confirmed in `npm run verify` |
| `package.json` `verify` | `scripts/check-readme-examples.mjs` | `check:readme` npm script in verify chain | WIRED | Line 71: `&& npm run check:readme && npm test` |
| `package.json` `verify` | `scripts/check-examples.mjs` | `check:examples` npm script in verify chain | WIRED | Line 71: `&& npm run check:examples && npm run check:readme` |
| `.github/workflows/ci.yml` | `npm run check:examples` | `Check examples (docs smoke)` step | WIRED | CI line 111; gated to publish-validation leg |
| `examples/*.ts` | `dist/index.d.mts` (built types) | `tsconfig.examples.json` nodenext self-resolution via `package.json` exports map | WIRED | Confirmed: examples import `"selfmend"` which self-resolves to built types after `npm run build`; no `paths` fallback needed |

### Data-Flow Trace (Level 4)

Not applicable. Phase 7 delivers documentation artifacts and gate scripts only; no dynamic data rendering or runtime data flows were introduced.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full verify chain including both new gates | `npm run verify` | exit 0; 163 unit tests passed, `check:examples ok`, `check:readme ok` | PASS |
| All e2e tests still green | `npx playwright test` | 29/29 passed | PASS |
| `src/` untouched by Phase 7 | `git diff --stat cd479c2..HEAD -- src/` | (empty output) | PASS |
| Em dashes in README, CHANGELOG, examples, scripts | `grep -c $', ' README.md CHANGELOG.md examples/*.ts scripts/check-*.mjs` | 0 in all files | PASS |
| Version not bumped | `package.json "version"` | `"0.1.2"` | PASS |
| No new runtime deps | `package.json dependencies/devDependencies` | Only `zod`, `picocolors` as runtime deps; no framework packages added | PASS |

### Probe Execution

No probe scripts defined for Phase 7. The `check:examples` and `check:readme` gates serve as the machine-checked probes and were run directly via `npm run verify`.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| DOC-01 | 07-02-PLAN.md | README and recipes document `wrapPage` for Cucumber, Mocha/Jest, and a plain script, with honest limits and never-false-green guarantee | SATISFIED | All three named recipes in README; both trust sections present; `check:readme` confirms byte-equality; `check:examples` confirms API compilation |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none found) | - | - | - | - |

All scanned files (README.md, CHANGELOG.md, examples/*.ts, scripts/check-*.mjs) are free of TBD, FIXME, XXX, placeholder comments, and em dashes. No stub patterns or empty returns in the new scripts.

### Human Verification Required

None. All success criteria are programmatically verifiable and confirmed by gate execution.

The only item to flag for a human at release time is: `package.json` version is intentionally still `0.1.2`. The maintainer must run `npm version 0.2.0` and `git tag v0.2.0` before publishing. This is not a phase gap; it is the documented release procedure per RELEASING.md.

### Adversarial Checks

**Criterion 3 gate rigor (byte-sync is real):**

`scripts/check-readme-examples.mjs` uses `String.prototype.indexOf` to locate each exact heading then the next ` ```ts ` fence, extracts the block content, and compares it with `!==` after trimming exactly one trailing newline from the file source. A single-character drift in any fenced block will produce a non-zero exit with a `first difference at index N` message. This is byte-equality, not a substring or fuzzy match.

`scripts/check-examples.mjs` runs `npm run build` then `tsc -p tsconfig.examples.json` (noEmit). The examples import from `"selfmend"` which self-resolves through the package's own exports map (`dist/index.d.mts` under nodenext) after the build step, so the type-check is against the published types, not `src/`. A drift in the API surface would cause `TS2305` or `TS2339` and fail the gate.

**Criterion 1 adversarial: all three recipes verified independently:**

- `### Plain script`: has `scope: () => ({ suite: "smoke", test: "checkout" })`, `loadBaseline(BASELINE_PATH)`, `saveBaseline(BASELINE_PATH, store)`, `renderHealSummary(events)`. VERIFIED.
- `### Cucumber`: has `scope: () => ({ suite: this.featureName, test: this.scenarioName })`, `BeforeAll` loads baseline, `AfterAll` saves + renders summary. VERIFIED.
- `### Mocha / Jest`: has `scope: () => ({ suite: suiteName, test: currentTestName })`, `before()` loads baseline, `after()` saves + renders summary. Also shows `mergeBaselines`. VERIFIED.

**Criterion 2 adversarial: all named claims literally present:**

- "Page-level only": README line ~462 - "Page-level only this milestone" + wrapPage heals one Playwright Page. PRESENT.
- "wrong/missing key = missed heal never a wrong heal": README `### The never-false-green guarantee in raw mode` - "A wrong or missing scope() key is a missed heal, never a wrong heal." PRESENT.
- "Cypress and Selenium out of scope": README `### Honest limits` - "Cypress and Selenium use incompatible locator models and are out of scope." PRESENT.
- "parallel needs mergeBaselines": README `### Honest limits` - "Merge them with mergeBaselines(...) in a single final step." PRESENT.

**`check:readme` not in CI (noted, not a gap):**

The 07-01 PLAN required `check:examples` in CI; the 07-02 PLAN's `affects:` lists only `package.json` (not `ci.yml`) for its wave. The `check:readme` gate runs in `npm run verify` (the local and pre-publish gate). The CI pattern (one CI step per gate type, version-independent) was set by 07-01; adding a second single-leg CI step for the README sync check was not required by 07-02. This is by design. The `verify` chain being the enforcement point is sufficient for the criterion.

### Gaps Summary

No gaps. All three ROADMAP success criteria are fully verified:

1. Three named, working recipes in the README, each showing `scope()` wiring, baseline load/save, and heal output.
2. Both trust sections present with every named claim: never-false-green guarantee (3 claims) and honest limits (4 named limits including Page-level only, Cypress/Selenium out, missed-heal-not-wrong-heal, parallel needs `mergeBaselines`).
3. Recipes compile against the published API (gate: `check:examples`); README is byte-synced to the compilable sources (gate: `check:readme`); both gates pass in `npm run verify`.

Cross-cutting constraints all satisfied: zero new runtime deps, `src/` untouched, version still `0.1.2`, no em dashes, no marketing tone.

---

_Verified: 2026-06-02T17:20:00Z_
_Verifier: Claude (gsd-verifier)_
