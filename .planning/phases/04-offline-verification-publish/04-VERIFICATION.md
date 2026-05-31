---
phase: 04-offline-verification-publish
verified: 2026-05-31T22:20:00Z
status: human_needed
score: 12/13 must-haves verified
overrides_applied: 0
re_verification: false
human_verification:
  - test: "Run the GitHub Actions matrix CI on a real push"
    expected: "All 4 matrix legs (node 22/24 x playwright 1.42.0/1.60.0) pass — especially the 1.42.0 floor legs, which have NOT yet been proven on CI (only 1.60.0 is installed locally). The declared peerDependencies floor is CI-pending."
    why_human: "The matrix workflow was committed but has never run against a real GitHub Actions runner. The 1.42.0 compatibility cannot be verified without a real push to GitHub."
---

# Phase 4: Offline Verification & Publish Verification Report

**Phase Goal:** Prove the healing path is fully offline (PRIV-01) via a network-blocked test, lock the dual ESM/CJS + Playwright-version compatibility matrix in CI, write launch docs, and prepare a publish-ready 0.1.0 verified by `npm publish --dry-run`. The real publish is a documented human step (NOT performed).
**Verified:** 2026-05-31T22:20:00Z
**Status:** human_needed
**Re-verification:** No (initial verification)

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|---------|
| 1 | PRIV-01 offline test is self-validating: first test trips the egress block (counter > 0), second test runs a full capture+heal cycle and asserts counter === 0 | VERIFIED | `tests/offline.spec.ts` lines 123-169; trip-proof on line 129 `expect(counter.n).toBeGreaterThan(0)`; zero-egress assertion line 168 `expect(counter.n).toBe(0)`. `npx playwright test tests/offline.spec.ts` exits 0 with 2 passed. |
| 2 | package-lock.json is committed, lockfileVersion 3, and `npm ci` exits 0 leaving it unmodified | VERIFIED | Committed at `d45a4ad`; `git ls-files package-lock.json` confirms tracking; `npm ci` exits 0; `git diff package-lock.json` empty after install. |
| 3 | Version is 0.1.0 and a prepublishOnly script guards publish | VERIFIED | `package.json` `version: "0.1.0"`; `prepublishOnly: "npm run build && npm run lint:pack"`. The plan originally required `lint:types` in prepublishOnly but this was an intentional documented fix (attw cannot run nested npm pack inside an in-progress npm publish on Windows — deterministic ENOENT). Publint stays as the stale-dist guard; attw runs as a standalone CI + local gate. The must-have truth "prepublishOnly guards against stale/unbuilt dist" is satisfied. |
| 4 | CHANGELOG.md has a 0.1.0 entry | VERIFIED | `CHANGELOG.md` line 13: `## [0.1.0] - 2026-05-31` with full v1 feature set and pre-1.0 notice. |
| 5 | `npm publish --dry-run` exits 0 reporting selfmend@0.1.0, NO real publish occurred | VERIFIED | Dry-run output: `+ selfmend@0.1.0`; `npm view selfmend` returns 404 (package not on npm registry). |
| 6 | Tarball contains ONLY dist + README + package.json (no src, tests, .map, .selfmend, .env) | VERIFIED | `npm pack --dry-run` lists 14 files: `README.md`, `package.json`, and 12 `dist/` files only. No source maps (tsdown.config.ts `sourcemap: false`). No src, tests, .selfmend, or .env entries. |
| 7 | publint clean and attw exits 0 (all modern resolvers green) | VERIFIED | `npx publint` reports "All good!"; `npm run lint:types` runs `scripts/check-types.mjs` which invokes attw against explicit tarball — all node16 CJS/ESM and bundler rows green. node10 skull on `./reporter` subpath is expected and correctly ignored per Pitfall 4 (engines.node >= 22). |
| 8 | README has config reference with correct defaults (enabled true, threshold 0.9, margin 0.05, testIdAttr data-testid, SELFMEND_PRUNE), trust model, committed-baseline workflow, and honest Limitations (locator-only, Playwright-only, WR-03, WR-04) | VERIFIED | README config table at lines 96-99 matches `src/config/schema.ts` defaults exactly. SELFMEND_PRUNE documented in env table (lines 103-107). "How healing works" trust model section with both gates and no-false-green re-throw. "Committed baseline workflow" section. "Limitations" section covering locator-only, Playwright-only, WR-03 occurrence index, WR-04 selectOption. |
| 9 | `.github/workflows/ci.yml` has node 22/24 x playwright 1.42/1.60 matrix, uses npm ci, and contains NO NPM_TOKEN and NO publish step | VERIFIED | matrix.node: [22, 24]; matrix.playwright: ["1.42.0", "1.60.0"]; fail-fast: false; `npm ci` step present; grep for NPM_TOKEN returns nothing; no publish step; actions pinned to @v4. |
| 10 | RELEASING.md exists with the human publish checklist (npm login, --access public, 2FA, git tag) | VERIFIED | `RELEASING.md` contains `npm login`, `npm whoami`, `npm publish --access public`, `git tag v0.1.0 && git push --tags`. States CI holds no token and release is manual. |
| 11 | NUL-byte guard exists: .gitattributes + .github/workflows/nul-guard.yml | VERIFIED | `.gitattributes` declares `*.ts text eol=lf`. `nul-guard.yml` checks NUL bytes in src/tests .ts files via perl and checks src/ imports no node:http/https/net/dns/tls. Local perl check confirms zero NUL bytes in tracked source. |
| 12 | No tracked source file contains a NUL byte | VERIFIED | `git ls-files -z -- 'src/**/*.ts' 'tests/**/*.ts' | xargs -0 perl -0777 -ne '...'` found zero NUL-containing files. |
| 13 | Matrix CI is proven on @playwright/test 1.42.0 (declared peerDependencies floor) | UNCERTAIN | The workflow was committed (ci.yml) and is structurally correct, but it has never been run on a real GitHub Actions runner. The 1.42.0 compatibility leg is "CI-pending" per RELEASING.md and the workflow header comment. Cannot verify cross-version compatibility without a real CI run. |

**Score:** 12/13 truths verified (1 uncertain — requires human CI run)

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `package-lock.json` | Reproducible install contract, lockfileVersion 3 | VERIFIED | Committed at d45a4ad; lockfileVersion 3; npm ci exits 0, no diff |
| `tests/offline.spec.ts` | PRIV-01 in-process network-block heal-cycle test, min 60 lines | VERIFIED | 169 lines; imports healingFixture and HEAL_ATTACHMENT_NAME; installEgressBlock patches net/http/https/dns/tls/fetch; 2 tests pass |
| `.gitattributes` | Text normalization to surface NUL-byte corruption | VERIFIED | Declares `*.ts text eol=lf` plus json/md/yml/html; lockfile normalized |
| `.github/workflows/nul-guard.yml` | CI guard that fails on a NUL byte in tracked source | VERIFIED | Triggers push+PR; perl NUL check; static network-import ban on src/; offline-by-construction guard |
| `package.json` | version 0.1.0 + prepublishOnly guard | VERIFIED | version 0.1.0; prepublishOnly runs build + lint:pack |
| `CHANGELOG.md` | 0.1.0 release notes | VERIFIED | Contains "## [0.1.0] - 2026-05-31"; full v1 capability set; pre-1.0 notice |
| `README.md` | Launch docs with config reference, trust model, baseline workflow, limitations | VERIFIED | Contains SELFMEND_PRUNE, margin, Limitations heading, WR-03, WR-04 |
| `tsdown.config.ts` | Publish build with sourcemap disabled | VERIFIED | `sourcemap: false`; dist contains no .map files after build |
| `.github/workflows/ci.yml` | Matrix CI, manual release only | VERIFIED | node [22,24] x playwright ["1.42.0","1.60.0"]; no NPM_TOKEN; no publish step |
| `RELEASING.md` | Human publish checklist | VERIFIED | Contains npm login, npm publish --access public, git tag; states CI holds no token |
| `scripts/check-types.mjs` | Deterministic cross-platform attw gate | VERIFIED | Explicit pack -> attw against tarball; ignores only expected node10 no-resolution skull; shell:true for Windows |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `tests/offline.spec.ts` | `src/integration/fixture.ts` | `healingFixture` import + real page heal cycle | VERIFIED | Line 40: `import { healingFixture as test } from "../src/integration/fixture.js"` |
| `tests/offline.spec.ts` | egress counter | stub net/http/https/dns/tls/fetch to count+throw, assert counter === 0 | VERIFIED | installEgressBlock increments counter.n; `expect(counter.n).toBe(0)` on line 168 |
| `package.json prepublishOnly` | build + lint:pack | npm run build && publint | VERIFIED | `prepublishOnly: "npm run build && npm run lint:pack"` (attw is a separate standalone gate — intentional, documented deviation) |
| `README.md config table` | `src/config/schema.ts` defaults | documented defaults match zod schema (enabled true, threshold 0.9, margin 0.05, testIdAttr data-testid) | VERIFIED | README table matches schema constants exactly |
| `.github/workflows/ci.yml` | @playwright/test floor + latest | npm install --no-save @playwright/test@${{ matrix.playwright }} | VERIFIED | Line 56: `npm install --no-save @playwright/test@${{ matrix.playwright }}` |
| `terminal proof` | publish readiness | npm ci && build && publint && attw && npm pack --dry-run && npm publish --dry-run all green | VERIFIED | All steps green; `+ selfmend@0.1.0` confirmed |

---

### Data-Flow Trace (Level 4)

Not applicable — this phase delivers infrastructure, tooling, and documentation, not components that render dynamic data from a database.

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| PRIV-01 offline test: 2 tests pass (trip-proof + zero-egress heal) | `npx playwright test tests/offline.spec.ts` | 2 passed (2.7s); heal reporter shows 1 locator healed | PASS |
| Full unit suite | `npm test` | 125 passed (12 test files) | PASS |
| Full integration suite | `npm run test:e2e` | 23 passed (36.5s) | PASS |
| Typecheck | `npm run typecheck` | exit 0, no errors | PASS |
| Build exits 0, no .map files | `npm run build` | exit 0; dist has 12 files, zero .map | PASS |
| publint clean | `npm run lint:pack` | "All good!" | PASS |
| attw all green | `npm run lint:types` | all modern resolvers green; node10 skull correctly ignored | PASS |
| Pack dry-run: dist-only tarball | `npm pack --dry-run` | 14 files: dist/* + README.md + package.json only | PASS |
| Publish dry-run: reports selfmend@0.1.0, no real publish | `npm publish --dry-run` | `+ selfmend@0.1.0`; npm view selfmend returns 404 | PASS |
| npm ci reproducible | `npm ci` | exit 0; git diff package-lock.json empty | PASS |

---

### Probe Execution

No probe scripts found or declared for this phase. Behavioral spot-checks above serve as the terminal proof (verified locally, matching the plan's intended proof sequence).

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| PRIV-01 | 04-01, 04-02, 04-03 | The entire healing path runs fully offline, with no network calls, no API key, and no telemetry, verified by a network-blocked test | SATISFIED | `tests/offline.spec.ts` self-validating egress block; 2/2 tests pass; counter === 0 after full capture+heal cycle |

---

### Anti-Patterns Found

None. Scanned: `tests/offline.spec.ts`, `.github/workflows/ci.yml`, `.github/workflows/nul-guard.yml`, `CHANGELOG.md`, `RELEASING.md`, `README.md`, `.gitattributes`, `package.json`, `tsdown.config.ts`, `scripts/check-types.mjs`. No TBD/FIXME/XXX markers, no placeholder implementations, no empty returns, no return null patterns.

---

### Notable Observations (Non-Blocking)

**prepublishOnly drops lint:types (attw)** — The PLAN required `prepublishOnly: "npm run build && npm run lint:pack && npm run lint:types"`. The actual script is `"npm run build && npm run lint:pack"`. This is a documented intentional fix: attw runs its own `npm pack` internally; calling it from inside an in-progress `npm publish` lifecycle produces a deterministic `ENOENT` on Windows (the nested pack lands in a temp directory). The summary documents this at length (04-03-SUMMARY.md, Deviation 1). The stale-dist guard is preserved via publint. attw runs as a standalone gate in CI (ci.yml) and is documented for the human pre-flight in RELEASING.md. The must-have truth "A prepublishOnly script rebuilds + re-validates so a manual publish cannot ship stale/unbuilt dist" is substantively satisfied.

**package-lock.json version is 0.0.0** — The lockfile was committed before the version bump (0.0.0 -> 0.1.0 happened in 04-02). This is cosmetically inconsistent but not a functional problem: `npm ci` uses the lockfile to install devDependencies and peerDependencies, not the package version, and the lockfile passes idempotency check.

---

### Human Verification Required

#### 1. GitHub Actions Matrix CI — 1.42.0 Compatibility Floor

**Test:** Push to GitHub and confirm the full matrix runs. Specifically confirm the two `playwright: 1.42.0` legs pass (node 22 + node 24).

**Expected:** All 4 legs green: typecheck, vitest 125/125, Playwright 23/23 (incl. PRIV-01 offline test), and build pass across all legs; publint + attw + npm pack --dry-run green on the gated node-24/pw-1.60.0 leg.

**Why human:** The CI workflow was committed but has never been run on a real GitHub Actions runner. The 1.42.0 compatibility is explicitly marked "CI-pending" in both the workflow header comment and RELEASING.md. If the 1.42.0 legs fail, the honest-floor rule (documented in RELEASING.md) requires raising the declared `peerDependencies` floor to the lowest passing version before publishing. This cannot be verified locally — the author only has 1.60.0 installed.

---

### Gaps Summary

No blockers. All 12 verified truths are substantively satisfied and all critical commands (offline test, full suite, publish dry-run) are green. The one UNCERTAIN truth (CI matrix proven on 1.42.0) cannot be resolved programmatically — it requires a real GitHub Actions run. This is by design: the workflow was intentionally committed but marked CI-pending in both the code and RELEASING.md.

---

_Verified: 2026-05-31T22:20:00Z_
_Verifier: Claude (gsd-verifier)_
