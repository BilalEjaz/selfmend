import { z } from "zod";
import type { Fingerprint } from "../matching/types.js";

/**
 * The on-disk store-format version (D-10).
 *
 * This number is part of the plugin's PUBLIC semver contract: the committed
 * `baseline.json` and the transient per-worker shards both carry it. A file
 * whose version does NOT equal this literal is treated as foreign and decoded
 * to the canonical EMPTY store (ignore-and-recapture) rather than half-read or
 * crashed on (see {@link parseBaseline} / {@link parseShard}). Bumping the
 * on-disk shape requires bumping this and is at least a minor release.
 */
export const STORE_FORMAT_VERSION = 1;

/**
 * The derived-signals-ONLY fingerprint schema (D-02).
 *
 * Mirrors the eight fields of {@link Fingerprint} exactly. It is STRICT: an
 * object carrying an unknown key (notably a raw-DOM leak such as `innerHTML` /
 * `outerHTML` / `html` / `innerText`) is REJECTED, not silently stripped, so a
 * raw-DOM field can never enter the committed, human-readable file (ASVS V8 /
 * T-03-02). `attrs` is an open string->string record (attribute name -> value).
 *
 * A compile-time check below (`satisfies`) ties the inferred type back to
 * {@link Fingerprint} so the schema and the contract cannot drift apart.
 */
export const fingerprintSchema = z
  .strictObject({
    tag: z.string(),
    role: z.string(),
    text: z.string(),
    testId: z.string(),
    attrs: z.record(z.string(), z.string()),
    ordinal: z.number(),
    parentTag: z.string(),
    neighbourSignature: z.string(),
  });

// Compile-time guard: the schema output must be assignable to Fingerprint.
// (zod marks `attrs` mutable; Fingerprint marks it Readonly — assignment is safe.)
type _FingerprintOut = z.infer<typeof fingerprintSchema>;
const _fingerprintContract = (fp: _FingerprintOut): Fingerprint => fp;
void _fingerprintContract;

/**
 * The committed baseline file shape: `{ version, entries }` (D-10).
 *
 * `version` is a `z.literal`, so any other value fails validation and the
 * loader falls back to EMPTY — a future/older format is never half-read.
 */
export const baselineFileSchema = z.object({
  version: z.literal(STORE_FORMAT_VERSION),
  entries: z.record(z.string(), fingerprintSchema),
});

/**
 * A transient per-worker shard shape (Open Q3):
 * `{ version, captures: Record<key, Fingerprint>, seen: key[] }`.
 *
 * `captures` are the fingerprints this worker recorded; `seen` is every key the
 * worker created OR resolved this run, so the reporter's prune can distinguish
 * "executed but not captured" from "not executed at all" (D-09).
 */
export const shardFileSchema = z.object({
  version: z.literal(STORE_FORMAT_VERSION),
  captures: z.record(z.string(), fingerprintSchema),
  seen: z.array(z.string()),
});

/** A fully-validated committed baseline file. */
export type BaselineFile = z.infer<typeof baselineFileSchema>;

/** A fully-validated transient shard file. */
export type ShardFile = z.infer<typeof shardFileSchema>;

/** The canonical empty baseline (ignore-and-recapture target, D-10). */
const EMPTY_BASELINE: BaselineFile = {
  version: STORE_FORMAT_VERSION,
  entries: {},
};

/** The canonical empty shard. */
const EMPTY_SHARD: ShardFile = {
  version: STORE_FORMAT_VERSION,
  captures: {},
  seen: [],
};

/**
 * Parse an already-decoded JS value into a {@link BaselineFile} (D-10, T-03-01).
 *
 * PURE: takes a parsed value (the fs adapter in Plan 02 owns reading the file +
 * `JSON.parse`); imports neither `node:fs` nor Playwright. On ANY failure —
 * version mismatch, missing fields, wrong types, a raw-DOM leak rejected by the
 * strict fingerprint schema, or a non-object input — it returns a FRESH copy of
 * the canonical EMPTY store and NEVER throws, so a stale or hand-edited file can
 * never crash a user's test run.
 */
export function parseBaseline(raw: unknown): BaselineFile {
  const result = baselineFileSchema.safeParse(raw);
  if (!result.success) {
    return { ...EMPTY_BASELINE, entries: {} };
  }
  return result.data;
}

/**
 * Parse an already-decoded JS value into a {@link ShardFile} (D-10, T-03-01).
 *
 * Same contract as {@link parseBaseline}: PURE, never throws, returns a fresh
 * canonical EMPTY shard on any validation failure (a stale shard from an older
 * plugin version is ignored, never crashing the teardown merge — Pitfall 5).
 */
export function parseShard(raw: unknown): ShardFile {
  const result = shardFileSchema.safeParse(raw);
  if (!result.success) {
    return { ...EMPTY_SHARD, captures: {}, seen: [] };
  }
  return result.data;
}
