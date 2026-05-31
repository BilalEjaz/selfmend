---
phase: 03-persistence-parallel-worker-safety
verified: 2026-05-31T16:50:00Z
status: passed
score: 8/8
overrides_applied: 0
---

# Phase 03: Persistence & Parallel-Worker Safety Verification Report

**Phase Goal:** The baseline store survives across runs (CAP-02) and stays corruption-free under Playwright parallel workers (CAP-03), via a committed single JSON baseline plus lock-free per-worker shards merged at teardown.
**Verified:** 2026-05-31T16:50:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | CAP-02: a fingerprint captured in run N heals in run N+1 from the committed baseline.json alone | VERIFIED | `tests/parallel-store.spec.ts` CAP-02 test passes (21/21 green); crossrun.pwspec.ts executes two sequential child processes sharing one temp store dir; the heal phase loads ONLY the committed file |
| 2 | CAP-03: a real workers>1 run merges all worker shards into one valid baseline with no lost writes or corruption | VERIFIED | `tests/parallel-store.spec.ts` CAP-03 test passes with `--workers=4`; 4 distinct capture keys confirmed present post-merge; schema validates clean |
| 3 | Merge+prune lives in the Reporter (onBegin completeness + onEnd merge/refresh/gated-prune); workers write only their shard, NEVER baseline.json | VERIFIED | `fixture.ts`: `loadBaseline` + `writeShard(shardPath(..., parallelIndex))` present; `grep -n "baselinePath\|atomicWrite" fixture.ts` returns nothing; `reporter.ts` has `onBegin` capturing `isComplete`, `onEnd` calling full merge chain |
| 4 | D-09 prune safety: prune only when complete (grep match-all + grepInvert null + shard null + no argv narrowing flag) AND passed AND SELFMEND_PRUNE opt-in; a --grep filtered run REFRESHES but does NOT prune | VERIFIED | `tests/prune.spec.ts` both tests pass; `isComplete` exported and unit-tested against all filter combinations including argv-level `--grep`; `shouldPrune` gate proven in reporter.test.ts; `NARROWING_CLI_FLAGS` list covers `--grep/-g/--grep-invert/--shard/--last-failed/--only-changed/--project` |
| 5 | The committed baseline.json is versioned, deterministically serialized, and derived-signals-only (no innerHTML/outerHTML/innerText/raw DOM; schema rejects them) | VERIFIED | `fingerprintSchema` uses `z.strictObject` with exactly 8 derived fields; schema.test.ts proves innerHTML/outerHTML/html/innerText each fail strict parse; serialize.ts emits fixed field order + sorted attrs + sorted entry keys; serialize.test.ts byte-identical-under-reordering proof passes |
| 6 | .gitignore: baseline.json is committable (git check-ignore exits non-zero); .selfmend/shards/ is ignored | VERIFIED | `git check-ignore .selfmend/baseline.json` exits 1 (not ignored); `git check-ignore .selfmend/shards/shard-0.json` exits 0 (ignored); `.gitignore` uses `/.selfmend/*` + `!/.selfmend/baseline.json` pattern |
| 7 | Occurrence-based identity key replaced run-order step counter; no nextStep/createStepCounter remain in src | VERIFIED | `grep -rn "nextStep\|createStepCounter" src/` returns nothing; `createOccurrenceCounter` present in locator-proxy.ts; `identify(selector, testFile, testTitle, occurrence)` is the 4-arg signature in store.ts; occurrence.test.ts and step-identity.test.ts pass |
| 8 | Full suite green: npx vitest run (119 tests), npx playwright test (21 tests), npx tsc --noEmit; no NUL bytes in src | VERIFIED | vitest: 11 files, 119 tests passed; playwright: 21 tests passed including new parallel-store + prune specs; tsc exits 0; NUL byte scan clean |

**Score:** 8/8 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/store/schema.ts` | STORE_FORMAT_VERSION + zod schemas + safe loaders | VERIFIED | Exports STORE_FORMAT_VERSION=1, fingerprintSchema (strictObject, 8 fields), baselineFileSchema, shardFileSchema, parseBaseline, parseShard; all pure, no fs/Playwright |
| `src/store/serialize.ts` | Pure deterministic serializer | VERIFIED | Exports serialize(); sorts entry keys + fixed fingerprint field order + sorted attrs; byte-identical output; pure |
| `src/store/merge.ts` | Pure mergeShards + refresh + prune | VERIFIED | Exports all three; deterministic conflict rule (larger value-derived compare key wins); order-independent proven; pure |
| `src/store/persistence.ts` | fs adapter: paths, loadBaseline, writeShard, readShards, atomicWrite, deleteShards | VERIFIED | All exports present; atomicWrite with EPERM/EBUSY/EACCES retry + backoff; path containment via storeRoot; only fs-importing file in src/store |
| `src/store/store.ts` | Occurrence-based identify() + seen tracking + toShard()/fromBaseline() | VERIFIED | identify(selector, testFile, testTitle, occurrence) 4-arg; markSeen/seenKeys; toShard/toBaselineFile/fromBaseline all present |
| `src/integration/fixture.ts` | Worker shard flush + load-from-baseline; writeShard NOT baselinePath | VERIFIED | loadBaseline at worker setup; writeShard(shardPath(..., parallelIndex)) at teardown; no atomicWrite/baselinePath |
| `src/reporter/reporter.ts` | onBegin completeness + onEnd merge/refresh/prune/atomicWrite/deleteShards | VERIFIED | onBegin captures isComplete + rootDir; onEnd calls mergeAndPersist: readShards -> mergeShards -> loadBaseline -> refresh -> shouldPrune? -> prune -> atomicWrite -> deleteShards |
| `tests/parallel-store.spec.ts` | Real workers>1 merge proof + cross-run heal | VERIFIED | CAP-03 (4-worker child run) and CAP-02 (two sequential child runs) both passing |
| `tests/prune.spec.ts` | Filtered run does NOT prune; opt-in gate | VERIFIED | Both D-09 tests passing; proves beta key survives after --grep alpha-only run even with SELFMEND_PRUNE=1 |
| `.gitignore` | baseline.json committable; shards/temp ignored | VERIFIED | Pattern: `/.selfmend/*` + `!/.selfmend/baseline.json`; shards dir and *.tmp entries present |
| `playwright.parallel.config.ts` | Dedicated inner config for parallel specs | VERIFIED | testDir: tests/parallel; testMatch: *.pwspec.ts; fullyParallel: true; reporter includes selfmend reporter |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/reporter/reporter.ts` | `src/store/merge.ts + serialize.ts + persistence.ts` | onEnd: mergeShards -> refresh -> prune? -> serialize -> atomicWrite -> deleteShards | WIRED | All 6 calls present and sequenced in mergeAndPersist() |
| `src/integration/fixture.ts` | `src/store/persistence.ts` | loadBaseline at worker start; writeShard(shardPath) at worker teardown | WIRED | Lines 7-10, 123-128 confirmed |
| `src/reporter/reporter.ts` | FullConfig + FullResult | onBegin reads grep/grepInvert/shard; onEnd reads result.status | WIRED | isComplete(config) in onBegin; result.status in shouldPrune() call in onEnd |
| `src/store/serialize.ts` | `src/store/schema.ts` | imports STORE_FORMAT_VERSION + BaselineFile type | WIRED | Line 1 confirmed |
| `src/store/merge.ts` | `src/matching/types.ts` | imports Fingerprint type | WIRED | Line 3 confirmed; no fs/Playwright |
| `src/integration/locator-proxy.ts` | `src/store/store.ts` | store.identify(selector, testFile, testTitle, occurrence) | WIRED | Lines 209-214 confirmed |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `tests/parallel-store.spec.ts` | `parsed.entries` | child process runs real playwright with worker fixtures; reporter merges shards into baseline.json; driver reads that file | Yes — schema validation passes; 4 keys confirmed for 4 workers | FLOWING |
| `src/integration/fixture.ts` | `store` (BaselineStore) | `loadBaseline(rootDir)` reads committed baseline.json via fs; `writeShard` flushes to shard file | Yes — real fs round-trip proven by persistence.test.ts and parallel-store.spec.ts | FLOWING |
| `src/reporter/reporter.ts` | `merged` / `next` | `readShards` reads real shard files; `mergeShards` merges; `atomicWrite` writes committed baseline | Yes — full chain exercised in 21-test playwright suite | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| All unit tests | `npx vitest run` | 11 files, 119 tests, 0 failures | PASS |
| Full e2e suite including parallel + prune specs | `npx playwright test` | 21 tests, 0 failures | PASS |
| TypeScript compile | `npx tsc --noEmit` | exit 0, no output | PASS |
| baseline.json committable | `git check-ignore .selfmend/baseline.json` | exit 1 (not ignored) | PASS |
| shards ignored | `git check-ignore .selfmend/shards/shard-0.json` | prints match, exit 0 | PASS |
| No nextStep/createStepCounter in src | `grep -rn "nextStep\|createStepCounter" src/` | no output | PASS |
| No NUL bytes in src | node fs scan | "No NUL bytes in src/*.ts" | PASS |
| Pure layer has no fs/playwright imports | `grep -n "import.*node:fs\|playwright" schema.ts serialize.ts merge.ts` | only comments, no import lines | PASS |
| No page/DOM access in reporter | `grep -n "page\.\|evaluate\|document\." reporter.ts` | no output | PASS |
| No baselinePath/atomicWrite in fixture | `grep -n "baselinePath\|atomicWrite" fixture.ts` | no output | PASS |

### Probe Execution

No probe scripts defined for this phase. Behavioral verification was performed via the playwright test suite directly.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| CAP-02 | 03-01, 03-02, 03-03 | Captured fingerprints persist to a local baseline store that survives across runs | SATISFIED | parallel-store.spec.ts CAP-02 test: fresh-process heal from committed file alone; persistence round-trip unit tests |
| CAP-03 | 03-01, 03-02, 03-03 | Baseline capture is safe under Playwright parallel workers, no store corruption or races | SATISFIED | parallel-store.spec.ts CAP-03 test: 4-worker run, 4 keys merged, no corruption; workers write only shards; reporter is sole baseline writer |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None | — | — | — | — |

No TBD, FIXME, XXX, placeholder stubs, return null/empty, hardcoded empty data, or console.log-only implementations found in any phase-modified source file.

### Human Verification Required

None. All critical behaviors were programmatically verified:

- The prune safety gate was proven both at the unit level (reporter.test.ts isComplete + shouldPrune cases) and end-to-end (prune.spec.ts).
- The CAP-02 cross-run heal was proven by two sequential child playwright processes sharing a temp store dir.
- The CAP-03 parallel merge was proven by a 4-worker child run with schema validation of the resulting baseline.

### Gaps Summary

No gaps. All 8 must-haves verified, all artifacts substantive and wired, all key links confirmed, full suite green.

---

_Verified: 2026-05-31T16:50:00Z_
_Verifier: Claude (gsd-verifier)_
