import { describe, it, expect } from "vitest";

import { createOccurrenceCounter } from "./locator-proxy.js";
import { buildPageSelector } from "./fixture.js";

/**
 * IN-02: the page-factory selector built by the fixture must use the SAME
 * hardened arg-stringifier as the locator proxy (locator-proxy.describeArgs),
 * NOT a weaker local copy that collapsed non-serializable args to "". Two
 * genuinely-different non-serializable factory args must yield DISTINCT
 * selectors so they get distinct baseline keys (the LO-02/CR-01 collision
 * class, closed on the proxy side and previously left open on the fixture
 * side).
 */
describe("fixture page-factory selector hardening (IN-02)", () => {
  it("two distinct non-serializable args do NOT collide on one selector", () => {
    const nextOccurrence = createOccurrenceCounter();
    // Two different Locator-like values passed as a `has` filter would both
    // JSON.stringify to `{}` (or throw), collapsing to "" under the old weak
    // fixture describeArgs. The hardened version folds a distinguishing
    // <object#N> token so they stay distinct.
    const hasA = { _locator: "a", toJSON: undefined } as unknown;
    const hasB = { _locator: "b", toJSON: undefined } as unknown;
    // Force non-serializability: a circular reference yields a JSON.stringify
    // throw, exactly the case the hardened token guards.
    const circA: Record<string, unknown> = {};
    circA.self = circA;
    const circB: Record<string, unknown> = {};
    circB.self = circB;

    const selA = buildPageSelector("locator", [".x", { has: circA }], nextOccurrence);
    const selB = buildPageSelector("locator", [".x", { has: circB }], nextOccurrence);

    expect(selA).not.toBe(selB);
  });

  it("serializable args still render stably (string + plain options)", () => {
    const nextOccurrence = createOccurrenceCounter();
    const sel = buildPageSelector(
      "getByRole",
      ["button", { name: "Save" }],
      nextOccurrence,
    );
    expect(sel).toBe('page.getByRole(button,{"name":"Save"})');
  });

  it("a bare circular arg gets a distinguishing typeof#N token, never an empty collapse", () => {
    const nextOccurrence = createOccurrenceCounter();
    const circ: Record<string, unknown> = {};
    circ.self = circ;
    const sel = buildPageSelector("locator", [circ], nextOccurrence);
    expect(sel).toMatch(/page\.locator\(<object#\d+>\)/);
  });
});
