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

describe("decide", () => {
  it("refuses to heal when the candidate list is empty (no-candidates)", () => {
    const d = decide([], FLOOR);
    expect(d.heal).toBe(false);
    if (d.heal === false) expect(d.reason).toBe("no-candidates");
  });

  it("refuses to heal a genuinely-gone element with only weak matches (false-green guard)", () => {
    // The original element is gone; nothing resembles it closely. Every
    // candidate sits well under the floor -> must NOT heal.
    const d = decide(
      [scored("[data-testid=other-a]", 0.31), scored("[data-testid=other-b]", 0.12)],
      FLOOR,
    );
    expect(d.heal).toBe(false);
    if (d.heal === false) expect(d.reason).toBe("below-floor");
  });

  it("refuses to heal when the best candidate is just under the floor (below-floor)", () => {
    const d = decide([scored("[data-testid=near-miss]", 0.89)], FLOOR);
    expect(d.heal).toBe(false);
    if (d.heal === false) expect(d.reason).toBe("below-floor");
  });

  it("heals to the winner's uniqueSelector when one candidate is clearly above the floor", () => {
    const d = decide(
      [scored("[data-testid=winner]", 0.97), scored("[data-testid=weak]", 0.2)],
      FLOOR,
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
      FLOOR,
    );
    expect(d.heal).toBe(true);
    if (d.heal === true) expect(d.newSelector).toBe("[data-testid=top]");
  });

  it("treats a score exactly at the floor as healable (inclusive floor)", () => {
    const d = decide([scored("[data-testid=exact]", FLOOR)], FLOOR);
    expect(d.heal).toBe(true);
    if (d.heal === true) expect(d.newSelector).toBe("[data-testid=exact]");
  });

  it("ambiguous near-identical duplicates: Phase-1 still picks the top and surfaces the runner-up for Phase 2", () => {
    // Two candidates both above floor and within a hair of each other. Phase 1
    // has no margin gate yet, so it must still heal to the top by score, but
    // the runner-up score MUST be retained so Phase 2 can add the margin
    // reason without reworking the contract.
    const d = decide(
      [scored("[data-testid=dup-a]", 0.95), scored("[data-testid=dup-b]", 0.94)],
      FLOOR,
    );
    expect(d.heal).toBe(true);
    if (d.heal === true) {
      expect(d.newSelector).toBe("[data-testid=dup-a]");
      expect(d.event.score).toBe(0.95);
      expect(d.event.runnerUpScore).toBe(0.94);
    }
  });

  it("omits runnerUpScore when there is exactly one candidate", () => {
    const d = decide([scored("[data-testid=solo]", 0.96)], FLOOR);
    expect(d.heal).toBe(true);
    if (d.heal === true) expect(d.event.runnerUpScore).toBeUndefined();
  });
});
