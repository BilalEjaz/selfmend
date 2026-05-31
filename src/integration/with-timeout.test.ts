import { describe, it, expect } from "vitest";

import { withTimeout } from "./locator-proxy.js";

/** A stand-in for a Playwright Locator: a class instance, not a plain object. */
class FakeLocator {
  constructor(public readonly selector: string) {}
}

describe("withTimeout options-bag detection (WR-04)", () => {
  it("appends a fresh options bag when there are no args", () => {
    expect(withTimeout([], 1234)).toEqual([{ timeout: 1234 }]);
  });

  it("merges timeout into a trailing plain options object", () => {
    const out = withTimeout([{ force: true }], 1234);
    expect(out).toEqual([{ force: true, timeout: 1234 }]);
  });

  it("treats an Object.create(null) bag as plain options", () => {
    const bag = Object.assign(Object.create(null), { force: true });
    const out = withTimeout([bag], 1234) as Array<Record<string, unknown>>;
    expect(out).toHaveLength(1);
    expect(out[0]!.force).toBe(true);
    expect(out[0]!.timeout).toBe(1234);
  });

  it("does NOT corrupt a trailing Locator arg (dragTo target) — appends options instead", () => {
    // dragTo(target) — the last arg is a Locator (a class instance), NOT an
    // options bag. The old impl spread `{ ...target, timeout }`, destroying the
    // drag target. The Locator must pass through intact and a separate options
    // bag is appended.
    const target = new FakeLocator("#drop-zone");
    const out = withTimeout([target], 1234);
    expect(out[0]).toBe(target); // same reference, not a shallow-spread junk obj
    expect(out[1]).toEqual({ timeout: 1234 });
  });

  it("does NOT treat a trailing array (selectOption values) as options", () => {
    const values = ["a", "b"];
    const out = withTimeout([values], 1234);
    expect(out[0]).toBe(values);
    expect(out[1]).toEqual({ timeout: 1234 });
  });

  it("leaves a string last arg untouched and appends options (fill/press)", () => {
    const out = withTimeout(["hello"], 1234);
    expect(out).toEqual(["hello", { timeout: 1234 }]);
  });
});
