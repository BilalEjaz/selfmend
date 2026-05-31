---
phase: 03-persistence-parallel-worker-safety
plan: 02
subsystem: persistence
tags: [persistence, atomic-write, windows, parallel-workers, occurrence-key, fixture, tdd]

# Dependency graph
requires:
  - phase: 03-persistence-parallel-worker-safety
    provides: "Pure store layer (parseBaseline/parseShard/serialize, ShardFile/BaselineFile schema) from Plan 03-01"
  - phase: 01-thinnest-real-heal
    provides: "Locator Proxy + page fixture + in-process BaselineStore (HealContext, wrapLocator, identify)"
  - phase: 02-trust-hardening
    provides: "SelfmendEvent attach-then-rethrow + decide() trust gates (untouched here)"
provides:
  - "src/store/persistence.ts: the ONLY fs-importing module — rootDir-anchored paths, Windows-safe atomicWrite (temp+rename+EPERM/EBUSY retry), per-worker shard read/write, deleteShards, redirectable store dir for tests"
  - "Occurrence-based identify(selector, testFile, testTitle, occurrence) replacing the Phase 1 run-order step counter (D-04/D-05) — cross-run-stable key computed at wrapLocator CREATION time"
  - "BaselineStore seen-key tracking + toShard() + fromBaseline() so loadBaseline can seed it and a worker can emit a shard"
  - "createOccurrenceCounter() (per-content post-increment) wired through fixture via testInfo.titlePath"
affects: [03-03 reporter shard merge + integration proofs, 04 offline-publish]

# Tech tracking
tech-stack:
  added:
    - "@types/node@^24 (devDependency) — Node fs/path/os typings for persistence.ts + temp-dir tests"
  patterns:
    - "fs/path/os confined to a single module (persistence.ts); all paths via path.resolve(rootDir, ...) so no traversal escape"
    - "Atomic committed-file write: temp-file-in-same-dir + fs.rename with EPERM/EBUSY/EACCES retry-with-backoff; on exhaustion rm temp + rethrow (never a half-written target)"
    - "Cross-run identity key derived at locator CREATION (not resolution) and per-(content) per-test, so capture-run and broken-heal-run compute the identical key sequence (D-05)"
    - "Test-redirectable store dir (env/arg override resolved under rootDir) so integration tests never touch the repo's real .selfmend/baseline.json"

key-files:
  created:
    - src/store/persistence.ts
    - src/store/persistence.test.ts
    - src/integration/occurrence.test.ts
  modified:
    - src/store/store.ts
    - src/store/merge.ts
    - src/integration/locator-proxy.ts
    - src/integration/fixture.ts
    - src/integration/step-identity.test.ts
    - package.json
    - tsconfig.json

key-decisions:
  - "[03-02] persistence.ts is the single fs/path/os seam; baselinePath/shardsDir/shardPath are all path.resolve(rootDir, ...) and the optional test/env store-dir override is resolved under rootDir too, so a configured path can never escape the project (T-03-05 mitigated, containment-asserted)"
  - "[03-02] atomicWrite writes a temp sibling then fs.rename with retry-with-backoff on EPERM/EBUSY/EACCES (Windows file-lock reality); on exhausted retries it removes the temp and rethrows, so a reader never observes a partial committed file (T-03-04 mitigated, retry-injection proven)"
  - "[03-02] loadBaseline/readShards delegate to Plan 01 safe loaders inside try/catch; a missing/empty/non-JSON/version-mismatched/malformed file loads as the EMPTY store and never throws (T-03-06 mitigated, Pitfall 5)"
  - "[03-02] The Phase 1 run-order step counter is replaced by identify(selector, testFile, testTitle, occurrence) — the occurrence index is incremented at wrapLocator creation, per-(testFile,titlePath,selector) and reset per test, so it is identical on a green capture run and a later broken heal run (D-04/D-05) and an unrelated inserted locator does not shift it (Pitfall 3)"
  - "[03-02] No key -> no heal is preserved unchanged: a computed key with no stored baseline still re-throws (D-07, never-false-green); this plan is a key-derivation + persistence-seam swap only, decision logic untouched"
  - "[03-02] Stability/sensitivity tradeoff accepted (D-06): renaming a test or reordering a selector's uses orphans those baselines, which are simply recaptured on the next passing run"

patterns-established:
  - "RED -> GREEN per task: failing spec committed as test(03-02), implementation as feat(03-02)"
  - "Worker shard contract: store.toShard() -> ShardFile {version, captures, seen}; persistence.writeShard/readShards is the disk side wired by Plan 03-03"

requirements-completed: [CAP-02, CAP-03]

# Metrics
duration: 20min
completed: 2026-05-31
---

# Phase 3 Plan 02: Persistence Adapter + Occurrence Key Summary

**The durable fs persistence seam (rootDir-anchored paths, Windows-safe atomic write, per-worker shards) plus the cross-run-stable occurrence-based identity key that replaces the Phase 1 run-order step counter — the two prerequisites Plan 03-03 wires into the reporter merge, with all Phase 1/2 heal behavior proven unchanged.**

## What Was Built

### Task 1 — fs persistence adapter (`src/store/persistence.ts`)
The single module in the project allowed to import `node:fs`/`node:fs/promises`/`node:path`/`node:os`. Exports:
- Path helpers `baselinePath(rootDir)` -> `<rootDir>/.selfmend/baseline.json`, `shardsDir(rootDir)` -> `<rootDir>/.selfmend/shards`, `shardPath(rootDir, parallelIndex)` -> `<shardsDir>/shard-<idx>.json`, all built with `path.resolve(rootDir, ...)`. A test/env (`SELFMEND_STORE_DIR`) override is resolved under rootDir too, so integration tests redirect to a temp dir and never touch the repo's real `.selfmend/baseline.json`.
- `loadBaseline(rootDir)` — read + `JSON.parse` in try/catch, hand to `parseBaseline`, build a store; missing/bad -> EMPTY store, never throws.
- `writeShard(path, shard)` — mkdir -p + plain write (shards are transient; no atomic needed).
- `readShards(shardsDir)` — read every `shard-*.json`, parse each via `parseShard`, skip bad ones.
- `atomicWrite(target, data)` — temp-file-in-same-dir + `fs.rename` wrapped in a retry-with-backoff loop (EPERM/EBUSY/EACCES, linear backoff); on exhaustion `fs.rm` the temp and rethrow.
- `deleteShards(shardsDir)` — rm the shards dir, force/ignore-missing.

`src/store/persistence.test.ts` (temp dirs under `os.tmpdir`) proves: round-trip (atomicWrite -> loadBaseline with fingerprints intact, CAP-02); no leftover `.tmp` after success; rename-failure injection retries then succeeds, and exhausted retries leave no temp + throw (Pitfall 1); bad/old/missing file loads EMPTY; path containment under rootDir (no traversal).

### Task 2 — Occurrence-based identity key (store + proxy + fixture)
- `src/store/store.ts`: `identify` is now `identify(selector, testFile, testTitle, occurrence)` returning a stable join; added seen-key tracking (`markSeen`/`seenKeys`), `toShard(): ShardFile`, and `fromBaseline(file)` construction so `loadBaseline` can seed it.
- `src/integration/locator-proxy.ts`: `HealContext.nextStep` replaced by `nextOccurrence(contentKey)` + new `testTitle`; `createStepCounter` replaced by `createOccurrenceCounter()` (per-content post-increment). `wrapLocator` computes `contentKey = testFile + testTitle + selector`, `occurrence = nextOccurrence(contentKey)`, `key = store.identify(selector, testFile, testTitle, occurrence)`. `describeArgs`/chained-selector path use a per-content occurrence token (LO-02 non-serializable-arg distinction preserved).
- `src/integration/fixture.ts`: per-test counter via `createOccurrenceCounter()`, passing `testTitle: testInfo.titlePath.join(" > ")` + `nextOccurrence` into `HealContext`.
- `src/integration/occurrence.test.ts` (new) + updated `src/integration/step-identity.test.ts` prove: same (file,title,selector) twice -> occurrence 0 then 1 (distinct keys, D-04); the key sequence is identical whether or not elements resolve (D-05, Pitfall 4); an unrelated inserted locator does not shift a selector's occurrence indices (Pitfall 3); the surviving CR-01/LO-02 invariants hold under the 4-arg signature.

### Task 3 — Regression gate (checkpoint, approved)
Full suite verified green by the orchestrator: 106 vitest + 17 Playwright, `tsc --noEmit` clean. Heal/no-premature-heal/no-false-green/ambiguous-no-heal/capture/report/replay-failure/waitfor/install behavior unchanged after the key swap; fail-safe (D-07) preserved; `nextStep`/`createStepCounter` removed from live code.

## How It Connects

`persistence.ts` wraps the Plan 03-01 pure layer (`serialize`/`parseBaseline`/`parseShard`) as the disk side. `store.toShard()` emits the `ShardFile` that `writeShard` persists per worker and `readShards` reads back. The occurrence key is now the address under which a fingerprint is both captured and looked up. Plan 03-03 wires these together: worker shard flush on teardown + Reporter `onBegin`/`onEnd` merge + gated prune + CAP-02/CAP-03 integration proofs. The fixture still constructs an in-process per-worker store this wave (disk load/flush lands in 03-03), so the e2e suite exercises capture->heal within a single run exactly as before — only the KEY changed.

## Deviations from Plan

### Out-of-band / environment fixes (applied by orchestrator, not redone here)

**1. [Rule 3 - Blocking, package-manager exception] `@types/node` manual install**
- **Found during:** Task 1 — `persistence.ts` and its temp-dir tests need `node:fs`/`path`/`os` typings; `tsc` failed without `@types/node`.
- **Issue:** `npm install` crashed with an internal npm resolver bug, so the normal install path was unavailable.
- **Fix:** `@types/node@24.10.1` was installed by fetching the registry tarball and verifying its SHA against the registry `dist.shasum` before extracting (supply-chain check, consistent with the no-auto-substitute package-install rule). `package.json` carries `"@types/node": "^24"` and `tsconfig.json` was adjusted; `tsc --noEmit` is clean.
- **Follow-up (Phase 4 pre-publish):** `package-lock.json` was NOT updated by the manual extract, so it has no `@types/node` entry. A clean `npm install` must be re-run locally and in CI to materialize the lockfile entry before publish. Flagged for Phase 4.
- **Files:** package.json, tsconfig.json

**2. [Rule 1 - Bug] Raw NUL bytes in source replaced with ` ` escape**
- **Found during:** Post-checkpoint (committed after Task 2 GREEN as `3cf146a`).
- **Issue:** The content-key separator in `src/integration/locator-proxy.ts` and the fingerprint join delimiter in `src/store/merge.ts` used raw NUL (`\0`) bytes, which made git/tooling read the files as binary and would have shipped that way.
- **Fix:** Replaced the raw NUL with the ` ` escape sequence — same runtime NUL delimiter, but ASCII-clean source. Verified present at `locator-proxy.ts:287` and `merge.ts:45`.
- **Commit:** 3cf146a

### Note
A stale JSDoc reference to `HealContext.nextStep` remains in a comment at `locator-proxy.ts:263` (documentation only — no live `nextStep`/`createStepCounter` code remains). Harmless; can be tidied opportunistically in 03-03.

## Requirements

CAP-02 and CAP-03 are the plan's mapped requirements. This plan delivers their **plumbing**: the durable, corruption-safe, rootDir-anchored persistence seam (CAP-02 round-trip mechanics, CAP-03 single-writer atomic + per-worker shard shape) and the cross-run-stable key that makes a persisted baseline addressable across runs. Both requirements **fully close in Plan 03-03**, which wires the reporter shard merge and lands the CAP-02 (heal-on-run-N from baseline-captured-on-run-N-1) and CAP-03 (concurrent multi-worker, no corruption) integration proofs. They were already marked Complete in REQUIREMENTS.md from the pure-layer work in 03-01; left as Complete with this plumbing note.

## Commits

- `75e16e5` test(03-02): add failing fs persistence adapter spec (RED)
- `c4b8a20` feat(03-02): fs persistence adapter with Windows-safe atomic write (GREEN)
- `1f59336` test(03-02): add failing occurrence-key spec; port step-identity to 4-arg identify (RED)
- `6067bf5` feat(03-02): occurrence-based identity key replacing run-order step counter (GREEN)
- `3cf146a` fix(03-02): use   escape instead of raw NUL byte in source

## TDD Gate Compliance

Both tasks followed RED -> GREEN: a `test(03-02)` commit precedes each `feat(03-02)` implementation commit. No refactor commits were needed. Gate sequence intact.

## Self-Check: PASSED

All created files present (persistence.ts, persistence.test.ts, occurrence.test.ts, 03-02-SUMMARY.md) and all 5 commits (75e16e5, c4b8a20, 1f59336, 6067bf5, 3cf146a) exist in the repo.
