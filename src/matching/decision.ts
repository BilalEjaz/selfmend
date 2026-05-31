import type { Decision, ScoredCandidate } from "./types.js";

/**
 * Pure heal / no-heal decision over scored candidates (MATCH-01, D-09).
 *
 * This module is where the product's defining trust guarantee lives in code:
 * it refuses to heal unless a candidate clears the conservative confidence
 * floor, so a genuinely-gone element or an only-vaguely-similar match fails
 * the test normally instead of producing a false green (Pitfall 2 / T-02-01).
 *
 * It is PURE: it imports nothing from Playwright, `node:fs`, or the network,
 * and consumes only the {@link ScoredCandidate}[] produced by the pure scorer.
 * Phase 1 ships the floor gate only; the second-best margin gate is Phase 2,
 * and this module already retains the runner-up score so that gate can be
 * layered on without reworking the contract.
 */

/**
 * Decide whether to heal given scored candidates and a confidence floor.
 *
 * @param scored Candidates already scored against the broken locator's
 *   fingerprint. May be empty.
 * @param floor Inclusive confidence floor in `[0, 1]` (D-09 conservative
 *   default ~0.9). The top candidate must score at or above this to heal.
 * @returns `{ heal: true, newSelector, event }` when the best candidate clears
 *   the floor, otherwise `{ heal: false, reason }` so the caller re-throws and
 *   the test fails normally.
 */
export function decide(scored: ScoredCandidate[], floor: number): Decision {
  if (scored.length === 0) {
    return { heal: false, reason: "no-candidates" };
  }

  // Copy before sorting so the caller's array is not mutated (purity); sort by
  // score descending so the top candidate is the winner.
  const ranked = [...scored].sort((a, b) => b.score - a.score);
  const winner = ranked[0];
  if (winner === undefined) {
    // Unreachable given the length check above, but keeps the union exhaustive.
    return { heal: false, reason: "no-candidates" };
  }

  if (winner.score < floor) {
    // The genuinely-gone / vaguely-similar case: refuse to heal (false-green
    // guard). The margin gate (Phase 2) layers on top of this floor gate.
    return { heal: false, reason: "below-floor" };
  }

  const runnerUp = ranked[1];
  return {
    heal: true,
    newSelector: winner.candidate.uniqueSelector,
    event: {
      newSelector: winner.candidate.uniqueSelector,
      score: winner.score,
      // Retained for the Phase 2 margin gate + report; omitted when solo.
      ...(runnerUp !== undefined ? { runnerUpScore: runnerUp.score } : {}),
    },
  };
}
