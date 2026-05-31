import { describe, it, expect } from "vitest";

import {
  wrapLocator,
  createStepCounter,
  describeArgs,
  type HealContext,
} from "./locator-proxy.js";
import { BaselineStore } from "../store/store.js";
import type { SelfmendConfig } from "../config/schema.js";

/**
 * A store that records every identity key it is asked to build, so we can prove
 * two distinct resolutions of the SAME selector string get DISTINCT baseline
 * keys (CR-01) rather than colliding on a hardcoded step 0.
 */
class RecordingStore extends BaselineStore {
  readonly keys: string[] = [];
  override identify(selector: string, testFile: string, step: number): string {
    const key = super.identify(selector, testFile, step);
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

function ctxWith(store: RecordingStore, nextStep: () => number): HealContext {
  return {
    page: {} as never,
    store,
    config,
    testInfo: { title: "t" } as never,
    testFile: "spec.ts",
    replayTimeoutMs: 5000,
    nextStep,
  };
}

describe("per-test step disambiguator (CR-01)", () => {
  it("createStepCounter yields a fresh monotonic sequence per counter", () => {
    const a = createStepCounter();
    const b = createStepCounter();
    expect(a()).toBe(0);
    expect(a()).toBe(1);
    expect(a()).toBe(2);
    // A second counter (a second test) starts its own sequence.
    expect(b()).toBe(0);
    expect(b()).toBe(1);
  });

  it("two SEPARATE wrapLocator calls with the SAME selector get DISTINCT keys", () => {
    // The BLOCKER: with a hardcoded step 0, two genuinely-different elements
    // addressed by the same selector string at different points in a test
    // collapse to one baseline key. A per-test monotonic step must keep them
    // distinct so the second element can never heal against the first's
    // fingerprint.
    const store = new RecordingStore();
    const next = createStepCounter();
    const ctx = ctxWith(store, next);

    wrapLocator(fakeLocator(), "page.locator(button)", ctx);
    wrapLocator(fakeLocator(), "page.locator(button)", ctx);

    expect(store.keys).toHaveLength(2);
    expect(store.keys[0]).not.toBe(store.keys[1]);
  });

  it("two DISTINCT non-serializable chain args yield DISTINCT selector tokens (LO-02)", () => {
    // The footgun (same class as CR-01): JSON.stringify throws on a
    // circular/non-serializable chain arg and describeArgs USED to collapse it
    // to "". Two genuinely-different chained refinements then share the SAME
    // chained-selector string -> the same baseline identity component -> a
    // heal could be matched against the wrong element's fingerprint. A
    // distinguishing token per non-serializable arg must keep them apart.
    const next = createStepCounter();

    const circA: Record<string, unknown> = {};
    circA.self = circA; // JSON.stringify throws
    const circB: Record<string, unknown> = {};
    circB.self = circB; // a DIFFERENT non-serializable value

    const tokenA = describeArgs([circA], next);
    const tokenB = describeArgs([circB], next);

    // Neither collapses to an empty string...
    expect(tokenA).not.toBe("");
    expect(tokenB).not.toBe("");
    // ...and two distinct non-serializable args do NOT collide.
    expect(tokenA).not.toBe(tokenB);
  });

  it("describeArgs stays stable for serializable args (no spurious churn)", () => {
    const next = createStepCounter();
    expect(describeArgs(["text"], next)).toBe("text");
    expect(describeArgs([{ hasText: "Save" }], next)).toBe('{"hasText":"Save"}');
  });

  it("a SINGLE wrapped locator reused across capture+heal keeps ONE stable key", () => {
    // The same Locator object (one factory call) used for both the capture
    // action and the later broken/heal action computes its key ONCE at
    // construction, so capture and heal correspond — this is the supported
    // capture->heal pattern and must NOT be split by the step counter.
    const store = new RecordingStore();
    const ctx = ctxWith(store, createStepCounter());

    wrapLocator(fakeLocator(), "page.locator(.btn-primary)", ctx);

    // Exactly one identify() call -> one key for this locator's whole lifetime.
    expect(store.keys).toHaveLength(1);
  });
});
