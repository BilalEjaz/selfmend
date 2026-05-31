---
phase: 03-persistence-parallel-worker-safety
plan: 03
subsystem: persistence
tags: [reporter, parallel-workers, baseline-store, prune-gate, gitignore, integration, tdd]

# Dependency graph
requires:
  - phase: 03-persistence-parallel-worker-safety
    provides: "Pure store layer (mergeShards/refresh/prune/serialize, schema) from Plan 03-01"
  - phase: 03-persistence-parallel-worker-safety
    provides: "persistence.ts fs adapter (loadBaseline/writeShard/readShards/atomicWrite/deleteShards/shardPath), occurrence key, store.toShard()/fromBaseline() from Plan 03-02"
  - phase: 01-thinnest-real-heal
    provides: "Locator Proxy + page fixture + capture/heal loop"
  - phase: 02-trust-hardening
    provides: "summary-only reporter (heals/refused rendering) + decide() trust gates"
provides:
  - "Worker-scoped store fixture: loadBaseline(rootDir) at setup (CAP-02 load half), writeShard(shardPath(rootDir, parallelIndex), store.toShard()) at worker teardown (CAP-03, D-11); workers never write baseline.json"
  - "Reporter onBegin completeness capture + async onEnd merge/refresh/gated-prune/atomicWrite/deleteShards; summary rendering + summary-only purity intact (D-05)"
  - "isComplete(config, argv) + shouldPrune(complete, status, env): exported gate predicates, runner-free unit-tested; argv-based CLI-filter detection (the empirical Open Q2/A1 fix)"
  - "BaselineStore.toBaselineFile(): symmetric committed-shape accessor used by the reporter refresh"
  - ".gitignore reconciled: root .selfmend/baseline.json committable (D-01), shards/*.tmp + test-output stores ignored (D-12)"
  - "Real CAP-02 cross-run, CAP-03 4-worker parallel, D-09 filtered-no-prune + opt-in-gate integration proofs"
affects: [04-offline-publish]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Reporter-gated merge+prune in onEnd (the only component holding both the planned Suite and FullResult), NOT globalTeardown (which sees neither)"
    - "Lock-free per-worker shard named by parallelIndex, flushed on worker-fixture teardown; single-writer atomic merge in the reporter"
    - "Run-completeness detection combines FullConfig filters AND process.argv narrowing-flag inspection, because PW 1.60 does NOT surface CLI --grep/--shard/--project on FullConfig (empirically confirmed)"
    - "Integration drivers spawn a child `playwright test` against a dedicated parallel config with a temp SELFMEND_STORE_DIR, then inspect the merged baseline (real concurrency, real reporter merge, repo store untouched)"
    - "Drive the PW CLI via process.execPath + require.resolve('@playwright/test/cli') to avoid Windows npx.cmd spawnSync EINVAL"

key-files:
  created:
    - playwright.parallel.config.ts
    - tests/parallel-store.spec.ts
    - tests/prune.spec.ts
    - tests/parallel/capture.pwspec.ts
    - tests/parallel/crossrun.pwspec.ts
    - tests/parallel/prune.pwspec.ts
  modified:
    - src/integration/fixture.ts
    - src/integration/locator-proxy.ts
    - src/reporter/reporter.ts
    - src/reporter/reporter.test.ts
    - src/store/store.ts
    - src/store/persistence.ts
    - playwright.config.ts
    - .gitignore

key-decisions:
  - "[03-03] The merge+prune lives in the Reporter onEnd, not globalTeardown: only the reporter holds both the post-filter planned Suite (onBegin) and the FullResult.status (onEnd) needed to gate the destructive prune (D-09). globalTeardown receives only FullConfig and cannot tell a filtered run from a complete one."
  - "[03-03] Run-completeness (isComplete) inspects BOTH FullConfig (grep match-all + null grepInvert + null shard) AND process.argv for narrowing flags (--grep/-g/--grep-invert/--shard/--last-failed/--only-changed/--project). EMPIRICAL (SELFMEND_DEBUG): PW 1.60 leaves FullConfig.grep at /.*/ for a CLI `--grep` run, so FullConfig-only detection would wrongly prune a filtered run (a D-09 violation). The argv check closes the gap. (Open Q2/A1 resolved.)"
  - "[03-03] Destructive prune stays gated behind the SELFMEND_PRUNE opt-in AND complete-run AND passed; refresh-on-pass (non-destructive, D-08) always runs. A narrowing we cannot detect (e.g. a positional single-file run) at worst leaves stale entries (the file grows slowly), never wrongly deletes a valid baseline."
  - "[03-03] The teardown merge is wrapped in try/catch: a merge/IO failure logs a warning and leaves the run untouched, never crashing a user's suite on teardown (T-03-08, Pitfall 5)."
  - "[03-03] .gitignore un-ignores ONLY the root /.selfmend/baseline.json (D-01) while ignoring root shards/*.tmp and ALL test-output stores (tests/.selfmend, .tmp-store-*); the committed contract artifact is a consuming project's single baseline, not this repo's fixture-app run output."
  - "[03-03] Integration proofs run REAL Playwright child processes (CAP-03 with --workers=4) against a dedicated parallel config + temp SELFMEND_STORE_DIR, so the worker shard flush and the reporter merge are exercised exactly as in production, with the repo's real .selfmend never touched."

patterns-established:
  - "RED -> GREEN for the reporter gate task: test(03-03) then feat(03-03); other tasks are non-TDD wiring/integration commits"
  - "Inner integration specs are *.pwspec.ts under tests/parallel/ (default config testIgnores them); driver *.spec.ts under tests/ spawn them"

requirements-completed: [CAP-02, CAP-03]

# Metrics
duration: 33min
completed: 2026-05-31
---

# Phase 3 Plan 03: Durable Parallel-Safe Store Wiring Summary

**Workers load the committed baseline read-only and flush parallelIndex shards on teardown; the Reporter merges all shards, refreshes (always) and prunes (opt-in, complete-run-only via a FullConfig+argv completeness gate), atomically writes the single committed baseline.json and deletes shards; .gitignore commits the baseline while ignoring shards/temp; CAP-02 cross-run heal, CAP-03 4-worker parallel merge, and D-09 filtered-no-prune are each proven by a real Playwright child run.**

## What Was Built

### Task 1 — Worker shard flush + load-from-baseline (`src/integration/fixture.ts`)
The worker-scoped `selfmendStore` fixture changed from `new BaselineStore()` to a load-then-flush worker fixture (RESEARCH Pattern 2): SETUP `await loadBaseline(workerInfo.config.rootDir)` seeds the in-memory store with prior-run fingerprints (the CAP-02 load half, so a locator broken this run can heal against run N-1's capture); TEARDOWN (after `use`) `await writeShard(shardPath(rootDir, workerInfo.parallelIndex), store.toShard())` flushes this worker's captures + seen-keys to its own bounded, lock-free shard. `parallelIndex` (not `workerIndex`) keeps the shard count bounded and lets a restarted worker overwrite its own stale shard. Workers NEVER write `baseline.json` (the CAP-03 anti-pattern is avoided). The stale `nextStep` JSDoc reference in `locator-proxy.ts` (flagged by 03-02) was tidied to `nextOccurrence`.

### Task 2 — Reporter onBegin/onEnd merge + gated prune (`src/reporter/reporter.ts`, TDD)
EXTENDED the summary-only reporter. `onBegin(config, suite)` captures `rootDir`, the completeness signal via `isComplete()`, and the planned test count; a `SELFMEND_DEBUG` log empirically confirms the real 1.60 grep representation. `onEnd` widened to async: it renders the boxed summary EXACTLY as before, then performs the teardown merge side effect wrapped in try/catch — `readShards -> mergeShards -> refresh (always, D-08) -> shouldPrune-gated prune (complete+passed+SELFMEND_PRUNE, D-09) -> atomicWrite(baseline.json) -> deleteShards`. Exported `isComplete`/`shouldPrune` are unit-proven runner-free (RED then GREEN). `BaselineStore.toBaselineFile()` was added (symmetric to `toShard()`) so the reporter can refresh the loaded committed baseline. The reporter holds no page/DOM — summary-only purity preserved (D-05).

### Task 3 — .gitignore + config + real integration proofs
`.gitignore` reconciled: root `/.selfmend/baseline.json` is committable (D-01) while root `shards/`, `*.tmp`, and all test-output stores (`tests/.selfmend/`, `.tmp-store-*/`) are ignored (D-12). A dedicated `playwright.parallel.config.ts` (testMatch `*.pwspec.ts`, fullyParallel) lets the inner specs run with real concurrency; the default config testIgnores `parallel/`. `tests/parallel-store.spec.ts` drives a child `--workers=4` capture run and asserts the merged baseline holds every worker's key with no loss/corruption (CAP-03) plus a two-phase capture-then-heal that heals from the committed file alone (CAP-02). `tests/prune.spec.ts` proves a `--grep` run refreshes but does NOT prune the unseen key, and that a complete passing run without `SELFMEND_PRUNE` never deletes (D-09 / opt-in gate). All inner runs redirect the store to a temp `SELFMEND_STORE_DIR`.

### Task 4 — Phase gate (checkpoint:human-verify, gate=blocking)
Full suite + tsc + explicit parallel run + baseline inspection + gitignore checks were executed (results below). Per the blocking gate, this plan does NOT self-approve — it returns CHECKPOINT REACHED for human verification.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] isComplete must inspect process.argv, not FullConfig alone**
- **Found during:** Task 3 — the first D-09 `--grep` integration run pruned the unseen key (got 1 key, expected 2).
- **Root cause (empirical, SELFMEND_DEBUG):** Playwright 1.60 does NOT reflect a CLI `--grep`/`--shard`/`--project` on `FullConfig.grep/grepInvert/shard` — `config.grep` stays `/.*/`; the filter manifests only as a reduced planned suite. FullConfig-only completeness detection therefore reported `complete=true` on a filtered run and wrongly pruned (a D-09 violation, exactly RESEARCH A1/A2/Open Q1).
- **Fix:** `isComplete(config, argv = process.argv)` now ALSO returns false when argv carries any narrowing flag (`--grep`/`-g`/`--grep-invert`/`--shard`/`--last-failed`/`--only-changed`/`--project`, long-form `=value` too). Added a unit test covering the CLI-grep case; the D-09 integration spec now passes.
- **Files modified:** src/reporter/reporter.ts, src/reporter/reporter.test.ts
- **Commit:** d742c7b

**2. [Rule 1 - Bug] atomicWrite must mkdir -p the target directory**
- **Found during:** Task 3 — the default e2e run's reporter onEnd warned `ENOENT ... baseline.json...tmp` when no worker had created the store dir.
- **Issue:** `atomicWrite` wrote a temp sibling without ensuring the target dir existed; the first committed write of a run (empty-capture run, or a fresh `SELFMEND_STORE_DIR`) had no dir.
- **Fix:** `atomicWrite` now `mkdir(dirname(target), {recursive:true})` before writing the temp file.
- **Files modified:** src/store/persistence.ts
- **Commit:** d742c7b

### Note
The integration proofs use REAL child `playwright test` processes (not in-process simulation) so the worker shard flush and the reporter merge are exercised exactly as in production. The child CLI is driven via `process.execPath` + `require.resolve('@playwright/test/cli')` to avoid a Windows `npx.cmd` `spawnSync EINVAL`.

## Requirements

CAP-02 and CAP-03 fully close in this plan: CAP-02 is proven end-to-end by the cross-run capture-then-heal spec (a fingerprint persisted in run N heals in run N+1 from the committed baseline.json alone); CAP-03 is proven by a real `--workers=4` run merging four workers' captures into one valid, schema-parseable, corruption-free baseline. D-09 (filtered run never prunes; prune is complete-run-only + opt-in) is proven by the prune spec and the argv-based completeness gate.

## Commits

- `ea5af5f` feat(03-03): worker fixture loads baseline at setup, flushes parallelIndex shard at teardown (also tidied the stale nextStep comment)
- `2102ae9` test(03-03): add failing isComplete + shouldPrune gate cases (RED)
- `3341bad` feat(03-03): reporter onBegin completeness capture + onEnd merge/refresh/gated-prune (GREEN)
- `d742c7b` feat(03-03): gitignore reconcile + CAP-02/CAP-03/D-09 integration proofs

## TDD Gate Compliance

Task 2 (the reporter gate, `tdd="true"`) followed RED -> GREEN: `2102ae9` (test, failing isComplete/shouldPrune) precedes `3341bad` (feat, implementation). Tasks 1 and 3 are wiring/integration tasks (not behavior-adding pure logic) and are committed as feat. No refactor commits were needed.

## Verification Evidence (Task 4 phase gate)

- `npx vitest run` — 11 files, **119 tests passed** (was 106 in 03-02; +13 reporter gate/merge cases).
- `npx playwright test` — **21 passed** (was 17; +4 integration proofs: CAP-02, CAP-03, D-09 x2). Phase 1/2 heal / no-false-green / ambiguous-no-heal behavior unchanged; healed box + could-not-heal section render intact.
- `npx playwright test --config playwright.parallel.config.ts capture.pwspec.ts --workers=4` — **4 passed across 4 workers**; merged temp baseline has 4 keys, version 1, deterministically sorted, derived-signals-only (no innerHTML/outerHTML/html/innerText), human-readable multiline JSON (D-01/D-02/D-03 contract holds).
- Positive prune sanity: a complete+passed run with `SELFMEND_PRUNE=1` dropped an injected stale-orphan key (3 -> 2) while keeping both seen keys — the gate is bidirectional, not always-off.
- `npx tsc --noEmit` — exit 0.
- `git check-ignore .selfmend/baseline.json` — exits non-zero (committable, D-01); `git check-ignore .selfmend/shards/shard-0.json` — matches (ignored, D-12).
- Reporter purity: no `page.`/`evaluate`/`document.` in reporter.ts (summary-only, D-05).
- Working tree clean after runs (no store artifacts staged or leaked).

## Known Stubs
None. The full Phase 3 vertical is wired and proven end-to-end.

## Self-Check: PASSED

All 6 created files exist on disk; all 4 task commits (ea5af5f, 2102ae9, 3341bad, d742c7b) are present in git history.

---
*Phase: 03-persistence-parallel-worker-safety*
*Completed: 2026-05-31 (pending Task 4 human-verify gate approval)*
