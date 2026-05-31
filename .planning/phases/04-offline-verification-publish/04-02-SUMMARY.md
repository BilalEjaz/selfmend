---
phase: 04-offline-verification-publish
plan: 02
subsystem: packaging-docs
tags: [publish-prep, changelog, readme, sourcemap, prepublishOnly, semver]
requires:
  - 04-01 (committed lockfile + PRIV-01 offline test + source guard)
provides:
  - package.json version 0.1.0 + prepublishOnly build-and-validate guard
  - publish build with no source maps (no dead .map referencing un-shipped src/)
  - CHANGELOG.md 0.1.0 entry
  - launch README (D-07): config ref, trust model, committed-baseline workflow, limitations
affects:
  - the next plan's terminal dry-run proof (04-03) builds on this publish-ready state
tech-stack:
  added: []
  patterns:
    - prepublishOnly = build + publint + attw (publish-safety guard, Pattern 2)
    - tsdown sourcemap disabled by removing tsconfig declarationMap/sourceMap (which force-on maps)
key-files:
  created:
    - CHANGELOG.md
  modified:
    - package.json
    - tsdown.config.ts
    - tsconfig.json
    - README.md
decisions:
  - "version 0.0.0 -> 0.1.0; first pre-1.0 release (D-02)"
  - "prepublishOnly runs build + lint:pack (publint) + lint:types (attw --pack) so a manual publish can never ship stale/unbuilt or surface-regressed dist (D-01)"
  - "tsdown sourcemap:false alone was insufficient — tsconfig declarationMap/sourceMap force tsdown's sourcemap true; removed them from tsconfig (inert under tsc --noEmit typecheck) so dist ships zero .map (Pitfall 5, Rule 3)"
  - "README config table is pinned to the zod schema defaults (enabled true / threshold 0.9 / margin 0.05 / testIdAttr data-testid); margin + SELFMEND_PRUNE were missing and added (D-07)"
metrics:
  duration_min: 11
  completed: 2026-05-31
  tasks: 3
  files: 5
---

# Phase 4 Plan 02: Publish Prep & Launch README Summary

`selfmend` is now a documented, publish-ready 0.1.0: version bumped, a `prepublishOnly` guard rebuilds and re-validates before any manual publish, the published build ships no dead source maps, a CHANGELOG records the 0.1.0 feature set, and the README is the full launch doc (config reference, never-false-green trust model, committed-baseline workflow, and honest limitations).

## What shipped

- **package.json:** `version` 0.0.0 -> 0.1.0; added `prepublishOnly: "npm run build && npm run lint:pack && npm run lint:types"`. No runtime deps added (still `zod` + `picocolors`, D-04).
- **tsdown.config.ts:** `sourcemap: false` for the publish build.
- **tsconfig.json:** removed `declarationMap`/`sourceMap` (Rule 3, see Deviations) — they forced tsdown to emit maps regardless of the tsdown setting.
- **CHANGELOG.md:** keep-a-changelog `[0.1.0]` entry (2026-05-31) summarizing the shipped v1 capabilities + the pre-1.0 semver posture.
- **README.md:** expanded (existing quickstart/reporter preserved) with a `margin` row + `SELFMEND_PRUNE` env table, a "How healing works + never-false-green trust model" section, a "Committed baseline workflow" section, and a "Limitations" section (locator-only, Playwright-only, WR-03, WR-04).

## Verification

- `npm run build` exits 0; `dist/` contains **no `.map` files** (12 files: `.cjs`/`.mjs` dual + `.d.cts`/`.d.mts` types for both `index` and `reporter`).
- `node -e` guard: `version === "0.1.0"`, `scripts.prepublishOnly` present, `dependencies === {picocolors, zod}` (unchanged).
- `npx publint` -> "All good!"; `npx attw --pack` -> only the expected `node10` subpath 💀 (node16/bundler all 🟢, documented Pitfall 4).
- README contains `SELFMEND_PRUNE`, `margin`, and a `Limitations` heading.
- `npm run typecheck` clean; `npm test` 125/125 unit green; `npm run test:e2e` 23/23 e2e green (incl. PRIV-01 zero-egress).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] tsconfig `declarationMap`/`sourceMap` forced source maps on despite `tsdown sourcemap: false`**
- **Found during:** Task 1
- **Issue:** Setting `sourcemap: false` in `tsdown.config.ts` did NOT stop `dist/*.map` emission. tsdown's documented behaviour: its `sourcemap` option is "always `true` if you have `declarationMap` enabled in your `tsconfig.json`." `tsconfig.json` had both `declarationMap: true` and `sourceMap: true`, which overrode the tsdown setting, so the build still produced `.mjs.map` + `.d.*.map` (~130 kB) referencing un-shipped `src/`.
- **Fix:** Removed `declarationMap` and `sourceMap` from `tsconfig.json`. These flags only affect emit; the `typecheck` script is `tsc --noEmit` (they produce nothing there) and `dist` is built by tsdown — so removing them is inert for type-checking and makes `tsdown sourcemap: false` effective.
- **Files modified:** tsconfig.json
- **Commit:** 12bcabb
- **Verification:** rebuild produced zero `.map` files; publint/attw stayed green; typecheck clean.

The plan's Task 1 `<files>` listed only package.json + tsdown.config.ts, but the documented acceptance criterion ("after `npm run build`, `dist/` contains no `.map` files") could not be met without this tsconfig change — so it is the minimal, correctness-required fix to satisfy the stated goal (Pitfall 5 / T-04-06).

## Threat surface

No new security-relevant surface introduced. Mitigations in the plan's threat register are satisfied: T-04-05 (stale dist) via `prepublishOnly`; T-04-06 (source-map path leak) via no-map publish build; T-04-07 (inaccurate config docs) via the schema-pinned README table; T-04-SC (supply chain) — no new deps.

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: CHANGELOG.md
- FOUND: README.md (SELFMEND_PRUNE + margin + Limitations)
- FOUND: package.json version 0.1.0 + prepublishOnly
- FOUND: tsdown.config.ts sourcemap:false
- FOUND: dist with zero .map files
- FOUND commit 12bcabb (Task 1: version + prepublishOnly + sourcemap)
- FOUND commit 7f7eb4d (Task 2: CHANGELOG)
- FOUND commit 9709d16 (Task 3: README)
