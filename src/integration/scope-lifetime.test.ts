import { describe, it, expect } from "vitest";

import { createScopeController } from "./wrap-page.js";

/**
 * The scope-lifetime controller (D-03/D-04/D-05/D-06) wraps the existing
 * per-content occurrence counter and decides, per locator creation, which
 * `(suite, test)` tuple keys the locator and when the counter resets. It is
 * Playwright-free: it is driven by a plain `scope()` source function and the
 * existing `createOccurrenceCounter`, so it unit-tests without a browser
 * (mirrors occurrence.test.ts).
 *
 * Contract (Claude's discretion mechanics per CONTEXT):
 *   const controller = createScopeController(scope?);
 *   const { suite, test, nextOccurrence } = controller.resolve();
 *   controller.reset(); // explicit reset (resetScope delegates here)
 *
 * `resolve()` is called ONCE per locator creation. It reads `scope()` LIVE at
 * that call, auto-resets the occurrence counter when the tuple differs from the
 * immediately-previous resolve(), and returns the current tuple plus the live
 * `nextOccurrence` to stamp the locator's content key.
 */
describe("scope-lifetime controller (D-03/D-04/D-05/D-06)", () => {
  it("same (suite,test) across creations increments occurrence normally (D-05)", () => {
    const controller = createScopeController(() => ({
      suite: "spec.ts",
      test: "caseA",
    }));

    const a = controller.resolve();
    const b = controller.resolve();
    const c = controller.resolve();

    // Identical to today's per-content count: 0,1,2 for a repeated key.
    expect(a.nextOccurrence("k")).toBe(0);
    expect(b.nextOccurrence("k")).toBe(1);
    expect(c.nextOccurrence("k")).toBe(2);
  });

  it("a changed (suite,test) tuple auto-resets the occurrence counter to 0 (D-05)", () => {
    let tuple = { suite: "spec.ts", test: "caseA" };
    const controller = createScopeController(() => tuple);

    const a = controller.resolve();
    expect(a.nextOccurrence("k")).toBe(0);
    expect(a.nextOccurrence("k")).toBe(1);

    // The scope source now reports a DIFFERENT test -> next resolve auto-resets.
    tuple = { suite: "spec.ts", test: "caseB" };
    const b = controller.resolve();
    expect(b.nextOccurrence("k")).toBe(0);
  });

  it("scope() is read LIVE per resolve(), not captured once (D-03)", () => {
    let tuple = { suite: "s", test: "one" };
    const controller = createScopeController(() => tuple);

    const first = controller.resolve();
    expect(first.suite).toBe("s");
    expect(first.test).toBe("one");

    // Mutate the scope source between two creations; the tuple reflects it.
    tuple = { suite: "s", test: "two" };
    const second = controller.resolve();
    expect(second.test).toBe("two");
  });

  it("no scope() defaults to coarse suite='' test='' with no auto-reset (D-04)", () => {
    const controller = createScopeController();

    const a = controller.resolve();
    expect(a.suite).toBe("");
    expect(a.test).toBe("");

    // One coarse scope for the whole page: the counter never auto-resets, so a
    // repeated key keeps incrementing across creations.
    expect(a.nextOccurrence("k")).toBe(0);
    const b = controller.resolve();
    expect(b.nextOccurrence("k")).toBe(1);
  });

  it("explicit reset() forces the next occurrence back to 0 under an unchanged tuple (D-06)", () => {
    const controller = createScopeController(() => ({
      suite: "spec.ts",
      test: "caseA",
    }));

    const a = controller.resolve();
    expect(a.nextOccurrence("k")).toBe(0);
    expect(a.nextOccurrence("k")).toBe(1);

    // A same-scope retry: the tuple is unchanged so auto-reset cannot see it;
    // the explicit reset (what resetScope delegates to) forces a fresh counter.
    controller.reset();
    const b = controller.resolve();
    expect(b.nextOccurrence("k")).toBe(0);
  });

  it("a throwing scope() fails safe to the coarse default, never crashes (T-05-02)", () => {
    const controller = createScopeController(() => {
      throw new Error("user scope() blew up");
    });

    // Must not throw; falls back to the coarse default tuple.
    const a = controller.resolve();
    expect(a.suite).toBe("");
    expect(a.test).toBe("");
    expect(a.nextOccurrence("k")).toBe(0);
  });

  it("preserves per-content occurrence semantics (distinct keys independent, Pitfall 3)", () => {
    const controller = createScopeController(() => ({ suite: "s", test: "t" }));

    // Within one stable tuple, an inserted unrelated key must not shift another
    // key's indices (the existing createOccurrenceCounter guarantee survives).
    expect(controller.resolve().nextOccurrence("X")).toBe(0);
    expect(controller.resolve().nextOccurrence("Y")).toBe(0);
    expect(controller.resolve().nextOccurrence("X")).toBe(1);
  });
});
