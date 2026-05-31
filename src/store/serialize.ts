import { STORE_FORMAT_VERSION } from "./schema.js";
import type { BaselineFile } from "./schema.js";
import type { Fingerprint } from "../matching/types.js";

/**
 * PURE deterministic serializer for the committed baseline file (D-03).
 *
 * Imports only the {@link BaselineFile} type + {@link STORE_FORMAT_VERSION} from
 * `./schema.js`; NO `node:fs`, NO Playwright. The whole point is byte-stability:
 * two logically-equal stores built in any key-insertion order MUST serialize to
 * an identical string, so a re-run with no real change produces ZERO diff churn
 * (T-03-03). We achieve that by rebuilding every object with a FIXED key order
 * rather than trusting `JSON.stringify`'s insertion-order traversal:
 *
 * - `entries` keys are emitted in stable code-point sort order.
 * - each fingerprint emits its eight fields in a FIXED canonical order.
 * - `attrs` keys are emitted in stable sort order.
 *
 * The output is 2-space-indented JSON with a trailing newline (POSIX-friendly).
 */

/** Stable code-point comparator (locale-independent, deterministic). */
function byCodePoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Rebuild a record with its keys in stable sort order. */
function sortRecord(record: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(record).sort(byCodePoint)) {
    out[key] = record[key]!;
  }
  return out;
}

/**
 * Rebuild a fingerprint with a FIXED field order and sorted `attrs`. The fixed
 * order is the canonical on-disk order; it never depends on how the object was
 * constructed in memory.
 */
function canonicalFingerprint(fp: Fingerprint): Record<string, unknown> {
  return {
    tag: fp.tag,
    role: fp.role,
    text: fp.text,
    testId: fp.testId,
    attrs: sortRecord(fp.attrs as Record<string, string>),
    ordinal: fp.ordinal,
    parentTag: fp.parentTag,
    neighbourSignature: fp.neighbourSignature,
  };
}

/**
 * Serialize a baseline store to its canonical, byte-stable string form.
 *
 * @param store The in-memory baseline file (any key-insertion order).
 * @returns Deterministic 2-space JSON with a trailing newline.
 */
export function serialize(store: BaselineFile): string {
  const entries: Record<string, unknown> = {};
  for (const key of Object.keys(store.entries).sort(byCodePoint)) {
    entries[key] = canonicalFingerprint(store.entries[key]!);
  }
  // version first, then entries — a fixed top-level order.
  const canonical = { version: STORE_FORMAT_VERSION, entries };
  return JSON.stringify(canonical, null, 2) + "\n";
}
