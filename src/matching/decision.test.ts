import { describe, it, expect } from "vitest";
import { decide } from "./decision.js";
import type { CandidateDescriptor, ScoredCandidate } from "./types.js";

/** A minimal candidate carrying a distinguishable unique selector. */
function candidate(selector: string): CandidateDescriptor {
  return {
    tag: "button",
    role: "button",
    text: "",
    testId: "",
    attrs: {},
    ordinal: -1,
    parentTag: "",
    neighbourSignature: "",
    uniqueSelector: selector,
  };
}

/** Pair a unique selector with a score. */
function scored(selector: string, s: number): ScoredCandidate {
  return { candidate: candidate(selector), score: s };
}

const FLOOR = 0.9;
const MARGIN = 0.05;
/** The options object both gates read from (D-03, D-07 global-only). */
const GATES = { floor: FLOOR, margin: MARGIN };

describe("decide", () => {
  // --- Phase 1 floor-gate cases (retained, call sites moved to the options object) ---

  it("refuses to heal when the candidate list is empty (no-candidates)", () => {
    const d = decide([], GATES);
    expect(d.heal).toBe(false);
    if (d.heal === false) {
      expect(d.reason).toBe("no-candidates");
      // D-04: every no-heal carries bestScore; null when there is nothing to score.
      expect(d.bestScore).toBeNull();
    }
  });

  it("refuses to heal a genuinely-gone element with only weak matches (false-green guard)", () => {
    // The original element is gone; nothing resembles it closely. Every
    // candidate sits well under the floor -> must NOT heal.
    const d = decide(
      [scored("[data-testid=other-a]", 0.31), scored("[data-testid=other-b]", 0.12)],
      GATES,
    );
    expect(d.heal).toBe(false);
    if (d.heal === false) {
      expect(d.reason).toBe("below-floor");
      expect(d.bestScore).toBe(0.31);
    }
  });

  it("refuses to heal when the best candidate is just under the floor (below-floor)", () => {
    const d = decide([scored("[data-testid=near-miss]", 0.89)], GATES);
    expect(d.heal).toBe(false);
    if (d.heal === false) {
      expect(d.reason).toBe("below-floor");
      // D-04: report the top score seen even on a refusal.
      expect(d.bestScore).toBe(0.89);
    }
  });

  it("heals to the winner's uniqueSelector when one candidate is clearly above the floor", () => {
    const d = decide(
      [scored("[data-testid=winner]", 0.97), scored("[data-testid=weak]", 0.2)],
      GATES,
    );
    expect(d.heal).toBe(true);
    if (d.heal === true) {
      expect(d.newSelector).toBe("[data-testid=winner]");
      expect(d.event.newSelector).toBe("[data-testid=winner]");
      expect(d.event.score).toBe(0.97);
    }
  });

  it("sorts by score so the top candidate wins regardless of input order", () => {
    const d = decide(
      [scored("[data-testid=low]", 0.91), scored("[data-testid=top]", 0.99)],
      GATES,
    );
    expect(d.heal).toBe(true);
    if (d.heal === true) expect(d.newSelector).toBe("[data-testid=top]");
  });

  it("treats a score exactly at the floor as healable (inclusive floor)", () => {
    const d = decide([scored("[data-testid=exact]", FLOOR)], GATES);
    expect(d.heal).toBe(true);
    if (d.heal === true) expect(d.newSelector).toBe("[data-testid=exact]");
  });

  it("omits runnerUpScore when there is exactly one candidate", () => {
    const d = decide([scored("[data-testid=solo]", 0.96)], GATES);
    expect(d.heal).toBe(true);
    if (d.heal === true) expect(d.event.runnerUpScore).toBeUndefined();
  });

  // --- Phase 2 margin-gate cases (MATCH-03, D-01/D-02/D-03) ---

  it("refuses ambiguous near-duplicates within the margin (ambiguous, D-01)", () => {
    // Both above the floor, but the gap (0.02) is under the margin (0.05): a
    // look-alike duplicate the gate must refuse rather than guess wrong.
    const d = decide(
      [scored("[data-testid=dup-a]", 0.95), scored("[data-testid=dup-b]", 0.93)],
      GATES,
    );
    expect(d.heal).toBe(false);
    if (d.heal === false) {
      expect(d.reason).toBe("ambiguous");
      expect(d.bestScore).toBe(0.95);
    }
  });

  it("heals when the gap is exactly the margin (inclusive >= margin, mirrors the floor)", () => {
    // gap = 0.95 - 0.90 = 0.05 === margin -> heals (gate is `< margin` refuses).
    const d = decide(
      [scored("[data-testid=top]", 0.95), scored("[data-testid=runner]", 0.9)],
      GATES,
    );
    expect(d.heal).toBe(true);
    if (d.heal === true) {
      expect(d.newSelector).toBe("[data-testid=top]");
      expect(d.event.runnerUpScore).toBe(0.9);
    }
  });

  it("heals a solo candidate above the floor: it trivially passes the margin gate (D-02)", () => {
    const d = decide([scored("[data-testid=solo]", 0.95)], GATES);
    expect(d.heal).toBe(true);
    if (d.heal === true) {
      expect(d.newSelector).toBe("[data-testid=solo]");
      expect(d.event.runnerUpScore).toBeUndefined();
    }
  });

  it("heals a clear winner over a distant runner-up and retains the runner-up score", () => {
    // gap = 0.97 - 0.80 = 0.17 >> margin -> a genuine single survivor.
    const d = decide(
      [scored("[data-testid=winner]", 0.97), scored("[data-testid=also-ran]", 0.8)],
      GATES,
    );
    expect(d.heal).toBe(true);
    if (d.heal === true) {
      expect(d.newSelector).toBe("[data-testid=winner]");
      expect(d.event.score).toBe(0.97);
      expect(d.event.runnerUpScore).toBe(0.8);
    }
  });

  it("checks the floor before the margin: two below-floor candidates report below-floor, not ambiguous (D-03)", () => {
    // Both under the floor; their gap (0.01) is also under the margin. The
    // load-bearing order (D-03) means floor is reported first.
    const d = decide(
      [scored("[data-testid=a]", 0.85), scored("[data-testid=b]", 0.84)],
      GATES,
    );
    expect(d.heal).toBe(false);
    if (d.heal === false) {
      expect(d.reason).toBe("below-floor");
      expect(d.bestScore).toBe(0.85);
    }
  });
});
