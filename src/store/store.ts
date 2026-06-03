import type { Fingerprint } from "../matching/types.js";
import type { BaselineFile, ShardFile } from "./schema.js";
import { STORE_FORMAT_VERSION } from "./schema.js";

/**
 * The in-process baseline store: one {@link Fingerprint} per locator identity
 * for a single worker's run, plus the seen-key set this run needs to emit a
 * shard for the teardown merge (CAP-02 / CAP-03).
 *
 * A locator's identity is the cross-run-stable tuple
 * `(testFile, testTitle, selector, occurrence-index)` (D-04): the same selector
 * used in a different test, under a different test title, or at a different
 * occurrence within the test is a DISTINCT baseline, so heals never
 * cross-contaminate. The occurrence index is the Nth CREATION of that selector
 * within that test (computed at wrapLocator creation time, D-05), which is why
 * it survives across runs where the Phase 1 run-order `step` counter could not.
 *
 * The store is still a single-worker in-memory `Map`; the fs adapter
 * (`persistence.ts`) loads a committed baseline into one via
 * {@link BaselineStore.fromBaseline} at worker start and flushes
 * {@link BaselineStore.toShard} to a per-worker shard at teardown. Merge + prune
 * across shards live in the pure `merge.ts` + the reporter (Plan 03-03).
 */
export class BaselineStore {
  /** Backing map keyed by the derived identity string. */
  private readonly fingerprints = new Map<string, Fingerprint>();

  /**
   * Every key this run CREATED or RESOLVED (whether or not a fingerprint was
   * captured for it). The reporter's prune uses the union of all shards' seen
   * sets to distinguish "executed but not captured" from "not executed at all"
   * (D-09), so it never deletes a baseline for a test that simply did not run.
   */
  private readonly seen = new Set<string>();

  /**
   * In-flight fire-and-forget capture promises (CAP-01). The success-path
   * fingerprint capture no longer extends the action's promise (a navigating /
   * detached element must not stall the action), so it runs as a tracked
   * fire-and-forget task. Sites that must observe a captured fingerprint before
   * reading or persisting the store (the heal path, the persist + teardown
   * flush) await {@link BaselineStore.settle} first. The capture itself swallows
   * its own errors, so these promises never reject.
   */
  private readonly pending = new Set<Promise<void>>();

  /**
   * Seed a store from a loaded {@link BaselineFile} (Plan 03-02). The committed
   * file's keys ARE identity keys, so they are inserted verbatim; the loaded
   * baseline is NOT marked seen (seen tracks what THIS run created/resolved, so
   * the reporter's prune can tell "executed but not captured" from "not
   * executed" — D-09). Used by `loadBaseline` at worker start.
   */
  static fromBaseline(file: BaselineFile): BaselineStore {
    const store = new BaselineStore();
    for (const [key, fingerprint] of Object.entries(file.entries)) {
      store.fingerprints.set(key, fingerprint);
    }
    return store;
  }

  /**
   * Build the cross-run-stable identity key for a locator (D-04). The components
   * are joined with single spaces; the occurrence index (a non-negative
   * integer) and the file-rooted test title make the tuple unique per logical
   * locator within a test, identically on a green capture run and a later broken
   * heal run.
   *
   * @param selector The selector string the locator was created from.
   * @param testFile The test file the locator was used in (stable per test).
   * @param testTitle The file-rooted test title (`testInfo.titlePath` joined).
   * @param occurrence The Nth creation of this selector within this test (D-05).
   */
  identify(
    selector: string,
    testFile: string,
    testTitle: string,
    occurrence: number,
  ): string {
    return `${testFile} ${testTitle} ${selector} ${occurrence}`;
  }

  /**
   * Record that this key was created or resolved this run (seen-set, D-09).
   * Called by the proxy at wrapLocator creation time so even a key that never
   * captures a fingerprint (e.g. a broken locator on a failing run) still counts
   * as "executed" and is not pruned.
   */
  markSeen(key: string): void {
    this.seen.add(key);
  }

  /** The keys created/resolved this run (for the shard's `seen` list). */
  seenKeys(): string[] {
    return [...this.seen];
  }

  /** True if a fingerprint is already recorded for this key (dedup guard). */
  has(key: string): boolean {
    return this.fingerprints.has(key);
  }

  /** The fingerprint recorded for this key, or `undefined` if none. */
  get(key: string): Fingerprint | undefined {
    return this.fingerprints.get(key);
  }

  /** Record (or overwrite) the fingerprint for this key. Also marks it seen. */
  set(key: string, fingerprint: Fingerprint): void {
    this.fingerprints.set(key, fingerprint);
    this.seen.add(key);
  }

  /**
   * Register a fire-and-forget capture promise so a later {@link settle} can
   * wait for it to LAND (CAP-01). The promise is removed from the pending set
   * once it settles. The capture swallows its own errors, so `p` never rejects;
   * `.finally` is used purely for cleanup regardless of outcome.
   */
  track(p: Promise<void>): void {
    this.pending.add(p);
    p.finally(() => {
      this.pending.delete(p);
    });
  }

  /**
   * Resolve only once every tracked fire-and-forget capture has settled. The
   * loop re-checks after each batch so a capture queued WHILE settling (rare) is
   * also awaited; in practice it completes in a single pass. Awaited by the heal
   * path before reading a fingerprint and by the persist + teardown flush before
   * serializing, so fire-and-forget capture never loses a same-run baseline.
   */
  async settle(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.allSettled([...this.pending]);
    }
  }

  /** Number of distinct baselines recorded this run. */
  get size(): number {
    return this.fingerprints.size;
  }

  /**
   * Snapshot this worker's run as a transient {@link ShardFile} for the teardown
   * merge (D-11): `captures` is every fingerprint recorded this run, `seen` is
   * every key created/resolved this run. The fs adapter writes this to
   * `shard-<parallelIndex>.json` (Plan 03-02), the reporter merges all shards
   * (Plan 03-03).
   */
  toShard(): ShardFile {
    return {
      version: STORE_FORMAT_VERSION,
      captures: Object.fromEntries(this.fingerprints),
      seen: [...this.seen],
    };
  }

  /**
   * Snapshot this store's fingerprints as a {@link BaselineFile} (the committed
   * shape, D-10). Symmetric to {@link toShard}; used by the reporter to feed a
   * loaded committed baseline into the pure `refresh` (Plan 03-03). Unlike a
   * shard it carries NO `seen` list — the committed file is just the entries.
   */
  toBaselineFile(): BaselineFile {
    return {
      version: STORE_FORMAT_VERSION,
      entries: Object.fromEntries(this.fingerprints),
    };
  }
}
