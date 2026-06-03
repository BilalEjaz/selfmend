import { describe, it, expect } from "vitest";

import {
  wrapLocator,
  createOccurrenceCounter,
  describeArgs,
  type HealContext,
} from "./locator-proxy.js";
import { BaselineStore } from "../store/store.js";
import type { SelfmendConfig } from "../config/schema.js";

/**
 * A store that records every identity key it is asked to build, so we can prove
 * two distinct resolutions of the SAME selector string get DISTINCT baseline
 * keys (CR-01, now via the occurrence index) rather than colliding on a
 * hardcoded occurrence 0.
 *
 * Migrated to the Phase-5 HealContext (emit + suite/test scope source).
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
): HealContext {
  return {
    page: {} as never,
    store,
    config,
    emit: () => {},
    suite: "spec.ts",
    test: "t",
    replayTimeoutMs: 5000,
    captureTimeoutMs: 2000,
    nextOccurrence,
  };
}

describe("per-test occurrence disambiguator (CR-01, occurrence key)", () => {
  it("createOccurrenceCounter yields a fresh per-content sequence per counter", () => {
    const a = createOccurrenceCounter();
    const b = createOccurrenceCounter();
    expect(a("k")).toBe(0);
    expect(a("k")).toBe(1);
    expect(a("k")).toBe(2);
    // A second counter (a second test) starts its own sequence.
    expect(b("k")).toBe(0);
    expect(b("k")).toBe(1);
  });

  it("two SEPARATE wrapLocator calls with the SAME selector get DISTINCT keys", () => {
    // The BLOCKER: with a hardcoded occurrence 0, two genuinely-different
    // elements addressed by the same selector string at different points in a
    // test collapse to one baseline key. A per-(content) occurrence index must
    // keep them distinct so the second element can never heal against the
    // first's fingerprint.
    const store = new RecordingStore();
    const ctx = ctxWith(store, createOccurrenceCounter());

    wrapLocator(fakeLocator(), "page.locator(button)", ctx);
    wrapLocator(fakeLocator(), "page.locator(button)", ctx);

    expect(store.keys).toHaveLength(2);
    expect(store.keys[0]).not.toBe(store.keys[1]);
  });

  it("two DISTINCT non-serializable chain args yield DISTINCT selector tokens (LO-02)", () => {
    // The footgun (same class as CR-01): JSON.stringify throws on a
    // circular/non-serializable chain arg and describeArgs USED to collapse it
    // to "". Two genuinely-different chained refinements then share the SAME
    // chained-selector string -> the same baseline identity component -> a heal
    // could be matched against the wrong element's fingerprint. A distinguishing
    // token per non-serializable arg (a per-content occurrence index) must keep
    // them apart.
    const next = createOccurrenceCounter();

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
    const next = createOccurrenceCounter();
    expect(describeArgs(["text"], next)).toBe("text");
    expect(describeArgs([{ hasText: "Save" }], next)).toBe('{"hasText":"Save"}');
  });

  it("a SINGLE wrapped locator reused across capture+heal keeps ONE stable key", () => {
    // The same Locator object (one factory call) used for both the capture
    // action and the later broken/heal action computes its key ONCE at
    // construction, so capture and heal correspond — this is the supported
    // capture->heal pattern and must NOT be split by the occurrence counter.
    const store = new RecordingStore();
    const ctx = ctxWith(store, createOccurrenceCounter());

    wrapLocator(fakeLocator(), "page.locator(.btn-primary)", ctx);

    // Exactly one identify() call -> one key for this locator's whole lifetime.
    expect(store.keys).toHaveLength(1);
  });
});
