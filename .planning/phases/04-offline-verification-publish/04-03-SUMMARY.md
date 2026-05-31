---
phase: 04-offline-verification-publish
plan: 03
subsystem: infra
tags: [github-actions, ci, npm, publint, attw, playwright, matrix, publish, releasing]

# Dependency graph
requires:
  - phase: 04-offline-verification-publish (04-01)
    provides: committed reproducible package-lock.json + tests/offline.spec.ts (PRIV-01 offline proof)
  - phase: 04-offline-verification-publish (04-02)
    provides: version 0.1.0 + prepublishOnly guard + launch README + dist with no source maps
provides:
  - Compatibility-matrix CI (.github/workflows/ci.yml) — node 22/24 x @playwright/test 1.42.0/1.60.0, manual-release-only
  - Green local terminal publish-readiness proof (build + publint + attw + npm pack --dry-run + npm publish --dry-run -> selfmend@0.1.0)
  - RELEASING.md — the human npm publish checklist (login/2FA/whoami/--access public/tag/verify/honest-floor)
  - A deterministic cross-platform attw type-resolution gate (scripts/check-types.mjs)
affects: [release, publish, v1-launch]

# Tech tracking
tech-stack:
  added: [GitHub Actions actions/checkout@v4, GitHub Actions actions/setup-node@v4]
  patterns:
    - "CI matrix: npm ci + per-leg --no-save @playwright/test override (safe because it is a peerDependency)"
    - "Publish-surface gates (publint/attw/pack) gated to ONE matrix leg to cut noise"
    - "prepublishOnly = build + publint only; attw runs as a separate gate (cannot npm pack inside an in-progress npm publish)"

key-files:
  created:
    - .github/workflows/ci.yml
    - RELEASING.md
    - scripts/check-types.mjs
  modified:
    - package.json

key-decisions:
  - "CI matrix is the empirical proof for the @playwright/test 1.42.0 floor; honest-floor rule raises the declared floor if the 1.42.0 leg ever fails CI rather than claiming false support (Open Q2)"
  - "prepublishOnly dropped attw: a nested npm pack inside an in-progress npm publish yields 0/misplaced tarballs on Windows (deterministic ENOENT); publint (which packs via pnpm) stays as the stale-dist guard, attw is a separate CI/local gate"
  - "lint:types is scripts/check-types.mjs: explicit pack + attw against the tgz, ignoring ONLY the expected node10 ./reporter skull, so it is a clean green/red gate on every OS"

patterns-established:
  - "Pattern: any tool that runs its own `npm pack` must NOT run inside prepublishOnly during npm publish — pack explicitly outside the publish lifecycle or use a pnpm-backed packer"
  - "Pattern: Windows scripts spawning npm must use shell:true (Node refuses to spawn the npm.cmd shim directly — EINVAL)"

requirements-completed: [PRIV-01]

# Metrics
duration: 41min
completed: 2026-05-31
---

# Phase 4 Plan 3: Matrix CI + Publish-Readiness Proof + RELEASING Summary

**Compatibility-matrix CI (node 22/24 × @playwright/test 1.42.0/1.60.0, no npm token, no publish step), a green local `npm publish --dry-run` reporting `selfmend@0.1.0` with a dist-only tarball, and a copy-paste RELEASING.md — the package is publish-ready and the irreversible publish is left to the human.**

## Performance

- **Duration:** 41 min
- **Started:** 2026-05-31T18:14:57Z
- **Completed:** 2026-05-31T20:55:32Z
- **Tasks:** 2 auto tasks complete (Task 3 is the blocking human-verify phase gate, returned not self-approved)
- **Files modified:** 4 (.github/workflows/ci.yml, RELEASING.md, scripts/check-types.mjs, package.json)

## Accomplishments

- **Compatibility-matrix CI** (`.github/workflows/ci.yml`): `node: [22, 24]` × `playwright: ["1.42.0", "1.60.0"]`, `fail-fast: false`, triggered on push + pull_request. Installs from the committed lockfile via `npm ci`, overrides Playwright per leg with `npm install --no-save @playwright/test@<ver>` (safe — it is a peerDependency), then runs typecheck + vitest + `test:e2e` (incl. the PRIV-01 offline test) + build. publint/attw/`npm pack --dry-run` are gated to one leg (node 24, pw 1.60). Actions pinned to `@v4`. Holds **no npm auth token** and has **no publish step** (D-06).
- **Green terminal publish-readiness proof** run locally: `npm ci` → `npm run build` → publint ("All good!") → attw (all resolvers green) → `npm pack --dry-run` (14 files: `dist/` + `README.md` + `package.json` ONLY — no src, tests, .env, .selfmend, or .map) → `npm publish --dry-run` (`+ selfmend@0.1.0`, exit 0, nothing published).
- **RELEASING.md**: the human publish checklist (pre-flight proof, `npm login` + 2FA, `npm whoami`, `npm publish --access public`, `git tag v0.1.0 && git push --tags`, post-publish verify), states release is manual / CI holds no token, and carries the honest-floor note for the 1.42.0 leg.
- **Full phase suite green:** typecheck 0, vitest 125/125, Playwright 23/23 including `PRIV-01: a full capture+heal cycle completes with zero network egress` and the never-false-green `MATCH-04` refused-ambiguous case.

## Task Commits

1. **Task 1: GitHub Actions compatibility-matrix CI** — `1c4f7cb` (ci)
2. **Task 2: terminal publish-readiness proof + RELEASING.md** — `96d2d2e` (feat, includes the prepublishOnly/attw Rule-1 fix)

_Task 3 is a `checkpoint:human-verify` phase gate (gate=blocking, autonomous:false) — returned for human approval, NOT self-approved, NO real publish performed._

## Files Created/Modified

- `.github/workflows/ci.yml` — compatibility-matrix CI; full suite across node×playwright; publish-surface gates on one leg; no token, no publish step
- `RELEASING.md` — copy-paste human npm publish checklist + honest-floor note
- `scripts/check-types.mjs` — deterministic cross-platform attw gate (explicit pack + attw-against-tarball, ignore the expected node10 skull, shell:true for the Windows npm shim)
- `package.json` — `lint:types` → `node scripts/check-types.mjs`; `prepublishOnly` → `npm run build && npm run lint:pack` (attw removed from the publish chain)

## Decisions Made

- **CI matrix is the 1.42.0 floor proof** (Open Q2): only 1.60 is installed locally, so the declared `>=1.42` peer floor is CI-pending until the matrix runs green on 1.42.0. RELEASING.md and the workflow both document the honest-floor rule — raise the declared floor to the lowest passing version rather than claim false support.
- **publint vs attw inside `npm publish`:** publint packs via `pnpm pack` and works inside the publish lifecycle, so it stays in `prepublishOnly` as the stale/unbuilt-dist guard; attw (which runs its own `npm pack`) cannot, so it is a separate `lint:types` gate run standalone and in CI.
- **ubuntu-latest only for v1** (per research); RELEASING/checkpoint flag the optional `windows-latest` leg for the Windows-specific atomicWrite path if the human wants it before pushing.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `prepublishOnly` + `attw --pack` could not pack inside an in-progress `npm publish` (deterministic dry-run failure)**
- **Found during:** Task 2 (terminal publish-readiness proof)
- **Issue:** The plan's `prepublishOnly` = `build && lint:pack && lint:types` with `lint:types = attw --pack`. `attw --pack` runs its OWN `npm pack`. When invoked as the last link of the `prepublishOnly` chain that `npm publish --dry-run` itself triggers, that nested `npm pack` runs inside npm's in-progress publish lifecycle and produces zero/misplaced tarballs on Windows → `ENOENT: ... selfmend-0.1.0.tgz`, failing the dry-run publish **deterministically** (reproduced twice). This blocked the D-01 terminal proof outright.
- **Fix:** (a) `prepublishOnly` → `npm run build && npm run lint:pack` — publint packs via `pnpm pack` and works inside publish, keeping the stale-dist guard. (b) `lint:types` → `scripts/check-types.mjs`: packs explicitly OUTSIDE the publish lifecycle, runs attw against the resulting tarball, ignores only the expected node10 `no-resolution` skull on `./reporter` (Pitfall 4), and cleans up. (c) Updated `ci.yml` to call `npm run lint:pack` / `npm run lint:types` so CI uses the same deterministic gates.
- **Files modified:** package.json, scripts/check-types.mjs, .github/workflows/ci.yml
- **Verification:** `npm publish --dry-run` now exits 0 and prints `+ selfmend@0.1.0`; `npm run lint:types` exits 0 with all resolver rows green and no leftover tarball.
- **Committed in:** `96d2d2e` (Task 2 commit)

**2. [Rule 3 - Blocking] Windows `spawnSync npm.cmd EINVAL` in the type-check script**
- **Found during:** Task 2 (writing scripts/check-types.mjs)
- **Issue:** `execFileSync("npm.cmd", ...)` throws `EINVAL` on Node 24 / Windows (Node refuses to spawn a `.cmd` shim without a shell).
- **Fix:** Switched to `execSync(cmd, { shell: true })` with fully static (non-interpolated) command strings.
- **Files modified:** scripts/check-types.mjs
- **Verification:** `npm run lint:types` runs clean on Windows.
- **Committed in:** `96d2d2e` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking)
**Impact on plan:** Both were required to make the D-01 terminal proof actually pass; the publish-surface validation (publint + attw) is fully preserved (publint in prepublishOnly, attw in CI + local). No scope creep — same gates, made deterministic and publish-lifecycle-safe.

## Issues Encountered

- The plan's verification snippet `npx @arethetypeswrong/cli --pack` exits 1 on the EXPECTED node10 `./reporter` skull, so it is not a clean pass/fail gate by itself. The new `lint:types` script ignores only that one rule, turning it into a deterministic green/red gate while still failing on any real (non-node10) regression. Documented inline in the script.

## User Setup Required

None — no external service configuration. The one human step (the real `npm publish`) is intentionally out of this phase's scope and documented in RELEASING.md.

## Next Phase Readiness

- This is the final plan of the final phase. The v1.0 package is publish-ready: matrix CI defined, terminal dry-run green, RELEASING checklist written.
- **Blocking phase gate:** the human-verify checkpoint (Task 3) must approve before Phase 4 / v1.0 is marked complete. No real publish has been performed (D-01).
- **CI-pending:** the `@playwright/test@1.42.0` floor leg is proven by the matrix, which has not yet run (the workflow is newly committed). Confirm it is green before the human publishes; otherwise apply the honest-floor rule.
- **Optional before push:** add a `windows-latest` matrix leg for the Windows-specific atomicWrite path (scoped to ubuntu-latest per research).

## Self-Check: PASSED

- Files: `.github/workflows/ci.yml`, `RELEASING.md`, `scripts/check-types.mjs`, `04-03-SUMMARY.md` — all FOUND.
- Commits: `1c4f7cb` (Task 1), `96d2d2e` (Task 2) — all FOUND.

---
*Phase: 04-offline-verification-publish*
*Completed: 2026-05-31*
