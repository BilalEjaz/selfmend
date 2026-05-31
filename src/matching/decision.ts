import type { Decision, ScoredCandidate } from "./types.js";

/**
 * Pure heal / no-heal decision over scored candidates (MATCH-02, MATCH-03,
 * D-01..D-04, D-09).
 *
 * This module is where the product's defining trust guarantee lives in code.
 * It refuses to heal unless TWO gates pass (D-03):
 *  1. Floor gate (MATCH-02): the top candidate must clear the conservative
 *     confidence floor, so a genuinely-gone or only-vaguely-similar element
 *     fails the test normally instead of producing a false green (Pitfall 2).
 *  2. Margin gate (MATCH-03, D-01): the top candidate must beat the runner-up
 *     by an ABSOLUTE gap of at least `margin` (same 0..1 score units), so two
 *     look-alike duplicates that score within a hair of each other are refused
 *     as `ambiguous` rather than guessed at. A solo candidate trivially passes
 *     this gate (D-02) — the margin only constrains the multi-candidate case.
 *
 * The gate order is load-bearing for the reported reason (D-03): floor is
 * checked first, so two below-floor candidates report `below-floor`, not
 * `ambiguous`. Every refusal carries `bestScore` (the top score seen, or `null`
 * when there were no candidates) so the reporter can show how close it came (D-04).
 *
 * It is PURE: it imports nothing from Playwright, `node:fs`, or the network,
 * and consumes only the {@link ScoredCandidate}[] produced by the pure scorer.
 */

/**
 * Decide whether to heal given scored candidates and the two gate thresholds.
 *
 * @param scored Candidates already scored against the broken locator's
 *   fingerprint. May be empty.
 * @param opts.floor Inclusive confidence floor in `[0, 1]` (D-09 conservative
 *   default ~0.9). The top candidate must score at or above this to heal.
 * @param opts.margin Inclusive absolute second-best gap in `[0, 1]` (D-01,
 *   default ~0.05). The top must beat the runner-up by at least this much.
 * @returns `{ heal: true, newSelector, event }` when the best candidate clears
 *   both gates, otherwise `{ heal: false, reason, bestScore }` so the caller
 *   re-throws and the test fails normally (no false green).
 */
export function decide(
  scored: ScoredCandidate[],
  opts: { floor: number; margin: number },
): Decision {
  if (scored.length === 0) {
    return { heal: false, reason: "no-candidates", bestScore: null };
  }

  // Copy before sorting so the caller's array is not mutated (purity); sort by
  // score descending so the top candidate is the winner.
  const ranked = [...scored].sort((a, b) => b.score - a.score);
  const winner = ranked[0];
  if (winner === undefined) {
    // Unreachable given the length check above, but keeps the union exhaustive.
    return { heal: false, reason: "no-candidates", bestScore: null };
  }

  // Gate 1 (D-03, checked first): the genuinely-gone / vaguely-similar case.
  if (winner.score < opts.floor) {
    return { heal: false, reason: "below-floor", bestScore: winner.score };
  }

  const runnerUp = ranked[1];

  // Gate 2 (D-01/D-02): a runner-up within `margin` of the winner is a
  // look-alike duplicate -> refuse as ambiguous. A solo candidate (no
  // runner-up) trivially passes this gate. Gate is `< margin` refuses /
  // `>= margin` heals, mirroring the inclusive floor. A tiny epsilon absorbs
  // IEEE-754 subtraction drift (e.g. 0.95 - 0.9 = 0.04999...) so an exact-gap
  // boundary heals as documented rather than refusing on a rounding artifact.
  const GAP_EPSILON = 1e-9;
  if (
    runnerUp !== undefined &&
    winner.score - runnerUp.score < opts.margin - GAP_EPSILON
  ) {
    return { heal: false, reason: "ambiguous", bestScore: winner.score };
  }

  return {
    heal: true,
    newSelector: winner.candidate.uniqueSelector,
    event: {
      newSelector: winner.candidate.uniqueSelector,
      score: winner.score,
      // Retained for the report; omitted when solo (D-02).
      ...(runnerUp !== undefined ? { runnerUpScore: runnerUp.score } : {}),
    },
  };
}
