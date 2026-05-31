import { describe, it, expect } from "vitest";
import { score } from "./scoring.js";
import type { CandidateDescriptor, Fingerprint } from "./types.js";

/**
 * Build a Fingerprint with sensible empty defaults so each test only states
 * the signals it cares about.
 */
function fingerprint(overrides: Partial<Fingerprint> = {}): Fingerprint {
  return {
    tag: "",
    role: "",
    text: "",
    testId: "",
    attrs: {},
    ordinal: -1,
    parentTag: "",
    neighbourSignature: "",
    ...overrides,
  };
}

/** Build a CandidateDescriptor with empty defaults plus a unique selector. */
function candidate(
  overrides: Partial<CandidateDescriptor> = {},
): CandidateDescriptor {
  return {
    tag: "",
    role: "",
    text: "",
    testId: "",
    attrs: {},
    ordinal: -1,
    parentTag: "",
    neighbourSignature: "",
    uniqueSelector: "css=*",
    ...overrides,
  };
}

describe("score", () => {
  it("scores identical signals at or near 1", () => {
    const fp = fingerprint({
      tag: "button",
      role: "button",
      text: "Submit order",
      testId: "submit-btn",
      attrs: { name: "submit", type: "submit" },
      ordinal: 2,
      parentTag: "form",
      neighbourSignature: "input,input,button",
    });
    const c = candidate({
      tag: "button",
      role: "button",
      text: "Submit order",
      testId: "submit-btn",
      attrs: { name: "submit", type: "submit" },
      ordinal: 2,
      parentTag: "form",
      neighbourSignature: "input,input,button",
      uniqueSelector: "[data-testid=submit-btn]",
    });
    expect(score(fp, c)).toBeGreaterThanOrEqual(0.99);
  });

  it("scores high when strong-weight signals match but volatile ones differ", () => {
    // testId + role + accessible name all match; only volatile signals
    // (ordinal, class-ish attrs, neighbour signature) drift.
    const fp = fingerprint({
      tag: "button",
      role: "button",
      text: "Submit order",
      testId: "submit-btn",
      attrs: { name: "submit", class: "btn-primary-a1b2" },
      ordinal: 2,
      parentTag: "form",
      neighbourSignature: "input,input,button",
    });
    const c = candidate({
      tag: "button",
      role: "button",
      text: "Submit order",
      testId: "submit-btn",
      attrs: { name: "submit", class: "btn-primary-x9y8" },
      ordinal: 7,
      parentTag: "div",
      neighbourSignature: "span,button",
    });
    expect(score(fp, c)).toBeGreaterThanOrEqual(0.8);
  });

  it("scores low when only a weak signal is shared", () => {
    // Same tag only; identity signals (testId, role, text) all differ.
    const fp = fingerprint({
      tag: "button",
      role: "button",
      text: "Submit order",
      testId: "submit-btn",
    });
    const c = candidate({
      tag: "button",
      role: "link",
      text: "Cancel",
      testId: "cancel-link",
    });
    const s = score(fp, c);
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(0.4);
  });

  it("scores near 0 when no signals overlap", () => {
    const fp = fingerprint({
      tag: "button",
      role: "button",
      text: "Submit order",
      testId: "submit-btn",
      attrs: { name: "submit" },
      parentTag: "form",
    });
    const c = candidate({
      tag: "a",
      role: "link",
      text: "Privacy policy",
      testId: "footer-privacy",
      attrs: { href: "/privacy" },
      parentTag: "footer",
    });
    expect(score(fp, c)).toBeLessThan(0.15);
  });

  it("is deterministic: identical inputs yield the identical score", () => {
    const fp = fingerprint({ tag: "button", role: "button", text: "Go" });
    const c = candidate({ tag: "button", role: "button", text: "Go" });
    const a = score(fp, c);
    const b = score(fp, c);
    expect(a).toBe(b);
  });

  it("always returns a value bounded within [0, 1]", () => {
    const samples: Array<[Fingerprint, CandidateDescriptor]> = [
      [fingerprint(), candidate()],
      [
        fingerprint({ tag: "button", role: "button", text: "Submit", testId: "x" }),
        candidate({ tag: "button", role: "button", text: "Submit", testId: "x" }),
      ],
      [
        fingerprint({ tag: "button", text: "Submit order now please" }),
        candidate({ tag: "a", text: "totally different unrelated" }),
      ],
    ];
    for (const [fp, c] of samples) {
      const s = score(fp, c);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
  });

  it("ranks an identity-preserving candidate above a structure-only one by more than the default margin (weight ordering invariant, D-09)", () => {
    // This invariant is what lets Plan 02's margin gate (default 0.05)
    // distinguish a TRUE heal from a structural also-ran: a candidate that
    // keeps the element's identity (testId + role + text) must out-score one
    // that merely shares the structural shell (tag/ordinal/parentTag) by a gap
    // the gate can act on. Asserted RELATIVELY (ordering + >0.05 gap), never by
    // exact magic numbers, so SIGNAL_WEIGHTS can re-tune without breaking this.
    const fp = fingerprint({
      tag: "button",
      role: "button",
      text: "Submit order",
      testId: "submit-btn",
      ordinal: 2,
      parentTag: "form",
    });

    // Keeps identity (testId/role/text); only volatile structure drifts.
    const identity = candidate({
      tag: "span", // drifted tag
      role: "button",
      text: "Submit order",
      testId: "submit-btn",
      ordinal: 9, // drifted ordinal
      parentTag: "div", // drifted parent
    });

    // Keeps only the structural shell; identity signals all differ.
    const structure = candidate({
      tag: "button",
      role: "link", // different role
      text: "Cancel subscription", // different text
      testId: "cancel-link", // different testId
      ordinal: 2, // same ordinal
      parentTag: "form", // same parent
    });

    const sIdentity = score(fp, identity);
    const sStructure = score(fp, structure);

    expect(sIdentity).toBeGreaterThan(sStructure);
    // The gap must exceed the default margin so a real heal among structural
    // look-alikes clears the gate (DEFAULT_MARGIN = 0.05).
    expect(sIdentity - sStructure).toBeGreaterThan(0.05);
  });

  it("uses normalized text similarity, not raw equality, so minor drift still scores partial", () => {
    // Identical on everything except a tiny text drift. The text sub-score
    // must be partial (not 0), so a small drift scores HIGHER than a total
    // text mismatch but LOWER than an exact text match.
    const base = {
      tag: "button",
      role: "button",
      testId: "submit-btn",
    } as const;
    const fp = fingerprint({ ...base, text: "Submit order" });

    const exact = candidate({ ...base, text: "Submit order" });
    const drifted = candidate({ ...base, text: "Submit orders" });
    const unrelated = candidate({ ...base, text: "Delete everything forever" });

    const sExact = score(fp, exact);
    const sDrift = score(fp, drifted);
    const sUnrelated = score(fp, unrelated);

    expect(sDrift).toBeLessThan(sExact);
    expect(sDrift).toBeGreaterThan(sUnrelated);
  });
});
