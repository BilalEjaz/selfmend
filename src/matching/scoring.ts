import type { CandidateDescriptor, Fingerprint } from "./types.js";

/**
 * Pure, deterministic, offline element scorer (the core IP, MATCH-01).
 *
 * `score(fingerprint, candidate)` returns a match confidence in `[0, 1]` as a
 * weighted sum of per-signal sub-scores. High-stability identity signals
 * (test-id, computed role + accessible name) carry far more weight than
 * volatile ones (class tokens, sibling ordinal, neighbourhood) so that a
 * candidate which keeps its identity but drifts cosmetically still scores
 * high, while one that merely shares a tag scores low.
 *
 * Determinism and dependency-freedom are contractual (T-02-02): this module
 * imports nothing from Playwright, `node:fs`, or the network, and the same
 * inputs always produce the same number. The weight table and per-signal
 * scorers are named exports so Phase 2 can re-calibrate without a rewrite.
 */

/**
 * Per-signal weights. Identity signals dominate; volatile signals contribute
 * only a little. Weights are normalized by their realized total at scoring
 * time, so they need not sum to 1 here and can be re-tuned freely in Phase 2.
 */
export const SIGNAL_WEIGHTS = {
  /** Strongest single identity signal when present. */
  testId: 6,
  /** Computed/explicit ARIA role: a strong, stable identity signal. */
  role: 3,
  /** Accessible name / text: strong identity, compared with fuzzy similarity. */
  text: 4,
  /** Element tag: moderately stable. */
  tag: 1,
  /** Stable attributes (name/type/etc.): moderate identity signal. */
  attrs: 2,
  /** Parent tag: weak structural signal. */
  parentTag: 0.5,
  /** Neighbourhood signature: weak, volatile structural signal. */
  neighbourSignature: 0.5,
  /** Sibling ordinal: weak and volatile (DOM reorders easily). */
  ordinal: 0.25,
} as const;

/** A single signal's contribution: its similarity in `[0,1]` and its weight. */
interface SignalContribution {
  /** Per-signal similarity in `[0, 1]`. */
  similarity: number;
  /** This signal's weight from {@link SIGNAL_WEIGHTS}. */
  weight: number;
}

/** Exact-equality similarity for discrete string signals: 1 if equal, else 0. */
export function exactSimilarity(a: string, b: string): number {
  return a === b ? 1 : 0;
}

/**
 * Normalize text for comparison: lowercase, collapse runs of whitespace, and
 * trim. Keeps the comparison resilient to casing and spacing drift.
 */
function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Levenshtein edit distance between two strings (iterative, two-row).
 * Pure and bounded; used as a character-level fallback similarity.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1).fill(0);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      const deletion = (prev[j] ?? 0) + 1;
      const insertion = (curr[j - 1] ?? 0) + 1;
      const substitution = (prev[j - 1] ?? 0) + cost;
      curr[j] = Math.min(deletion, insertion, substitution);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length] ?? 0;
}

/** Jaccard token overlap on whitespace-split tokens, in `[0, 1]`. */
function tokenOverlap(a: string, b: string): number {
  const ta = new Set(a.split(" ").filter(Boolean));
  const tb = new Set(b.split(" ").filter(Boolean));
  if (ta.size === 0 && tb.size === 0) return 1;
  if (ta.size === 0 || tb.size === 0) return 0;
  let intersection = 0;
  for (const t of ta) if (tb.has(t)) intersection++;
  const union = ta.size + tb.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Fuzzy text similarity in `[0, 1]`: the max of token overlap (word-level) and
 * normalized edit-distance similarity (character-level). Both empty -> 1.
 * Minor drift ("Submit order" vs "Submit orders") scores partial, not 0, so a
 * small text change still contributes positively (not raw equality).
 */
export function textSimilarity(a: string, b: string): number {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (na === "" && nb === "") return 1;
  if (na === nb) return 1;

  const overlap = tokenOverlap(na, nb);
  const maxLen = Math.max(na.length, nb.length);
  const editSim = maxLen === 0 ? 1 : 1 - levenshtein(na, nb) / maxLen;
  return Math.max(overlap, editSim);
}

/**
 * Similarity over two attribute maps in `[0, 1]`: the fraction of the union of
 * keys whose values match exactly. Both empty -> neutral (treated as 0
 * contribution by carrying weight 0 at the call site).
 */
export function attrsSimilarity(
  a: Readonly<Record<string, string>>,
  b: Readonly<Record<string, string>>,
): number {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  if (keys.size === 0) return 0;
  let matches = 0;
  for (const k of keys) if (a[k] !== undefined && a[k] === b[k]) matches++;
  return matches / keys.size;
}

/**
 * Build the list of weighted per-signal contributions for a fingerprint vs a
 * candidate. A signal only participates when at least one side carries it
 * (e.g. an empty test-id on both sides neither helps nor hurts), so absent
 * signals do not dilute the score toward 0.
 */
function contributions(
  fp: Fingerprint,
  c: CandidateDescriptor,
): SignalContribution[] {
  const out: SignalContribution[] = [];

  const add = (
    weight: number,
    similarity: number,
    participates: boolean,
  ): void => {
    if (participates) out.push({ similarity, weight });
  };

  add(
    SIGNAL_WEIGHTS.testId,
    exactSimilarity(fp.testId, c.testId),
    fp.testId !== "" || c.testId !== "",
  );
  add(
    SIGNAL_WEIGHTS.role,
    exactSimilarity(fp.role, c.role),
    fp.role !== "" || c.role !== "",
  );
  add(
    SIGNAL_WEIGHTS.text,
    textSimilarity(fp.text, c.text),
    fp.text !== "" || c.text !== "",
  );
  add(
    SIGNAL_WEIGHTS.tag,
    exactSimilarity(fp.tag, c.tag),
    fp.tag !== "" || c.tag !== "",
  );
  add(
    SIGNAL_WEIGHTS.attrs,
    attrsSimilarity(fp.attrs, c.attrs),
    Object.keys(fp.attrs).length > 0 || Object.keys(c.attrs).length > 0,
  );
  add(
    SIGNAL_WEIGHTS.parentTag,
    exactSimilarity(fp.parentTag, c.parentTag),
    fp.parentTag !== "" || c.parentTag !== "",
  );
  add(
    SIGNAL_WEIGHTS.neighbourSignature,
    exactSimilarity(fp.neighbourSignature, c.neighbourSignature),
    fp.neighbourSignature !== "" || c.neighbourSignature !== "",
  );
  add(
    SIGNAL_WEIGHTS.ordinal,
    fp.ordinal >= 0 && c.ordinal >= 0 && fp.ordinal === c.ordinal ? 1 : 0,
    fp.ordinal >= 0 || c.ordinal >= 0,
  );

  return out;
}

/**
 * Score a candidate against a fingerprint: a weighted average of per-signal
 * similarities, normalized to `[0, 1]`. Returns 0 when no signal participates.
 */
export function score(fp: Fingerprint, c: CandidateDescriptor): number {
  const parts = contributions(fp, c);
  let weighted = 0;
  let totalWeight = 0;
  for (const { similarity, weight } of parts) {
    weighted += similarity * weight;
    totalWeight += weight;
  }
  if (totalWeight === 0) return 0;
  const result = weighted / totalWeight;
  // Clamp defensively against floating-point drift so the [0,1] contract holds.
  return Math.min(1, Math.max(0, result));
}
