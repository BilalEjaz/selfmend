# Phase 3: Persistence & Parallel-Worker Safety - Context

**Gathered:** 2026-05-31
**Status:** Ready for planning

<domain>
## Phase Boundary

Graduate the baseline store from a single-worker in-memory `Map` (Phase 1 `src/store/store.ts`) to a durable, concurrency-safe on-disk store: fingerprints survive across runs (CAP-02) and stay corruption-free when Playwright shards tests across parallel workers (CAP-03). No new healing behaviour, same fingerprints, now persistent and parallel-safe.

In scope: CAP-02 (persist across runs), CAP-03 (parallel-worker-safe, no corruption/races). Plus the cross-run identity-key redesign that persistence forces (the current run-order `step` counter is not stable across runs), and the refresh/prune lifecycle and store-format versioning that a committed file requires.

Not in scope (later phase): network-blocked offline proof and npm publish (Phase 4); a committed original-to-healed selector store (V2-06) and JSON/HTML report files (V2-05) remain out of scope.

Builds on / changes: `src/store/store.ts` (becomes file-backed), `src/integration/locator-proxy.ts` and `src/integration/fixture.ts` (identity-key computation + worker shard wiring), `playwright.config.ts` (globalTeardown for merge/prune).
</domain>

<decisions>
## Implementation Decisions

### Git posture (CAP-02)
- **D-01:** The merged baseline is COMMITTED to the repo (a single human-readable JSON file, e.g. `.selfmend/baseline.json`). Rationale: the team shares fingerprints, CI can heal on its first run, and heals/baseline changes are reviewable in PR diffs — matching the product's "visible audit trail" value.
- **D-02:** The committed file stores DERIVED signals only (text, role, test-id, attributes, neighbour, DOM position) — never raw innerText / full DOM (PII), preserving the Phase 1 capture invariant. This is a hard constraint because the file is committed.
- **D-03:** Serialization is DETERMINISTIC (stable/sorted key order, stable field order) so re-running without real change produces no diff churn. The file must be diff-friendly.

### Cross-run identity key
- **D-04:** A fingerprint's identity is `testFile + test title + selector string + occurrence-index` (the Nth creation of that selector within that test). This REPLACES the Phase 1 run-order `step` counter (which shifts whenever any earlier test/step changes and so cannot survive across runs).
- **D-05:** The occurrence-index is computed from deterministic execution order within the test and is therefore computable at heal time even though the broken locator does not resolve (it depends on how many times that selector was created before this one, not on the element existing).
- **D-06:** Stability/sensitivity tradeoff is accepted: renaming a test or reordering that selector's uses orphans those baselines, which are simply recaptured on the next passing run. This is preferable to the `testFile + selector`-only key, which collides when one selector targets different elements in the same file (the CR-01/LO-02 bug class).
- **D-07:** Fail-safe on ambiguity/miss: if the computed key has no stored baseline, NO heal happens (re-throw, test fails normally). Never guess across keys. Consistent with never-false-green.

### Refresh & staleness lifecycle
- **D-08:** Refresh-on-pass: when a locator resolves on a green run, overwrite its stored fingerprint so the baseline tracks current reality and drift shrinks over time.
- **D-09:** Prune-unseen, but ONLY after a COMPLETE run. Entries not seen during a full successful run may be pruned so the committed file does not grow forever. A partial/filtered run (`--grep`, `--shard`, a single-file run, a failed run) must REFRESH-ONLY and never prune — otherwise it would delete baselines for tests that simply did not execute. Pruning requires a reliable "this was a complete run" signal (research/planning to source it from the Playwright reporter/run metadata).
- **D-10:** The store-format is part of the public semver contract. The file carries a format version; an unrecognized/older format is handled gracefully (migrate or ignore-and-recapture, never crash a user's test run).

### Parallel write strategy (CAP-03)
- **D-11:** Per-worker shards merged at teardown: each Playwright worker writes its own shard file (lock-free, no cross-worker contention); a `globalTeardown` merges all shards into the single committed baseline, applies refresh+prune, then deletes the shards. Matches the project research; avoids lockfile contention and the Windows file-locking pitfalls of a single-file+lock approach, and keeps the committed artifact a diffable JSON (rejecting node:sqlite's binary file for the committed case).
- **D-12:** Shard/temp files are TRANSIENT: written under an ignored path (e.g. `.selfmend/shards/` or a temp dir), gitignored, and removed after a successful merge. Only the merged `baseline.json` is committed.
- **D-13:** Merge conflict within a run: when two workers captured the same key, the merge is deterministic (e.g. last-writer or a defined precedence) so the merged output is stable regardless of worker timing.

### Claude's Discretion
- Exact file paths/names, the precise JSON schema + version field, the atomic-write mechanism (temp-file + rename), how the "complete run" signal is obtained from Playwright, the shard file format (JSON vs JSONL), and the globalTeardown vs reporter split for the merge are left to research and planning. Keep the pure matching core untouched; the store and integration layers carry these changes.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project-level
- `.planning/PROJECT.md` : offline + never-false-green + committed-audit-trail constraints.
- `.planning/REQUIREMENTS.md` : Phase 3 owns CAP-02, CAP-03.
- `.planning/ROADMAP.md` : Phase 3 goal + success criteria.

### Phase 1/2 code this phase changes (read before changing)
- `src/store/store.ts` : current in-process Map + `identify(selector, testFile, step)`. Becomes file-backed; `identify` changes to the occurrence-based key (D-04).
- `src/integration/locator-proxy.ts` : computes the store key (currently via `nextStep()` + `describeArgs`, incl. the Phase 2 LO-02 fix). The occurrence-index keying lives/ripples here.
- `src/integration/fixture.ts` : owns the per-test step counter and page fixture; worker-shard lifecycle wiring attaches around here.
- `playwright.config.ts` : add `globalTeardown` for shard merge + prune.
- `src/matching/types.ts` : `Fingerprint` shape that gets serialized (keep pure).
- `.planning/phases/01-thinnest-real-heal/01-04-SUMMARY.md` : how capture/store/proxy were wired in Phase 1.

### Research
- `.planning/research/ARCHITECTURE.md` : the read-mostly baseline + per-worker JSONL shards merged in globalTeardown recommendation (the basis for D-11).
- `.planning/research/STACK.md` : JSON-file store with atomic write; `node:sqlite` only if contention appears (we rejected sqlite for the committed/diffable case).
- `.planning/research/PITFALLS.md` : parallel-worker baseline corruption, stale baselines, unstable-signal pitfalls.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `BaselineStore` (store.ts): has/get/set/identify/size API. Phase 3 keeps the read API for the heal path but backs it with a loaded-from-disk map and adds persistence + merge. `identify()` changes from `(selector, testFile, step)` to the occurrence-based key.
- `Fingerprint` type (matching/types.ts): already derived-signals-only; this is what gets serialized. Keep it pure and serialization-friendly.
- The Phase 1 capture path and the Phase 2 `describeArgs`/`nextStep` key derivation in locator-proxy.ts are the integration points the new key plugs into.

### Established Patterns
- Pure matching core (scoring/decision/types) imports nothing from Playwright/fs — Phase 3 must NOT pull file I/O into that layer. Persistence belongs in src/store/ and the integration layer.
- TDD RED -> GREEN -> REFACTOR for logic (store merge/prune, key derivation, format versioning are prime TDD targets — pure-testable with a temp dir / in-memory fs).
- Atomic write (temp + rename) was already called out in research to avoid corruption on interrupted runs.

### Integration Points
- store.ts <-> locator-proxy.ts (key derivation + capture/lookup).
- fixture.ts / playwright.config globalTeardown <-> store.ts (load on start, write shard per worker, merge+prune at teardown).
- The "complete run" signal needs a source (reporter onEnd run metadata vs globalTeardown) — flag for research.

</code_context>

<specifics>
## Specific Ideas

- Single committed `.selfmend/baseline.json`, deterministic/sorted, derived-signals-only, with a format-version field.
- Transient per-worker shards under an ignored path, merged + pruned at globalTeardown, then deleted.
- Identity key: `testFile :: test title :: selector :: occurrenceIndex`.

</specifics>

<deferred>
## Deferred Ideas

- Network-blocked offline proof + npm publish: Phase 4.
- Committed original-to-healed selector store (V2-06) and JSON/HTML report files (V2-05): v2, out of scope.
- node:sqlite store: only revisit if JSON+shards shows real contention at scale (rejected for the committed/diffable case now).
- Per-test override of identity/heal id: not needed (occurrence-based key chosen over opt-in explicit ids).

</deferred>

---

*Phase: 3-Persistence & Parallel-Worker Safety*
*Context gathered: 2026-05-31*
