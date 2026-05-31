# Phase 3: Persistence & Parallel-Worker Safety - Discussion Log

> **Audit trail only.** Decisions are captured in CONTEXT.md; this log preserves the alternatives considered.

**Date:** 2026-05-31
**Phase:** 3-Persistence & Parallel-Worker Safety
**Areas discussed:** Committed vs local baseline, Cross-run identity key, Refresh & staleness lifecycle, Parallel write strategy

---

## Committed vs local baseline

| Option | Description | Selected |
|--------|-------------|----------|
| Committed | checked into repo; team+CI share; heals reviewable in PR; first-run CI heals | ✓ |
| Local-only (gitignored) | node_modules/.cache; no repo noise; CI starts empty | |
| Default local, opt-in commit | gitignored default, documented opt-in | |

**User's choice:** Committed.
**Notes:** Derived-signals-only (no PII, hard constraint since committed), deterministic/sorted serialization to avoid diff churn, human-readable JSON.

---

## Cross-run identity key

| Option | Description | Selected |
|--------|-------------|----------|
| test-title + selector + occurrence | stable across runs unless test renamed / selector uses reordered | ✓ |
| test-file + selector only | most edit-stable but collides (CR-01/LO-02 class) | |
| Opt-in explicit heal id | precise but friction, easy to forget | |

**User's choice:** test-title + selector + occurrence-index.
**Notes:** Replaces the fragile run-order step counter. Occurrence computable from execution order even when element missing. Missing baseline -> no heal (fail-safe, never-false-green).

---

## Refresh & staleness lifecycle

| Option | Description | Selected |
|--------|-------------|----------|
| Refresh on pass + prune unseen | overwrite on green resolve; prune entries not seen in a full run | ✓ |
| Write-once, manual prune | record only when missing; goes stale | |
| Refresh on pass, never auto-prune | always overwrite, unbounded growth | |

**User's choice:** Refresh on pass + prune unseen.
**Notes:** CRITICAL caveat — prune ONLY after a complete run; partial/filtered/failed runs refresh-only, never prune (else delete baselines for tests that did not run). Needs a 'complete run' signal. Store format versioned (semver, public contract) with graceful migrate/ignore-old.

---

## Parallel write strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Per-worker shards merged at teardown | lock-free shards; globalTeardown merges+prunes+deletes | ✓ |
| Single file + lock | one file + lockfile; contention + Windows locking risk | |
| node:sqlite (WAL) | robust concurrency but binary, not diffable | |

**User's choice:** Per-worker shards merged at globalTeardown.
**Notes:** Shards transient (ignored path, gitignored, deleted after merge); only merged baseline.json committed. Deterministic merge on same-key conflict.

---

## Claude's Discretion

- Exact paths/schema/version field, atomic-write mechanism, source of the 'complete run' signal, shard format (JSON vs JSONL), globalTeardown-vs-reporter split. Keep the pure matching core untouched.

## Deferred Ideas

- Offline proof + npm publish (Phase 4).
- Committed original-to-healed selector store, JSON/HTML reports (v2).
- node:sqlite (only if contention appears at scale).
- Per-test override / explicit heal id.
