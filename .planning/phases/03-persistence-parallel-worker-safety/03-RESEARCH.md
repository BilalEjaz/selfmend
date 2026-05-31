# Phase 3: Persistence & Parallel-Worker Safety - Research

**Researched:** 2026-05-31
**Domain:** Durable, parallel-safe on-disk baseline store for a Playwright plugin (TypeScript, Node 22+/24, Windows-first dev)
**Confidence:** HIGH (all Playwright API contracts verified against the installed `@playwright/test@1.60.0` type definitions; Windows `fs.rename` semantics verified against current Node issues)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Merged baseline is COMMITTED to the repo — a single human-readable JSON file (e.g. `.selfmend/baseline.json`). Team shares fingerprints; CI heals on first run; diffs are reviewable.
- **D-02:** Committed file stores DERIVED signals ONLY (text, role, test-id, attributes, neighbour, DOM position) — never raw innerText / full DOM (PII). Hard constraint because the file is committed.
- **D-03:** Serialization is DETERMINISTIC (stable/sorted key order, stable field order) — re-running without real change produces no diff churn.
- **D-04:** A fingerprint's identity is `testFile + test title + selector string + occurrence-index` (the Nth creation of that selector within that test). REPLACES the Phase 1 run-order `step` counter.
- **D-05:** The occurrence-index is computed from deterministic execution order within the test, so it is computable at heal time even though the broken locator does not resolve (it depends on how many times that selector was created before, not on the element existing).
- **D-06:** Stability/sensitivity tradeoff accepted: renaming a test or reordering a selector's uses orphans those baselines, which are recaptured on the next passing run. Preferred over `testFile + selector`-only (the CR-01/LO-02 collision class).
- **D-07:** Fail-safe on ambiguity/miss: computed key has no stored baseline -> NO heal (re-throw, test fails normally). Never guess across keys.
- **D-08:** Refresh-on-pass: when a locator resolves on a green run, overwrite its stored fingerprint.
- **D-09:** Prune-unseen ONLY after a COMPLETE run. A partial/filtered run (`--grep`, `--shard`, single-file, failed) must REFRESH-ONLY and never prune. Pruning requires a reliable "complete run" signal.
- **D-10:** Store-format is part of the public semver contract. File carries a format version; an unrecognized/older format is handled gracefully (migrate or ignore-and-recapture, never crash).
- **D-11:** Per-worker shards merged at teardown: each worker writes its own shard (lock-free); a `globalTeardown` merges all shards into the single committed baseline, applies refresh+prune, then deletes shards.
- **D-12:** Shard/temp files are TRANSIENT: written under an ignored path (`.selfmend/shards/` or temp dir), gitignored, removed after a successful merge. Only `baseline.json` is committed.
- **D-13:** Merge conflict within a run: when two workers captured the same key, the merge is deterministic (last-writer or defined precedence) so output is stable regardless of worker timing.

### Claude's Discretion
- Exact file paths/names; precise JSON schema + version field; the atomic-write mechanism (temp + rename); HOW the "complete run" signal is obtained from Playwright; shard file format (JSON vs JSONL); and the globalTeardown vs reporter split for the merge. Keep the pure matching core untouched; store + integration layers carry these changes.

### Deferred Ideas (OUT OF SCOPE)
- Network-blocked offline proof + npm publish: Phase 4.
- Committed original-to-healed selector store (V2-06) and JSON/HTML report files (V2-05): v2.
- `node:sqlite` store: revisit only if JSON+shards shows real contention at scale (rejected for the committed/diffable case now).
- Per-test override of identity/heal id: not needed (occurrence-based key chosen).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CAP-02 | Captured fingerprints persist to a local baseline store that survives across runs | Load committed `.selfmend/baseline.json` on worker start; refresh-on-pass during run; merge shards into the committed file at globalTeardown. Cross-run-stable occurrence key (D-04) is the prerequisite — the Phase 1 `step` counter does not survive a run. JSON schema + format versioning (D-10) sections below. |
| CAP-03 | Baseline capture is safe under Playwright parallel workers, with no store corruption or races | Per-worker shard files keyed by `workerInfo.parallelIndex` (unique among concurrently-running workers, [CITED]) written lock-free; single-threaded `globalTeardown` merge. No worker ever writes `baseline.json`. Windows-safe atomic write (temp + rename + retry) for the single teardown writer. |
</phase_requirements>

## Summary

Phase 3 graduates the Phase 1 in-memory `Map` (`src/store/store.ts`) into a file-backed, parallel-safe store without touching healing behaviour or the pure matching core. The shape is locked by CONTEXT.md: a single committed `baseline.json`, transient per-worker shards, a globalTeardown merge, an occurrence-based identity key, and format versioning. Research resolves the three genuine unknowns.

**(a) WHERE merge+prune runs and HOW it knows a run is complete — the D-09 unknown.** Use a **custom Reporter** (selfmend's existing reporter, extended) for the merge, NOT `globalTeardown`. `Reporter.onBegin(config, suite)` receives the post-filter planned `Suite` — `suite.allTests()` is the exact set of tests Playwright intends to run after `--grep`/`--shard`/file filters are applied [VERIFIED: @playwright/test@1.60.0 testReporter.d.ts]. The reporter compares the run against `FullConfig` to decide completeness: a run is COMPLETE iff `config.grep` is the default match-all (`/.*/`), `config.grepInvert` is null, `config.shard` is null, AND `onEnd(result)` reports `result.status === 'passed'` [VERIFIED: testReporter.d.ts FullResult.status]. `globalTeardown` only receives `FullConfig` (no run results, no suite), so it cannot tell a filtered run from a complete one — that is why D-11's "globalTeardown merges" must be reconciled toward the reporter. The merge mechanically can run in either, but the *prune gate* needs `FullResult` + the planned `Suite`, both of which only the Reporter has.

**(b) Windows-safe atomic write + shard scheme.** Each worker writes its own shard `.selfmend/shards/shard-<parallelIndex>.json` (or `.jsonl`) — `parallelIndex` is guaranteed distinct among workers running at the same time [VERIFIED: test.d.ts WorkerInfo.parallelIndex], so shards never collide and need no lock. The merge writes `baseline.json` exactly once, single-threaded, via temp-file + `fs.rename`, wrapped in a short retry-with-backoff loop because **on Windows `fs.rename` over an existing target fails with `EPERM`/`EBUSY` under transient locks** (antivirus, Search indexer) [CITED: nodejs/node#29481, npm/write-file-atomic#227]. No lockfile is needed for either path.

**(c) Occurrence-key implementation.** Replace the per-test run-order `step` counter with a per-`(test, selector)` occurrence counter. At `wrapLocator` time, look up a `Map<string, number>` keyed by the *content* identity `testFile :: titlePath :: selectorString` and post-increment to get the occurrence index. Because the count depends only on how many times that selector string was created earlier in the test (deterministic execution order, D-05), it is identical at capture time and at heal time even though the broken element is absent. `testInfo.titlePath` gives a stable, file-rooted test title [VERIFIED: test.d.ts TestInfo.titlePath]. This ripples into `locator-proxy.ts` (drop `nextStep`, add occurrence lookup) and `store.identify()`.

**Primary recommendation:** Reporter-driven merge+prune (gated on `FullConfig` filters + `FullResult.status`); `parallelIndex`-named lock-free shards; hand-rolled temp+rename atomic write with EPERM/EBUSY retry (no new runtime dep); occurrence key built from `titlePath + selector` with a per-(test,selector) counter.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Cross-run identity key | Pure store (`store.ts`) | Integration (`locator-proxy.ts` supplies occurrence index) | Key derivation is deterministic data logic; the proxy supplies the runtime inputs (selector, titlePath, occurrence count). |
| Load baseline on start | Integration (worker fixture) | Store (parse + validate) | Workers run in separate processes; each loads the committed file read-only at worker scope. |
| Capture / refresh during run | Worker (fixture + proxy) | Store (in-memory accumulation) | DOM access only exists in the worker; captures accumulate in worker memory then flush to a shard. |
| Shard write | Worker (fixture teardown) | fs | Worker owns its shard file by `parallelIndex`; flush on worker-fixture teardown. |
| Merge + refresh + prune | Main process (Reporter `onEnd`) | Store (pure merge fn) | Only the main process sees all shards + the run-completeness signal (`FullConfig` + `FullResult` + planned `Suite`). |
| Completeness detection (D-09) | Main process (Reporter `onBegin`/`onEnd`) | — | `FullConfig.grep/grepInvert/shard` + `FullResult.status` are only available to the Reporter. |
| Atomic file write | Main process (merge step) | fs | Single-threaded writer; the only place `baseline.json` is written. |
| Deterministic serialization | Pure store | — | Stable sort + stable field order is pure logic, Vitest-testable. |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `node:fs` / `node:fs/promises` | built-in (Node >=22) | Read/write baseline + shards, temp+rename atomic write | Zero dep; the project's STACK.md mandates a minimal runtime footprint for the offline/trust guarantee. `fs.rename` is atomic on same-volume POSIX; on Windows needs retry (see Pitfalls). |
| `node:path` | built-in | Resolve `.selfmend/` paths relative to `config.rootDir` | `FullConfig.rootDir` [VERIFIED: test.d.ts] is the stable anchor for the store location. |
| `node:crypto` (optional) | built-in | Short hash of long selector strings for shard compactness | Only if selector strings bloat shards; not required. |
| `zod` | `^4` (already a dep) | Validate the on-disk baseline schema + version on load (D-10) | Already in `dependencies`; STACK.md explicitly recommends it for "guards against corrupt/old-format stores". Reuse — do not add a parser. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `write-file-atomic` | `8.0.0` | Battle-tested atomic write with built-in Windows EPERM retry | ONLY if the hand-rolled temp+rename+retry proves flaky in CI. Adds one runtime dep — weigh against the zero-dep trust posture. `[VERIFIED: npm registry]` slopcheck [OK], npm-org owned, 8+ yrs. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Per-worker shards + reporter merge | Single file + `proper-lockfile` advisory lock | Lock contention under high parallelism + the exact Windows file-locking pitfalls D-11 was chosen to avoid. Rejected by D-11. |
| JSON file | `node:sqlite` (Node 22.5+, no native build) | Binary, not diffable, defeats the committed/reviewable-PR value (D-01). Explicitly deferred. |
| Reporter-driven merge | `globalTeardown`-driven merge | `globalTeardown` receives only `FullConfig` — it CANNOT see `FullResult.status` or the planned `Suite`, so it cannot safely gate the prune (D-09). Use the Reporter. |
| Hand-rolled atomic write | `write-file-atomic` dep | Dep removes the Windows-retry footgun but violates zero-runtime-dep posture. Hand-roll first; fall back to the dep if CI flakes. |

**Installation:** No new runtime dependency required for the recommended path (`node:fs` + existing `zod`). If the `write-file-atomic` fallback is taken:
```bash
pnpm add write-file-atomic
```

**Version verification:** `write-file-atomic` latest is `8.0.0`, modified 2026-05-08 [VERIFIED: npm view]. `zod@^4` and `@playwright/test@1.60.0` already installed and pinned.

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `write-file-atomic` | npm | 8+ yrs | very high (npm internal dep) | github.com/npm/write-file-atomic | [OK] | Approved (fallback only) |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

The recommended path adds NO new runtime package (uses `node:fs` + already-present `zod`). `write-file-atomic` is audited only as a documented fallback.

## Architecture Patterns

### System Architecture Diagram

```
                         ┌──────────────────────────────────────────────┐
   COMMITTED (git)       │  .selfmend/baseline.json   (single, diffable) │
                         └───────▲───────────────────────────┬──────────┘
                                 │ read-only at worker start  │ written ONCE
                                 │                            │ (temp+rename+retry)
   ┌─────────────────────────────┼────────────────────────────┼──────────────────┐
   │  WORKER PROCESS (N parallel)│                            │  MAIN PROCESS    │
   │                             │                            │                  │
   │  worker fixture:            │                            │  Reporter        │
   │   loadBaseline(path) ───────┘                            │   onBegin(cfg,   │
   │      │                                                   │     suite):      │
   │      ▼                                                   │     plannedTests │
   │  in-memory store (per worker)                            │     = suite      │
   │      │  refresh-on-pass (D-08)                           │       .allTests()│
   │      │  capture-on-success (CAP-01)                      │     complete? =  │
   │      ▼                                                   │       cfg.grep== │
   │  on worker teardown:                                     │       matchAll & │
   │   flush -> .selfmend/shards/shard-<parallelIndex>.json ──┼──┐  !shard &&    │
   │            (lock-free; unique filename per worker)       │  │  !grepInvert  │
   └─────────────────────────────────────────────────────────┘  │              │
                                                                  ▼              │
                                                       onEnd(result):            │
                                                        readAllShards() ─────────┘
                                                        merged = merge(shards)    (D-13 deterministic)
                                                        refreshed = baseline ⊕ merged   (D-08)
                                                        if (complete && result.status==='passed')
                                                            pruned = prune(refreshed, seenKeys)  (D-09)
                                                        atomicWrite(baseline.json, serialize(...))  (D-03)
                                                        deleteShards()            (D-12)
```

Data flow for the prune gate: `onBegin` records the planned test set and the filter flags; workers record `seenKeys` into their shards (every key captured OR resolved this run); `onEnd` only prunes keys absent from `seenKeys` when the run was complete AND passed.

### Recommended Project Structure
```
src/store/
├── store.ts          # BaselineStore: load/has/get/set/identify (occurrence key) + seenKeys tracking
├── schema.ts         # zod schema for baseline.json: { version, entries } (D-10)
├── serialize.ts      # PURE deterministic serializer (stable key+field sort) (D-03) — Vitest target
├── merge.ts          # PURE merge(shards[]) + refresh + prune(seenKeys) (D-08/D-09/D-13) — Vitest target
└── persistence.ts    # fs adapter: paths, loadBaseline, writeShard, readShards, atomicWrite, deleteShards
src/integration/
├── fixture.ts        # worker-scoped store load + shard flush on teardown
└── locator-proxy.ts  # occurrence-index key derivation (replaces nextStep)
src/reporter/
└── reporter.ts       # EXTEND: onBegin captures completeness signal; onEnd runs merge+prune
```

Keep `serialize.ts` and `merge.ts` PURE (no `fs`, no Playwright) — they are the highest-logic-risk, TDD-first units. `persistence.ts` is the thin fs adapter, the only file that imports `node:fs`.

### Pattern 1: Reporter-gated merge + prune (the D-09 mechanism)
**What:** The selfmend Reporter records run-completeness in `onBegin` and performs the merge/refresh/prune in `onEnd`.
**When to use:** This is the ONLY place that has both the planned test set and the run result.
```typescript
// Source: @playwright/test@1.60.0 testReporter.d.ts (verified signatures)
class SelfmendReporter implements Reporter {
  private complete = false;
  private plannedTestCount = 0;

  onBegin(config: FullConfig, suite: Suite): void {
    // suite.allTests() = the post-filter set Playwright will actually run.
    this.plannedTestCount = suite.allTests().length;
    // A run is "complete" only if NO filter narrowed it.
    const grepIsMatchAll = isDefaultGrep(config.grep);      // /.*/ or [] default
    this.complete =
      grepIsMatchAll &&
      config.grepInvert === null &&
      config.shard === null;
    // NOTE: --last-failed / --only-changed have no FullConfig field in 1.60;
    // they manifest as a reduced planned suite. Treat them as NOT complete by
    // also requiring the run to be the project's full suite OR conservatively
    // gate prune behind an explicit opt-in env (SELFMEND_PRUNE=1). See Open Q1.
  }

  async onEnd(result: FullResult): Promise<void> {
    const shards = await readShards(this.shardsDir);
    const merged = mergeShards(shards);                     // D-13 deterministic
    let next = refresh(this.baseline, merged);              // D-08
    const passed = result.status === 'passed';
    if (this.complete && passed) {
      next = prune(next, collectSeenKeys(shards));          // D-09 only here
    }
    await atomicWrite(this.baselinePath, serialize(next));  // D-03
    await deleteShards(this.shardsDir);                     // D-12
  }
}
```

### Pattern 2: Lock-free per-worker shard, flushed on worker teardown
**What:** Each worker accumulates captures in memory and writes ONE shard file named by `parallelIndex` when the worker tears down.
**When to use:** All parallel capture. `parallelIndex` is unique among simultaneously-running workers [VERIFIED: WorkerInfo.parallelIndex], so two shards never collide.
```typescript
// Worker-scoped fixture with automatic teardown (code after `use` runs at worker end).
selfmendStore: [
  async ({ selfmendConfig }, use, workerInfo) => {
    const store = await loadBaseline(baselinePath(workerInfo.config));  // read-only
    await use(store);
    // worker teardown: flush this worker's captures + seenKeys to its own shard
    await writeShard(
      shardPath(workerInfo.config, workerInfo.parallelIndex),
      store.toShard(),
    );
  },
  { scope: 'worker' },
],
```
Note: a restarted worker reuses the same `parallelIndex` [VERIFIED], so a restart overwrites its own (now-stale) shard with the fresh one — which is the correct deterministic outcome.

### Pattern 3: Windows-safe atomic write (temp + rename + retry)
**What:** Write to a unique temp file in the same directory, then `rename` over the target, retrying on Windows transient-lock errors.
```typescript
// Source: nodejs/node#29481, npm/write-file-atomic#227 (Windows EPERM/EBUSY on rename)
async function atomicWrite(target: string, data: string): Promise<void> {
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, data, 'utf8');
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(tmp, target);                 // atomic on same volume
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if ((code === 'EPERM' || code === 'EBUSY' || code === 'EACCES') && attempt < 10) {
        await delay(50 * (attempt + 1));            // backoff for AV / indexer
        continue;
      }
      await fs.rm(tmp, { force: true });
      throw err;
    }
  }
}
```
Keep the temp file in the SAME directory as the target so the rename stays on one volume (a cross-volume rename throws `EXDEV` and is not atomic).

### Anti-Patterns to Avoid
- **Merging in `globalTeardown`:** it gets only `FullConfig`, so it cannot see `FullResult.status` or the planned `Suite` — it cannot gate the prune. Use the Reporter (reconciles D-11 toward the Reporter).
- **Workers writing `baseline.json` directly:** the corruption/race mode CAP-03 exists to prevent (PITFALLS Pitfall 4). Workers write ONLY their own shard.
- **`workerIndex` for shard naming:** `workerIndex` grows on every restart and is NOT bounded by parallelism; use `parallelIndex` (bounded, unique among live workers) so shard count stays bounded.
- **Pruning on a filtered/failed run:** deletes baselines for tests that simply did not execute (D-09). Gate strictly.
- **Cross-volume temp file:** putting the temp file in the OS temp dir then renaming onto the repo volume throws `EXDEV`. Temp goes beside the target.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Run-completeness detection | A custom test-counter heuristic comparing executed vs file-scanned tests | `Reporter.onBegin(config, suite)` + `onEnd(result)` with `FullConfig.grep/grepInvert/shard` + `FullResult.status` | Playwright already exposes the post-filter planned suite and the run status; reimplementing is fragile across versions. |
| Schema validation of the on-disk file | Manual `typeof` field checks | `zod` (already a dep) | STACK.md mandate; one source of truth for the format-version contract (D-10). |
| Parallel write coordination | Lockfile / mutex over a shared file | Per-worker `parallelIndex`-named shards | Playwright guarantees `parallelIndex` uniqueness among live workers — coordination is free. |
| Cross-process worker->main data | Custom IPC | `parallelIndex`-named shard files on disk (the merge reads them) | Custom worker->main IPC is unavailable in Playwright (microsoft/playwright#31559); disk shards are the sanctioned channel for bulk data, mirroring the existing `testInfo.attach` reporter pattern. |

**Key insight:** Every "complete run" / "parallel safety" primitive this phase needs is already exposed by the Playwright Reporter + WorkerInfo APIs. The work is wiring + a pure merge function, not new infrastructure.

## Runtime State Inventory

This is a refactor/persistence phase (it changes the identity key and adds on-disk state), so the inventory applies.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | No persisted store exists yet — Phase 1/2 store is an in-memory `Map` per worker (`src/store/store.ts`), discarded at process exit. There is NO existing `baseline.json` to migrate. | None — greenfield on-disk format; first complete run captures it. Add `.selfmend/shards/` (and any temp) to `.gitignore`; commit `baseline.json`. |
| Live service config | None — no external service holds selfmend state. | None — verified by repo scan (no DB, no daemon). |
| OS-registered state | None — no scheduled tasks / services. | None. |
| Secrets/env vars | A new opt-in env var may be introduced for the prune gate (e.g. `SELFMEND_PRUNE`) — see Open Q1. No secret involved. | Document the env var if adopted; no key management. |
| Build artifacts | `dist/` is built output; the store-format change is source-only. `package.json` store-format = public contract (D-10) -> a format change is at least a minor semver bump. | Rebuild `dist/` after the change; record the format version in CHANGELOG / Changesets at publish (Phase 4). |

**The canonical question — after every file is updated, what runtime systems still hold the old string/state?** Answer: NONE persist across runs today (the store is in-memory only). The risk is the *reverse*: the new committed `baseline.json` becomes durable state that future runs read — so the key MUST be cross-run stable (D-04) and the format MUST be versioned (D-10) from the first commit, because there is no migration path for a key scheme that shifts every run (the exact reason the Phase 1 `step` counter is being replaced).

## Common Pitfalls

### Pitfall 1: `fs.rename` over an existing file fails on Windows (EPERM/EBUSY)
**What goes wrong:** The teardown rename of `baseline.json.tmp` -> `baseline.json` throws `EPERM`/`EBUSY` when Windows Defender, the Search indexer, or another process holds a transient lock on the target.
**Why it happens:** Windows does not allow renaming over an open/locked file; POSIX does. `fs.rename`'s documented overwrite behaviour silently differs on Windows.
**How to avoid:** Retry-with-backoff loop around `fs.rename` (Pattern 3), 10 attempts with linear backoff; or use `write-file-atomic` which bundles this retry. Keep temp file on the same volume to avoid `EXDEV`.
**Warning signs:** Intermittent CI failures on Windows runners only; "EPERM: operation not permitted, rename".
[CITED: github.com/nodejs/node/issues/29481, github.com/npm/write-file-atomic/issues/227]

### Pitfall 2: Pruning on an incomplete run wipes valid baselines (D-09)
**What goes wrong:** A developer runs `npx playwright test tests/login.spec.ts` (one file) or `--grep @smoke`; the merge prunes every key not seen, deleting baselines for every test that did not run, then commits the gutted file.
**Why it happens:** Naive "prune everything not seen this run" without a completeness gate.
**How to avoid:** Prune ONLY when `config.grep` is match-all AND `config.grepInvert === null` AND `config.shard === null` AND `result.status === 'passed'`. Single-file runs and `--last-failed`/`--only-changed` reduce the planned suite without a `FullConfig` flag — gate those too (Open Q1).
**Warning signs:** `baseline.json` diff deletes many entries after a local partial run.

### Pitfall 3: Cross-run identity drift (the reason `step` is replaced)
**What goes wrong:** Using the Phase 1 run-order `step` index in a persisted key means adding/removing any earlier locator shifts every subsequent key, orphaning all later baselines every run -> perpetual recapture, never a stable committed file (diff churn forever).
**Why it happens:** Run-order counters are position-in-run, not identity.
**How to avoid:** Occurrence key (D-04): count occurrences PER `(testFile, titlePath, selectorString)`, not per-run-position. Inserting an unrelated locator elsewhere does not shift a selector's own occurrence count.
**Warning signs:** `baseline.json` churns on every run even with an unchanged UI (also PITFALLS Pitfall 2 territory).

### Pitfall 4: Occurrence count diverges between capture and heal
**What goes wrong:** The occurrence index computed at heal time differs from capture time, so the heal looks up the wrong (or no) baseline.
**Why it happens:** The counter is seeded from something non-deterministic (e.g. only incremented on successful resolution, so a heal-time miss never increments) or from chained-locator re-wraps counting differently.
**How to avoid:** Increment the occurrence counter at `wrapLocator` creation time (when the factory is called), NOT at resolution/action time — creation order is identical on green and broken runs (D-05). The counter must be per-test (reset each test, like the current `createStepCounter`) and keyed by the content identity, not by whether the element resolved.
**Warning signs:** Heal works on first run, fails to find a baseline after a selector breaks; occurrence index off-by-one between runs.

### Pitfall 5: Shard format-version mismatch crashes the merge
**What goes wrong:** A stale shard from an older plugin version (or a hand-edited `baseline.json`) has a different schema; the merge `JSON.parse` succeeds but field access throws, crashing the run at teardown.
**How to avoid:** zod-validate both shards and `baseline.json` on read against the versioned schema (D-10). On version mismatch or validation failure: log a warning and IGNORE that file (treat as empty / recapture) — never crash a user's test run.
**Warning signs:** Teardown throws on a repo with a baseline written by a different selfmend version.

## Code Examples

### Occurrence-key derivation (replaces `nextStep`)
```typescript
// In the worker fixture: one counter map per test (reset per test like createStepCounter).
export function createOccurrenceCounter(): (contentKey: string) => number {
  const counts = new Map<string, number>();
  return (contentKey) => {
    const n = counts.get(contentKey) ?? 0;
    counts.set(contentKey, n + 1);
    return n;                              // 0-based Nth occurrence
  };
}

// store.identify (D-04): content identity -> stable cross-run key.
identify(selector: string, testFile: string, testTitle: string, occurrence: number): string {
  // testTitle = testInfo.titlePath.join(' > ')  (file-rooted, stable) [VERIFIED]
  return `${testFile} ${testTitle} ${selector} ${occurrence}`;
}

// In wrapLocator: compute occurrence BEFORE deriving the key.
const contentKey = `${ctx.testFile} ${ctx.testTitle} ${selector}`;
const occurrence = ctx.nextOccurrence(contentKey);
const key = ctx.store.identify(selector, ctx.testFile, ctx.testTitle, occurrence);
```

### Deterministic serializer (D-03)
```typescript
// PURE — no fs. Stable key order + stable field order so re-runs produce no diff churn.
export function serialize(store: BaselineFile): string {
  const entries = Object.fromEntries(
    Object.entries(store.entries).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  // Within each fingerprint, sort attrs keys too.
  const stable = mapValues(entries, (fp) => ({ ...fp, attrs: sortKeys(fp.attrs) }));
  return JSON.stringify({ version: STORE_FORMAT_VERSION, entries: stable }, sortReplacer, 2) + '\n';
}
```

### Versioned baseline schema (D-10), zod
```typescript
export const STORE_FORMAT_VERSION = 1;
const fingerprintSchema = z.object({
  tag: z.string(), role: z.string(), text: z.string(), testId: z.string(),
  attrs: z.record(z.string(), z.string()),
  ordinal: z.number(), parentTag: z.string(), neighbourSignature: z.string(),
});
export const baselineFileSchema = z.object({
  version: z.literal(STORE_FORMAT_VERSION),       // mismatch -> ignore-and-recapture
  entries: z.record(z.string(), fingerprintSchema),
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| In-memory `Map` per worker, lost at exit | Committed `baseline.json` + per-worker shards merged at teardown | This phase | Fingerprints survive runs; CI heals on first run. |
| Run-order `step` key | Occurrence-based `testFile+title+selector+occurrence` key | This phase (D-04) | Cross-run-stable identity; no diff churn. |
| Single-file write from workers (the naive trap) | Lock-free `parallelIndex` shards + single-threaded merge | This phase (D-11) | No corruption under parallel workers (CAP-03). |
| `globalTeardown` for lifecycle (ARCHITECTURE.md draft) | Reporter `onEnd` for merge+prune | This phase (refines D-11) | Reporter has `FullResult` + planned `Suite`; globalTeardown does not. |

**Deprecated/outdated:**
- The ARCHITECTURE.md draft sketch of `globalSetup`/`globalTeardown` "store lifecycle" predates the D-09 completeness requirement; the merge moves to the Reporter. `globalSetup` is unnecessary because each worker loads the baseline lazily at worker-fixture start (read-only).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `--last-failed` / `--only-changed` are not surfaced as `FullConfig` fields in 1.60 and only manifest as a reduced planned `Suite`. | Pitfall 2, Open Q1 | If a flag IS exposed, the completeness check can be tighter; if not handled, a `--last-failed` run could wrongly prune. Mitigation: conservative opt-in prune gate (Open Q1) makes this safe regardless. |
| A2 | A "complete run" is adequately defined by `grep` match-all + null `grepInvert` + null `shard` + `passed` status. | Pattern 1 | A run could still be partial via mechanisms not covered (e.g. `testIgnore`, project filter `--project`). Mitigation: prune is opt-in and refresh-only is always safe; under-pruning only grows the file slowly. |
| A3 | `FullConfig.grep` default is a match-all `RegExp` (`/.*/`) detectable by stringifying. | Pattern 1 | If the default is `[]` or differs, the match-all detection helper must handle both. Verify empirically against 1.60 at plan time (cheap: log `config.grep` in onBegin). |
| A4 | Hand-rolled temp+rename+retry is sufficient on the user's Windows machine without `write-file-atomic`. | Pattern 3 | If AV locks are aggressive, retries may still exhaust. Mitigation: documented `write-file-atomic` fallback. |

## Open Questions (RESOLVED)

All three are resolved for planning and implemented by the Phase 3 plans:
- **Q1 RESOLVED:** destructive prune is gated behind opt-in `SELFMEND_PRUNE` plus the complete-run check (match-all grep, null grepInvert, null shard, status passed); refresh-on-pass always runs. Implemented in 03-03 Task 2.
- **Q2 RESOLVED:** plain JSON per shard (transient, deleted after merge). Implemented in 03-01/03-02.
- **Q3 RESOLVED:** shard payload = `{ version, captures: Record<key, Fingerprint>, seen: key[] }`. Implemented in 03-01 shard schema.

1. **How to detect `--last-failed` / `--only-changed` (and single-file runs) for the prune gate.**
   - What we know: `FullConfig` exposes `grep`, `grepInvert`, `shard` as concrete fields [VERIFIED]. `onBegin`'s `Suite.allTests()` gives the post-filter planned set. There is NO `FullConfig.lastFailed` / `onlyChanged` field in 1.60's type defs.
   - What's unclear: whether a `--last-failed` or single-file run can be reliably distinguished from a complete run using only public API.
   - Recommendation: Make prune CONSERVATIVE — require ALL of (match-all grep, null grepInvert, null shard, `result.status==='passed'`) AND gate the destructive prune behind an explicit opt-in (e.g. `SELFMEND_PRUNE=1`, default OFF). Refresh-on-pass (D-08, non-destructive) always runs; prune (destructive) is opt-in until completeness detection is proven. This satisfies D-09's safety intent (never wrongly delete) while keeping the file from growing unbounded for users who opt in. Confirm with the user at discuss/plan time.

2. **Shard format: JSON vs JSONL.** A single JSON object per shard is simplest and the shards are transient (deleted after merge), so diff-friendliness does not matter for shards. JSONL only helps if a worker must append incrementally without rewriting; with in-memory accumulation + one flush at teardown, plain JSON is sufficient. Recommendation: JSON per shard. Revisit only if a worker crash mid-run must preserve partial captures (then append-only JSONL).

3. **Where `seenKeys` for prune comes from.** Each shard should carry both captured fingerprints AND the set of keys *seen* (created/resolved) this run, so prune can distinguish "not captured but executed" from "not executed". Recommendation: shard payload = `{ version, captures: Record<key, Fingerprint>, seen: key[] }`.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | All fs work | ✓ | 24.12.0 (>=22 required) | — |
| `@playwright/test` | Reporter/WorkerInfo APIs | ✓ | 1.60.0 | — |
| `zod` | Schema validation | ✓ | ^4 (dep) | — |
| `vitest` | Pure-unit tests of merge/serialize/key | ✓ | ^4 (devDep) | — |
| Chromium (PW) | Integration tests (real parallel run) | ✓ (installed) | bundled w/ 1.60 | — |
| `write-file-atomic` | Atomic-write fallback only | ✗ (not installed) | 8.0.0 on npm | Hand-rolled temp+rename+retry (recommended primary) |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** `write-file-atomic` (fallback: hand-rolled atomic write, which is the recommended primary anyway).

## Validation Architecture

`workflow.nyquist_validation` is not set to false in `.planning/config.json` (no config.json present; treat as enabled).

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest `^4` (pure logic) + `@playwright/test` 1.60 runner (integration) |
| Config file | `vitest.config.ts`; `playwright.config.ts` |
| Quick run command | `pnpm test` (`vitest run src`) |
| Full suite command | `pnpm test && pnpm test:e2e` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CAP-02 | Round-trip: write store, reload from disk, fingerprints survive | unit (temp dir) | `vitest run src/store/persistence.test.ts` | ❌ Wave 0 |
| CAP-02 | Deterministic serialize: same store -> byte-identical output (no diff churn) | unit | `vitest run src/store/serialize.test.ts` | ❌ Wave 0 |
| CAP-02 | Format-version mismatch -> ignore-and-recapture, no crash | unit | `vitest run src/store/schema.test.ts` | ❌ Wave 0 |
| CAP-02 | Occurrence key identical at capture vs heal (element absent) | unit | `vitest run src/integration/occurrence.test.ts` | ❌ Wave 0 |
| CAP-03 | Merge N shards deterministically (same result regardless of order) | unit | `vitest run src/store/merge.test.ts` | ❌ Wave 0 |
| CAP-03 | Concurrent shard writes + merge produce valid, complete baseline | integration | `playwright test tests/parallel-store.spec.ts` (workers>1) | ❌ Wave 0 |
| CAP-03 | Atomic write survives interrupted/locked target (retry path) | unit | `vitest run src/store/persistence.test.ts` | ❌ Wave 0 |
| D-09 | Filtered run (`--grep`) does NOT prune | integration | `playwright test --grep @one tests/prune.spec.ts` then assert baseline intact | ❌ Wave 0 |
| regression | Existing heal / no-false-green / ambiguous tests pass after key swap | integration | `pnpm test:e2e` (heal.spec, no-premature-heal, ambiguous-no-heal) | ✅ exist |

### Sampling Rate
- **Per task commit:** `pnpm test` (Vitest pure units, <5s).
- **Per wave merge:** `pnpm test && pnpm test:e2e`.
- **Phase gate:** Full suite green (incl. the parallel-store integration spec at `workers>1`) before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `src/store/serialize.test.ts` — deterministic output (CAP-02, D-03)
- [ ] `src/store/merge.test.ts` — deterministic merge + refresh + prune (CAP-03, D-08/09/13)
- [ ] `src/store/schema.test.ts` — version mismatch ignore-and-recapture (D-10)
- [ ] `src/store/persistence.test.ts` — round-trip + atomic-write retry, temp-dir based (CAP-02, CAP-03)
- [ ] `src/integration/occurrence.test.ts` — occurrence key stable capture-vs-heal (D-04/05)
- [ ] `tests/parallel-store.spec.ts` — real PW run at `workers>1`, assert no corruption (CAP-03)
- [ ] `tests/prune.spec.ts` — filtered run must not prune (D-09)
- [ ] A temp-config or per-test `outputDir` so integration tests do not write the repo's real `.selfmend/baseline.json`.

## Project Constraints (from CLAUDE.md / MEMORY)
- **No em dashes** in any prose/output (user preference — applies to generated reports, console output, docs).
- **TDD by default:** write the failing test first, confirm red, implement to green, refactor. The pure `serialize`/`merge`/occurrence-key units are prime RED-first targets.
- **Worktrees off; sequential execution on Windows** (per project memory) — but the SHIPPED plugin must still be parallel-safe; test CAP-03 with an explicit `workers>1` integration spec even though the repo's own e2e default is `workers:1`.
- **GSD workflow:** edits go through a GSD command; this is research output only.
- **Pure matching core stays Playwright/fs-free** (established invariant) — persistence lives in `src/store/` + integration; `serialize.ts`/`merge.ts` import neither Playwright nor fs.

## Security Domain

`security_enforcement` not explicitly false (no config.json) -> included.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | yes | zod-validate every on-disk file (shards + baseline) before use (D-10); malformed -> ignore, never crash. |
| V6 Cryptography | no | No secrets; no signing needed for a local committed file. |
| V8 Data Protection | yes | Derived-signals-only invariant (D-02): the committed file must never contain raw innerText/full DOM (PII). Enforce at capture (already) AND assert in the serializer/schema test that no raw-text field is persisted. |

### Known Threat Patterns for {Node fs + committed file}
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Corrupt/half-written `baseline.json` from an interrupted write | Tampering (integrity) | Atomic temp+rename so readers never see a partial file (Pattern 3). |
| Malicious/stale on-disk file crashing the run | Denial of Service | zod-validate + ignore-on-failure (Pitfall 5). |
| PII leak via committed fingerprints | Information Disclosure | D-02 derived-signals-only; schema has no raw-DOM field; test asserts it. |
| Path traversal via configured store path | Tampering | Resolve store path under `config.rootDir` with `path.resolve`; do not accept absolute user paths without normalization. |

## Sources

### Primary (HIGH confidence)
- `@playwright/test@1.60.0` installed type defs — `playwright/types/testReporter.d.ts`: `Reporter.onBegin(config: FullConfig, suite: Suite)`, `onEnd(result: FullResult)`, `FullResult.status: 'passed'|'failed'|'timedout'|'interrupted'`, `TestResult.parallelIndex/workerIndex/shardIndex`. [VERIFIED]
- `playwright/types/test.d.ts`: `FullConfig` fields `grep`, `grepInvert: null|...`, `shard: null|{total,current}`, `rootDir`, `globalTeardown: null|string`; `TestInfo.titlePath: Array<string>`, `TestInfo.parallelIndex`, `WorkerInfo.parallelIndex` ("guaranteed different parallelIndex among workers running at the same time; a restarted worker has the same parallelIndex"). [VERIFIED]
- Project research `.planning/research/ARCHITECTURE.md` — per-worker shards merged at teardown, the worker/main split, `testInfo.attach` as the only sanctioned channel. [HIGH]
- Project research `.planning/research/PITFALLS.md` — Pitfall 4 (parallel baseline corruption), Pitfall 2 (unstable signals). [HIGH]
- `.planning/research/STACK.md` — JSON file + atomic write recommendation; zod for store validation; `node:sqlite` deferred. [HIGH]

### Secondary (MEDIUM confidence)
- nodejs/node#29481, npm/write-file-atomic#227, nodejs/node#21957 — Windows `fs.rename` EPERM/EBUSY over existing/locked target; documented overwrite behaviour differs from POSIX. [CITED]
- npm `write-file-atomic@8.0.0` (modified 2026-05-08), repo github.com/npm/write-file-atomic, slopcheck [OK]. [VERIFIED: npm registry]

### Tertiary (LOW confidence)
- microsoft/playwright#31559 — custom worker->main IPC unavailable (from project research; confirms shard-file channel choice). [MEDIUM, from prior research]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dep on the recommended path; all built-ins + existing zod.
- Architecture (where merge runs / completeness signal): HIGH — verified against installed 1.60 type defs; the one residual is `--last-failed` detection (A1/Open Q1), mitigated by an opt-in prune gate.
- Windows atomic write: HIGH on the pitfall (multiple Node issues); MEDIUM on whether hand-rolled retry suffices without the dep (A4).
- Occurrence key: HIGH — `titlePath` verified; the capture-vs-heal-stability argument is a determinism property provable by unit test.
- Pitfalls: HIGH — sourced from project PITFALLS.md + Node issues.

**Research date:** 2026-05-31
**Valid until:** 2026-06-30 (Playwright 1.61 alpha in flight; re-verify `FullConfig`/Reporter signatures if bumping the peer floor).
