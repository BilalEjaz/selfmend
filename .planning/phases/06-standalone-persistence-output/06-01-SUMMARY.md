---
phase: 06-standalone-persistence-output
plan: 01
subsystem: store
tags: [persistence, standalone, merge, refresh-only, runner-agnostic]
requires:
  - "Phase 5 wrapPage(page, { store, scope, onHeal }) runner-agnostic core"
  - "src/store/persistence.ts atomicWrite + parseBaseline (fs adapter)"
  - "src/store/merge.ts refresh + mergeShards (pure merge layer)"
  - "src/store/serialize.ts serialize (byte-stable)"
provides:
  - "Public loadBaseline(path) / saveBaseline(path, store) decoupled from the reporter and shards (STORE-01)"
  - "saveBaseline refresh-and-add only, never auto-prune (STORE-02)"
  - "mergeBaselines(...stores) deterministic, order-independent N-way merge (STORE-03)"
  - "Internal rootDir loader renamed to loadCommittedBaseline"
affects:
  - "src/index.ts public export surface (three new store symbols)"
  - "src/reporter/reporter.ts + src/integration/fixture.ts (rootDir loader callers)"
tech-stack:
  added: []
  patterns:
    - "Thin wrappers over already-tested internals (atomicWrite, serialize, parseBaseline, refresh, mergeShards); no new logic"
    - "Public path-based API trusts the consumer's literal path (no .selfmend clamp); the internal env-override path keeps its containment clamp"
key-files:
  created:
    - tests/standalone-store.spec.ts
  modified:
    - src/store/persistence.ts
    - src/store/merge.ts
    - src/store/persistence.test.ts
    - src/store/merge.test.ts
    - src/reporter/reporter.ts
    - src/integration/fixture.ts
    - src/index.ts
decisions:
  - "Folded the path-based wrappers INTO persistence.ts (the single fs-importing module) rather than a sibling standalone.ts, keeping the one auditable I/O home (RESEARCH Open Q1 recommendation a)"
  - "mergeBaselines operates on BaselineStore instances (consumer-facing symmetry with wrapPage({ store })) and folds through mergeShards with empty seen, reusing the deterministic value-derived conflict rule verbatim"
  - "saveBaseline references prune ONLY in a doc comment stating it never calls prune; no prune import, no prune call (refresh-only)"
metrics:
  tasks: 3
  files: 8
  commits: 4
  completed: 2026-06-02
---

# Phase 6 Plan 01: Standalone Persistence Slice Summary

Public `loadBaseline(path)` / `saveBaseline(path, store)` (refresh-and-add only, never prune) and a deterministic `mergeBaselines(...stores)` fold, all thin wrappers over the existing `atomicWrite` / `serialize` / `parseBaseline` / `refresh` / `mergeShards` internals, with the internal rootDir loader renamed to `loadCommittedBaseline` and a raw-mode e2e proving a heal off a saved file alone.

## What Was Built

- **STORE-01**: `loadBaseline(target: string)` and `saveBaseline(target: string, store: BaselineStore)` in `src/store/persistence.ts`, decoupled from the reporter and shard machinery. They take a LITERAL caller-owned path (no `.selfmend` containment clamp; the public path is the consumer's own choice, RESEARCH Security V12 / T-06-03) and reuse the same fail-soft parse. Exported from `src/index.ts`. A shared private `readBaselineFile(target)` backs both the public loader and the renamed committed loader.
- **STORE-02**: `saveBaseline` loads whatever already lives at the path, `refresh`es it with the store's entries, then `atomicWrite(serialize(next))`. It calls `refresh` ONLY and never `prune`, so a key present before but not recaptured this save survives. Proven by the survival-invariant unit test (seed K1, save; save a second store capturing only K2; both K1 and K2 present after reload).
- **STORE-03**: `mergeBaselines(...stores: BaselineStore[])` in `src/store/merge.ts`, a thin fold that shapes each store into a captures-only shard and runs `mergeShards`, reusing the value-derived (not last-write-wins) conflict rule. Proven order-independent over overlapping and disjoint inputs, with zero-arg (empty) and one-arg (passthrough) edge cases.
- **Rename**: the internal `loadBaseline(rootDir, override?)` became `loadCommittedBaseline(rootDir, override?)` (body unchanged), freeing the public name. Both rootDir callers updated.
- **e2e**: `tests/standalone-store.spec.ts` proves Success Criterion 1: save in run 1 via `saveBaseline`, `loadBaseline` in run 2 into a fresh store, break the selector, real heal off the loaded file alone, no reporter, no shards dir, per-test temp path.

## How It Works

`saveBaseline` is refresh-only by construction: `refresh(existing, { captures: store.entries, seen: ∅ })` is `{ ...existing.entries, ...captures }`, additive. The `prune` destructive path stays gated in the reporter's `mergeAndPersist` alone. `mergeBaselines` inherits `mergeShards`' determinism: the same-key tiebreak is the max value-derived compare key, a function of captured values only, so argument order and worker timing never change the result. The standalone load/save touch only the consumer's literal file path; no `.selfmend` directory or shards dir is ever created by this surface.

## Verification

- `npx tsc --noEmit`: exit 0.
- `npx vitest run`: 151 passed (the prior 141 plus 10 new STORE-02/STORE-03 unit tests across persistence.test.ts and merge.test.ts).
- `npx playwright test tests/standalone-store.spec.ts tests/parallel-store.spec.ts tests/prune.spec.ts`: 5 passed (the new standalone heal-off-file e2e plus the existing reporter merge/prune e2e, proving the rename caused zero reporter behaviour change).
- `src/matching/` untouched; no new runtime dependency; `STORE_FORMAT_VERSION` and the serialized shape unchanged.
- TDD gates: `test(06-01)` RED commit (e9f676b) then `feat(06-01)` GREEN commit (b009283).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Second caller of the renamed internal loader (fixture.ts), missed by the plan and research**
- **Found during:** Task 2 (after the rename, running the reporter merge/prune e2e).
- **Issue:** The plan and 06-RESEARCH.md both stated the internal `loadBaseline` had exactly ONE caller (`src/reporter/reporter.ts:152`). In fact `src/integration/fixture.ts:109` (the worker-start `selfmendStore` fixture) also called `loadBaseline(rootDir)`. After the rename, that call silently bound to the NEW public path-based `loadBaseline(target)`, which tried to read `rootDir` (a directory) as a literal file, failed, and returned an EMPTY store. The cross-run heal (`tests/parallel/crossrun.pwspec.ts`, driven by `tests/parallel-store.spec.ts` CAP-02) then loaded no fingerprint and could not heal (0 locators healed, timeout). A type-only check (`tsc`) did not catch it because both signatures are `string -> Promise<BaselineStore>`.
- **Fix:** Updated the fixture import and the single call site to `loadCommittedBaseline(rootDir)`.
- **Files modified:** `src/integration/fixture.ts`
- **Commit:** 7d726b3
- **Verification:** the CAP-02 cross-run heal phase healed 1 locator (score 1.00) after the fix; full reporter e2e green.

This deviation is why the byte-identical "zero reporter behaviour change" rename invariant is enforced by RUNNING the reporter e2e, not by `tsc` alone: two same-signature functions make a misdirected caller a silent runtime failure, not a compile error.

## Self-Check: PASSED

- FOUND: src/store/persistence.ts (public loadBaseline + saveBaseline; loadCommittedBaseline)
- FOUND: src/store/merge.ts (mergeBaselines)
- FOUND: src/index.ts (loadBaseline, saveBaseline, mergeBaselines exported)
- FOUND: tests/standalone-store.spec.ts
- FOUND commit e9f676b (RED), b009283 (GREEN Task 1), 7d726b3 (Task 2), b7766c7 (Task 3)
