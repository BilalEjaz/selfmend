import { describe, it, expect } from "vitest";

import {
  createOccurrenceCounter,
  wrapLocator,
  type HealContext,
} from "./locator-proxy.js";
import { BaselineStore } from "../store/store.js";
import type { SelfmendConfig } from "../config/schema.js";

/**
 * A store that records every identity key it is asked to build, so we can prove
 * the occurrence-based key (D-04/D-05) is distinct per occurrence and STABLE
 * between a capture run and a later broken-heal run.
 *
 * Migrated to the Phase-5 HealContext (emit + suite/test scope source instead
 * of testInfo/testFile/testTitle): with `suite`/`test` mapped to the OLD
 * testFile/testTitle values, the recorded keys must be BYTE-IDENTICAL (D-09).
 */
class RecordingStore extends BaselineStore {
  readonly keys: string[] = [];
  override identify(
    selector: string,
    testFile: string,
    testTitle: string,
    occurrence: number,
  ): string {
    const key = super.identify(selector, testFile, testTitle, occurrence);
    this.keys.push(key);
    return key;
  }
}

const config: SelfmendConfig = {
  enabled: true,
  threshold: 0.9,
  margin: 0.05,
  testIdAttr: "data-testid",
};

/** A throwaway Locator stand-in — wrapLocator only needs an object to proxy. */
function fakeLocator(): import("@playwright/test").Locator {
  return {} as import("@playwright/test").Locator;
}

function ctxWith(
  store: RecordingStore,
  nextOccurrence: (contentKey: string) => number,
  test = "suite > case",
): HealContext {
  return {
    page: {} as never,
    store,
    config,
    // Phase-5 seam: emit replaces testInfo; suite/test replace testFile/testTitle.
    emit: () => {},
    suite: "spec.ts",
    test,
    replayTimeoutMs: 5000,
    nextOccurrence,
  };
}

describe("occurrence-based identity key (D-04/D-05)", () => {
  it("createOccurrenceCounter is per-content and per-counter (reset per test)", () => {
    const a = createOccurrenceCounter();
    const b = createOccurrenceCounter();

    expect(a("x")).toBe(0);
    expect(a("x")).toBe(1);
    expect(a("x")).toBe(2);
    // A DIFFERENT content key has its own independent sequence.
    expect(a("y")).toBe(0);
    // A second counter (a second test) restarts every content key at 0.
    expect(b("x")).toBe(0);
  });

  it("two uses of the SAME (file,title,selector) get occurrence 0 then 1 (distinct keys)", () => {
    // Replaces the CR-01 step proof: distinct elements addressed by the same
    // selector at different points in a test must NOT collide on one baseline.
    const store = new RecordingStore();
    const ctx = ctxWith(store, createOccurrenceCounter());

    wrapLocator(fakeLocator(), "page.locator(button)", ctx);
    wrapLocator(fakeLocator(), "page.locator(button)", ctx);

    expect(store.keys).toHaveLength(2);
    expect(store.keys[0]).not.toBe(store.keys[1]);
    expect(store.keys[0]).toContain(" 0");
    expect(store.keys[1]).toContain(" 1");
  });

  it("byte-identical keys: suite/test map to the old testFile/testTitle (D-09)", () => {
    // The cross-run key format must stay `suite :: test :: selector ::
    // occurrence` byte-identical to the pre-refactor `testFile :: testTitle ::
    // selector :: occurrence` so committed baselines keep matching (WRAP-04).
    const store = new RecordingStore();
    const ctx = ctxWith(store, createOccurrenceCounter(), "suite > case");
    wrapLocator(fakeLocator(), "page.locator(button)", ctx);

    expect(store.keys[0]).toBe("spec.ts suite > case page.locator(button) 0");
  });

  it("the key sequence is IDENTICAL whether or not any element resolves (D-05, Pitfall 4)", () => {
    // The occurrence index is computed at wrapLocator CREATION time from content
    // identity only, so a capture run and a later broken-heal run that create
    // the SAME sequence of locators derive the SAME key sequence — even though
    // on the broken run the elements are absent. We drive this by computing keys
    // without resolving anything (wrapLocator never calls an action here).
    const captureStore = new RecordingStore();
    const captureCtx = ctxWith(captureStore, createOccurrenceCounter());
    wrapLocator(fakeLocator(), "page.locator(button)", captureCtx);
    wrapLocator(fakeLocator(), "page.locator(.menu)", captureCtx);
    wrapLocator(fakeLocator(), "page.locator(button)", captureCtx);

    // A fresh "broken run": same creation sequence, brand-new counter + store.
    const healStore = new RecordingStore();
    const healCtx = ctxWith(healStore, createOccurrenceCounter());
    wrapLocator(fakeLocator(), "page.locator(button)", healCtx);
    wrapLocator(fakeLocator(), "page.locator(.menu)", healCtx);
    wrapLocator(fakeLocator(), "page.locator(button)", healCtx);

    expect(healStore.keys).toEqual(captureStore.keys);
  });

  it("an unrelated inserted locator does NOT shift a selector's occurrence indices (Pitfall 3)", () => {
    // Per-(content) counter, NOT per-run-position: inserting selector Y between
    // two uses of X must leave X's occurrence indices (0 then 1) unchanged.
    const baseline = new RecordingStore();
    const baseCtx = ctxWith(baseline, createOccurrenceCounter());
    wrapLocator(fakeLocator(), "page.locator(X)", baseCtx);
    wrapLocator(fakeLocator(), "page.locator(X)", baseCtx);
    const xKeysBaseline = baseline.keys.filter((k) => k.includes("(X)"));

    const withInsert = new RecordingStore();
    const insCtx = ctxWith(withInsert, createOccurrenceCounter());
    wrapLocator(fakeLocator(), "page.locator(X)", insCtx);
    wrapLocator(fakeLocator(), "page.locator(Y)", insCtx); // unrelated insertion
    wrapLocator(fakeLocator(), "page.locator(X)", insCtx);
    const xKeysWithInsert = withInsert.keys.filter((k) => k.includes("(X)"));

    expect(xKeysWithInsert).toEqual(xKeysBaseline);
  });

  it("a different test title yields a different key for the same selector+occurrence (D-04)", () => {
    const store = new RecordingStore();
    wrapLocator(
      fakeLocator(),
      "page.locator(button)",
      ctxWith(store, createOccurrenceCounter(), "suite > caseA"),
    );
    wrapLocator(
      fakeLocator(),
      "page.locator(button)",
      ctxWith(store, createOccurrenceCounter(), "suite > caseB"),
    );
    expect(store.keys[0]).not.toBe(store.keys[1]);
  });
});
