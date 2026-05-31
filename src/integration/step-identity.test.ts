import { describe, it, expect } from "vitest";

import {
  wrapLocator,
  createStepCounter,
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
