import { STORE_FORMAT_VERSION } from "./schema.js";
import type { BaselineFile, ShardFile } from "./schema.js";
import type { Fingerprint } from "../matching/types.js";
import { BaselineStore } from "./store.js";

/**
 * PURE merge + refresh + prune for the parallel-worker baseline (D-08/D-09/D-13).
 *
 * Imports ONLY types from `./schema.js` and `../matching/types.js`; NO
 * `node:fs`, NO Playwright. These three functions are what the fs adapter
 * (Plan 02) and the Reporter (Plan 03) call: the Reporter reads the shards off
 * disk, hands the parsed {@link ShardFile}[] here, then writes the serialized
 * result back atomically.
 */

/** The deterministic union of all per-worker shards (D-13). */
export interface MergedShards {
  /** Every captured fingerprint, keyed by locator identity. */
  captures: Record<string, Fingerprint>;
  /** Union of every key seen (created or resolved) across all shards. */
  seen: Set<string>;
}

/**
 * A stable, value-derived comparison key for one fingerprint.
 *
 * Used ONLY as the same-key conflict tie-breaker below. It is a deterministic
 * function of the fingerprint's content (with sorted `attrs`), so two workers
 * that captured the same key produce a comparison that does not depend on which
 * shard arrived first in the array.
 */
function fingerprintCompareKey(fp: Fingerprint): string {
  const sortedAttrs = Object.keys(fp.attrs)
    .sort()
    .map((k) => `${k}=${(fp.attrs as Record<string, string>)[k]}`)
    .join(",");
  return [
    fp.tag,
    fp.role,
    fp.text,
    fp.testId,
    sortedAttrs,
    String(fp.ordinal),
    fp.parentTag,
    fp.neighbourSignature,
  ].join("\u0000");
}

/**
 * Merge N per-worker shards into one deterministic combined result (D-13).
 *
 * CONFLICT PRECEDENCE (the documented D-13 rule): when two shards captured the
 * SAME key with DIFFERENT fingerprints, the winner is the one whose
 * value-derived compare key sorts LAST (max code-point order). This is purely a
 * function of the captured VALUES, never of shard array position or worker
 * timing, so `mergeShards([A, B])` deep-equals `mergeShards([B, A])`. Identical
 * captures for the same key collapse to that one value. `seen` is the set union.
 *
 * @param shards Parsed, already-validated shard files (any order).
 */
export function mergeShards(shards: ShardFile[]): MergedShards {
  const captures: Record<string, Fingerprint> = {};
  const seen = new Set<string>();

  for (const shard of shards) {
    for (const key of shard.seen) {
      seen.add(key);
    }
    for (const [key, incoming] of Object.entries(shard.captures)) {
      const existing = captures[key];
      if (
        existing === undefined ||
        // Deterministic precedence: keep the larger value-derived compare key.
        fingerprintCompareKey(incoming) > fingerprintCompareKey(existing)
      ) {
        captures[key] = incoming;
      }
    }
  }

  return { captures, seen };
}

/**
 * Overwrite-on-recapture (D-08): every key in `merged.captures` replaces (or
 * adds) that key in the baseline; keys present only in the baseline are left
 * untouched. Returns a NEW {@link BaselineFile} carrying STORE_FORMAT_VERSION;
 * the input baseline is not mutated.
 */
export function refresh(
  baseline: BaselineFile,
  merged: MergedShards,
): BaselineFile {
  return {
    version: STORE_FORMAT_VERSION,
    entries: { ...baseline.entries, ...merged.captures },
  };
}

/**
 * Prune-unseen (D-09): return a baseline containing ONLY entries whose key is in
 * `seenKeys`; any key absent from `seenKeys` is dropped. An empty `seenKeys`
 * yields an empty store. Returns a NEW {@link BaselineFile}; the input is not
 * mutated.
 *
 * This is a SEPARATE pure function that looks at NO completeness flag. The
 * destructive decision — only prune on a COMPLETE, passed run, gated behind the
 * `SELFMEND_PRUNE` opt-in — lives at the call site (the Reporter, Plan 03-03),
 * not here. Refresh-only callers simply never call this.
 */
export function prune(store: BaselineFile, seenKeys: Set<string>): BaselineFile {
  const entries: Record<string, Fingerprint> = {};
  for (const [key, fp] of Object.entries(store.entries)) {
    if (seenKeys.has(key)) {
      entries[key] = fp;
    }
  }
  return { version: STORE_FORMAT_VERSION, entries };
}

/**
 * PUBLIC, deterministic N-way merge of per-worker {@link BaselineStore}s
 * (STORE-03). A thin fold over {@link mergeShards}: each input store is shaped
 * into a captures-only shard (`seen: []`, irrelevant to a refresh-only consumer)
 * and merged with the same value-derived conflict rule, so no entry is lost and
 * the result is ORDER-INDEPENDENT (`mergeBaselines(a, b)` deep-equals
 * `mergeBaselines(b, a)`) over both overlapping and disjoint inputs. Identical
 * captures for a key collapse to that one value. Zero arguments yields an EMPTY
 * store; one argument is a passthrough.
 *
 * The deterministic tiebreak is mergeShards' max value-derived compare key, NOT
 * last-write-wins, so the merge never depends on argument position or worker
 * timing.
 */
export function mergeBaselines(...stores: BaselineStore[]): BaselineStore {
  const shards: ShardFile[] = stores.map((store) => ({
    version: STORE_FORMAT_VERSION,
    captures: store.toBaselineFile().entries,
    seen: [],
  }));
  const merged = mergeShards(shards);
  return BaselineStore.fromBaseline({
    version: STORE_FORMAT_VERSION,
    entries: merged.captures,
  });
}
