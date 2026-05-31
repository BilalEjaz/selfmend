import { mkdir, readFile, readdir, rename as fsRename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { parseBaseline, parseShard, type ShardFile } from "./schema.js";
import { BaselineStore } from "./store.js";

/**
 * The fs adapter for the baseline store (CAP-02 / CAP-03).
 *
 * This is the ONLY module in the project allowed to import `node:fs` /
 * `node:fs/promises` / `node:path`. The pure layer (schema/serialize/merge)
 * stays fs-free and Playwright-free; everything that touches the disk is
 * confined here so the trust-critical I/O has one auditable home.
 *
 * Design constraints realized here:
 *  - All store paths are resolved UNDER `rootDir` via `path.resolve`, including
 *    the optional `SELFMEND_STORE_DIR` / explicit-dir override, so a configured
 *    or env-supplied path can never escape the project (T-03-05 traversal).
 *  - Reads are FAIL-SOFT: a missing/empty/non-JSON/foreign-version/malformed
 *    file decodes to the canonical EMPTY store via the Plan 01 safe loaders
 *    (`parseBaseline`/`parseShard`) and NEVER throws (Pitfall 5 / T-03-06).
 *  - The single committed-file write is ATOMIC: temp-file-in-same-dir + rename
 *    with an EPERM/EBUSY/EACCES retry-with-backoff loop for Windows transient
 *    locks (Pattern 3 / Pitfall 1 / T-03-04). Shards are transient and use a
 *    plain write.
 */

/** The store subdirectory name, relative to rootDir (D-01 / D-12). */
const STORE_SUBDIR = ".selfmend";
/** The committed baseline file name (D-01). */
const BASELINE_FILE = "baseline.json";
/** The transient per-worker shards directory name (D-12). */
const SHARDS_SUBDIR = "shards";

/**
 * Resolve the store root directory UNDER `rootDir`.
 *
 * The optional `override` (an explicit dir arg, falling back to the
 * `SELFMEND_STORE_DIR` env var) lets integration tests redirect the store to a
 * temp dir so they never touch the repo's real `.selfmend/baseline.json`
 * (RESEARCH Open Q3). The override is resolved THROUGH `rootDir` with
 * `path.resolve`, so even a `../../escape` override stays clamped: we re-anchor
 * by stripping any leading separators / parent-dir hops that would otherwise
 * climb out of `rootDir`.
 */
function storeRoot(rootDir: string, override?: string): string {
  const base = path.resolve(rootDir);
  const dir = override ?? process.env.SELFMEND_STORE_DIR;
  if (dir === undefined || dir === "") {
    return path.resolve(base, STORE_SUBDIR);
  }
  // Normalize the override to a rootDir-relative path that cannot escape: drop
  // any absolute prefix and any leading `..` segments, then resolve under base.
  const normalized = path
    .normalize(dir)
    .split(/[\\/]+/)
    .filter((seg) => seg !== "" && seg !== ".." && seg !== ".");
  const resolved = path.resolve(base, ...normalized);
  // Final containment guard: if resolution still escaped (defensive), clamp to base.
  const rel = path.relative(base, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return path.resolve(base, STORE_SUBDIR);
  }
  return resolved;
}

/** Absolute path to the committed baseline file, anchored under `rootDir`. */
export function baselinePath(rootDir: string, override?: string): string {
  return path.resolve(storeRoot(rootDir, override), BASELINE_FILE);
}

/** Absolute path to the transient shards directory, anchored under `rootDir`. */
export function shardsDir(rootDir: string, override?: string): string {
  return path.resolve(storeRoot(rootDir, override), SHARDS_SUBDIR);
}

/** Absolute path to one worker's shard, named by its `parallelIndex`. */
export function shardPath(
  rootDir: string,
  parallelIndex: number,
  override?: string,
): string {
  return path.resolve(shardsDir(rootDir, override), `shard-${parallelIndex}.json`);
}

/**
 * Load the committed baseline into a {@link BaselineStore} (read-only at worker
 * start). Reads the file, `JSON.parse`s in a try/catch, hands the parsed value
 * to the safe `parseBaseline` loader, and seeds a store. A missing or bad file
 * yields an EMPTY store and NEVER throws (Pitfall 5).
 */
export async function loadBaseline(
  rootDir: string,
  override?: string,
): Promise<BaselineStore> {
  const target = baselinePath(rootDir, override);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(target, "utf8"));
  } catch {
    // Missing file or non-JSON content -> EMPTY store (ignore-and-recapture).
    parsed = undefined;
  }
  const baseline = parseBaseline(parsed);
  return BaselineStore.fromBaseline(baseline);
}

/**
 * Write one worker's shard. Shards are TRANSIENT (deleted after the teardown
 * merge), so no atomic dance is needed — a plain write after ensuring the dir
 * exists is sufficient. The shard is serialized as plain JSON.
 */
export async function writeShard(target: string, shard: ShardFile): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(shard), "utf8");
}

/**
 * Read every `shard-*.json` in `dir`, parse each via the safe `parseShard`
 * loader, and return the parsed shards. A missing dir yields `[]`; a malformed
 * or foreign-version shard parses to the EMPTY shard rather than throwing
 * (Pitfall 5), so a stale shard from an older plugin version never crashes the
 * teardown merge.
 */
export async function readShards(dir: string): Promise<ShardFile[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const shardNames = names.filter(
    (n) => n.startsWith("shard-") && n.endsWith(".json"),
  );
  const shards: ShardFile[] = [];
  for (const name of shardNames) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(path.join(dir, name), "utf8"));
    } catch {
      parsed = undefined;
    }
    shards.push(parseShard(parsed));
  }
  return shards;
}

/** Codes for transient Windows lock failures worth retrying on `rename`. */
const RETRYABLE_RENAME_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);

/** Injectable rename signature, so tests can simulate transient lock failures. */
type RenameFn = (from: string, to: string) => Promise<void>;

/** Tuning + test seams for {@link atomicWrite}. */
export interface AtomicWriteOptions {
  /** Override the rename implementation (test seam for the retry path). */
  rename?: RenameFn;
  /** Max rename attempts before giving up (default 10). */
  maxAttempts?: number;
  /** Base linear backoff in ms between retries (default 50). */
  backoffMs?: number;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Atomically write `data` to `target` (Pattern 3, T-03-04).
 *
 * Writes to a unique temp file in the SAME directory (same volume, so the
 * rename cannot throw `EXDEV`), then renames it over the target. On Windows the
 * rename over an existing/locked file can transiently throw `EPERM`/`EBUSY`/
 * `EACCES` (AV, Search indexer); we retry with linear backoff up to
 * `maxAttempts`. On exhaustion we remove the temp file and rethrow, so a reader
 * NEVER sees a half-written target (Pitfall 1).
 */
export async function atomicWrite(
  target: string,
  data: string,
  options: AtomicWriteOptions = {},
): Promise<void> {
  const rename = options.rename ?? fsRename;
  const maxAttempts = options.maxAttempts ?? 10;
  const backoffMs = options.backoffMs ?? 50;

  // Ensure the target directory exists before writing the temp sibling: the
  // first committed write of a run may land in a store dir no worker created
  // (e.g. a complete run that captured nothing, or a fresh SELFMEND_STORE_DIR).
  await mkdir(path.dirname(target), { recursive: true });

  const tmp = `${target}.${process.pid}.${Date.now()}.${Math.random()
    .toString(36)
    .slice(2)}.tmp`;
  await writeFile(tmp, data, "utf8");

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await rename(tmp, target);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      const retryable = code !== undefined && RETRYABLE_RENAME_CODES.has(code);
      if (retryable && attempt < maxAttempts - 1) {
        await delay(backoffMs * (attempt + 1));
        continue;
      }
      // Non-retryable, or retries exhausted: clean up the temp and rethrow so a
      // reader never sees a partial target.
      await rm(tmp, { force: true });
      throw err;
    }
  }
}

/**
 * Remove the transient shards directory after a successful merge (D-12).
 * Force + recursive so a missing dir is a no-op and never throws.
 */
export async function deleteShards(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}
