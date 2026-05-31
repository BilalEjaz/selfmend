---
phase: 03-persistence-parallel-worker-safety
plan: 01
subsystem: testing
tags: [zod, serialization, parallel-workers, baseline-store, tdd]

# Dependency graph
requires:
  - phase: 01-thinnest-real-heal
    provides: Fingerprint contract (src/matching/types.ts) + in-memory BaselineStore
  - phase: 02-trust-hardening
    provides: pure-core invariant + zod config-schema precedent (safeParse-driven loader)
provides:
  - "STORE_FORMAT_VERSION + versioned zod baselineFileSchema/shardFileSchema (D-10)"
  - "parseBaseline/parseShard: safe-parse-or-ignore loaders (never throw, ignore-and-recapture)"
  - "Pure deterministic serializer with byte-stable key + field order (D-03)"
  - "Pure mergeShards/refresh/prune (D-08, D-09, D-13) ready for the fs adapter + reporter"
affects: [03-02 persistence fs adapter, 03-03 reporter merge+prune gate, 04 offline-publish]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Versioned on-disk schema with z.literal version gate -> mismatch decodes to canonical EMPTY (ignore-and-recapture)"
    - "Strict (z.strictObject) fingerprint schema rejects raw-DOM keys so PII can never enter the committed file"
    - "Canonical serialization: rebuild every object in fixed field order + sorted keys (not insertion-order JSON.stringify)"
    - "Order-independent shard merge via a value-derived compare key, never array position"

key-files:
  created:
    - src/store/schema.ts
    - src/store/schema.test.ts
    - src/store/serialize.ts
    - src/store/serialize.test.ts
    - src/store/merge.ts
    - src/store/merge.test.ts
  modified: []

key-decisions:
  - "[03-01] Store-format version is a numeric literal gated by z.literal; any other version safeParses to the canonical EMPTY store, so a future/older or hand-edited file is ignored-and-recaptured, never half-read or crashed on (D-10)"
  - "[03-01] fingerprintSchema is STRICT (z.strictObject) and limited to the eight derived signals; an object carrying innerHTML/outerHTML/html/innerText is REJECTED to EMPTY, so no raw DOM can ever persist into the committed file (D-02)"
  - "[03-01] Serializer rebuilds entries in stable code-point key order with a FIXED fingerprint field order and sorted attrs keys, so logically-equal stores are byte-identical and an unchanged run yields zero diff churn (D-03)"
  - "[03-01] mergeShards same-key conflict precedence is the larger value-derived compare key (content of the fingerprint, sorted attrs), so the merge is identical regardless of shard array order/worker timing (D-13)"
  - "[03-01] prune is a two-arg pure (store, seenKeys) function with NO completeness flag; the COMPLETE-RUN gate + SELFMEND_PRUNE opt-in live in the reporter (Plan 03-03), keeping the destructive decision at the call site (D-09)"

patterns-established:
  - "Pure store layer (schema/serialize/merge) imports nothing from Playwright or node:fs; fs lives only in persistence.ts (Plan 03-02)"
  - "RED -> GREEN per task: failing spec committed as test(03-01), implementation as feat(03-01)"

requirements-completed: [CAP-02, CAP-03]

# Metrics
duration: 9min
completed: 2026-05-31
---

# Phase 3 Plan 01: Pure Store Layer Summary

**Versioned zod baseline/shard schema with safe-parse-or-ignore loaders, a byte-deterministic serializer, and order-independent mergeShards/refresh/prune — all Playwright/fs-free and built test-first.**

## Performance

- **Duration:** ~9 min
- **Started:** 2026-05-31T15:34Z
- **Completed:** 2026-05-31T15:39Z
- **Tasks:** 3 (each RED then GREEN)
- **Files modified:** 6 created

## Accomplishments
- Versioned on-disk format (`STORE_FORMAT_VERSION = 1`) with `baselineFileSchema` + `shardFileSchema`; a version mismatch or any malformed input decodes to the canonical EMPTY store and never throws (D-10), proven by 15 schema tests.
- Strict fingerprint schema enforces derived-signals-only (D-02): a raw-DOM leak (`innerHTML`/`outerHTML`/`html`/`innerText`) is rejected, so PII can never enter the committed file.
- Deterministic serializer (D-03): two stores built in different key-insertion orders serialize byte-identically; output round-trips through `parseBaseline`, carries the version, and ends in a trailing newline.
- Pure `mergeShards`/`refresh`/`prune` (D-08/D-09/D-13): order-independent merge with a documented value-derived same-key precedence, overwrite-on-recapture refresh, and a two-arg prune whose completeness gating is deferred to the reporter.

## Task Commits

Each task was committed atomically (TDD RED then GREEN):

1. **Task 1: Versioned zod schema + safe loader** - `933c8ab` (test) -> `113e7f2` (feat)
2. **Task 2: Deterministic serializer** - `aad8f4e` (test) -> `03fd65b` (feat)
3. **Task 3: Pure merge + refresh + prune** - `8f09720` (test) -> `22eee25` (feat)

_TDD gate compliance: every task has a preceding `test(03-01)` commit (RED) then a `feat(03-01)` commit (GREEN). No refactor commits were needed._

## Files Created/Modified
- `src/store/schema.ts` - STORE_FORMAT_VERSION, strict fingerprintSchema, baselineFileSchema, shardFileSchema, parseBaseline/parseShard safe loaders
- `src/store/schema.test.ts` - 15 tests: version-mismatch/malformed -> EMPTY no-throw; raw-DOM rejection; shard shape
- `src/store/serialize.ts` - pure deterministic serializer (sorted keys, fixed field order, sorted attrs, trailing newline)
- `src/store/serialize.test.ts` - 7 tests: byte-identical under reordering; round-trip; no raw-DOM leak
- `src/store/merge.ts` - pure mergeShards/refresh/prune with documented D-13 precedence
- `src/store/merge.test.ts` - 10 tests: order-independence incl. conflict; refresh overwrite/preserve; prune remove-unseen

## Decisions Made
None beyond the locked decisions. The plan was followed as written; all five key-decisions above are direct realizations of D-02/D-03/D-08/D-09/D-10/D-13.

One implementation choice within Claude's discretion: the D-13 same-key conflict precedence is "keep the larger value-derived compare key" (a deterministic function of fingerprint content, sorted attrs) rather than "last shard by array position", because array position is exactly the non-determinism D-13 forbids. This makes `mergeShards([A,B])` provably deep-equal `mergeShards([B,A])`.

## Deviations from Plan
None - plan executed exactly as written.

## Issues Encountered
- `grep -c` returns exit 1 when it finds 0 matches, which broke a chained `&&` purity-check command. Re-ran the purity grep and `tsc` as separate statements; result is unchanged (0 forbidden imports in all three modules, tsc exit 0). Not a code issue.

## Verification Evidence
- `npx vitest run src/store` — 3 files, 32 tests passed.
- `npx vitest run` (full suite) — 9 files, 88 tests passed (no regressions in Phase 1/2 specs).
- `npx tsc --noEmit` — exit 0.
- Purity gate: `grep -v '^[[:space:]]*[/*]' src/store/{schema,serialize,merge}.ts | grep -c -E "playwright|node:fs"` returns 0 for each — none import Playwright or node:fs.
- D-10 proven: version-mismatch + malformed inputs each decode to the empty store with no throw.
- D-02 proven: strict schema rejects innerHTML/outerHTML/html/innerText; serialized text contains none of them.
- D-03 proven: byte-identical serialization under entry-key and attrs-key reordering.
- D-13 proven: order-independent merge including the same-key conflict case.

## Known Stubs
None. All three modules are complete, pure, and fully exercised. The fs adapter (persistence.ts, Plan 03-02) and the reporter merge+prune gate (Plan 03-03) are intentionally out of scope for this plan and will consume these pure functions.

## Next Phase Readiness
- Pure contract is locked and green: Plan 03-02 (`persistence.ts` fs adapter) can call `parseBaseline`/`parseShard` on read and `serialize` on write; Plan 03-03 (reporter) can call `mergeShards`/`refresh`/`prune`.
- prune deliberately carries no completeness gate — Plan 03-03 must implement the COMPLETE-RUN check (match-all grep, null grepInvert, null shard, status passed) plus the `SELFMEND_PRUNE` opt-in before calling it (D-09, research Open Q1).
- No blockers.

## Self-Check: PASSED

All 6 created files exist on disk; all 6 task commits (3 RED + 3 GREEN) present in git history.

---
*Phase: 03-persistence-parallel-worker-safety*
*Completed: 2026-05-31*
