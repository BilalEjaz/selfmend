import { describe, it, expect } from "vitest";
import { errors, type Locator, type Page } from "@playwright/test";

import { wrapLocator, type HealContext } from "./locator-proxy.js";
import { BaselineStore } from "../store/store.js";
import type { SelfmendConfig } from "../config/schema.js";
import type { SelfmendEvent } from "./events.js";
import type { CandidateDescriptor, Fingerprint } from "../matching/types.js";

/**
 * OUT-01 confirming test: in RAW (non-reporter) mode, `onHeal` receives EVERY
 * heal event Phase 5 already wires through the emit seam. This is a CONFIRMING
 * test (not new production work): the locator proxy already calls `ctx.emit` on
 * both the healed arm (locator-proxy.ts:454) and the refused arm (:414), and
 * `wrapPage` builds `emit` from the fire-and-forget `onHeal`. Here we drive the
 * proxy directly with a recording `emit` (the same callback `wrapPage` hands it)
 * and assert:
 *
 *  - a HEALED event reaches onHeal, and
 *  - each of the THREE post-scoring refusal reasons (no-candidates, below-floor,
 *    ambiguous) reaches onHeal as a refused event.
 *
 * Documented intentional silence: an uncaptured locator (no stored fingerprint)
 * is re-thrown BEFORE scoring and is deliberately NOT delivered to onHeal
 * (events.ts:50-56). So "every could-not-heal" reads correctly as "every
 * post-scoring refusal", identical to fixture mode (the reporter never sees a
 * no-fingerprint event either, because none is attached). The last test below
 * asserts that silence explicitly.
 */

const config: SelfmendConfig = {
  enabled: true,
  threshold: 0.9,
  margin: 0.05,
  testIdAttr: "data-testid",
};

/** The stored fingerprint for the broken locator (what candidates score against). */
const FP: Fingerprint = {
  tag: "button",
  role: "button",
  text: "Save",
  testId: "save-btn",
  attrs: { name: "save", type: "submit" },
  ordinal: 0,
  parentTag: "form",
  neighbourSignature: "label|span",
};

/** A candidate identical to {@link FP} (a perfect match, scores at the ceiling). */
function perfectCandidate(uniqueSelector: string): CandidateDescriptor {
  return {
    tag: FP.tag,
    role: FP.role,
    text: FP.text,
    testId: FP.testId,
    attrs: { ...FP.attrs },
    ordinal: FP.ordinal,
    parentTag: FP.parentTag,
    neighbourSignature: FP.neighbourSignature,
    uniqueSelector,
  };
}

/**
 * A candidate maximally dissimilar to {@link FP} on every signal, so the pure
 * scorer puts it well under the 0.9 floor (the below-floor / genuinely-different
 * case). Robust to scorer weight details: a total mismatch is below floor by the
 * core trust invariant, independent of exact weights.
 */
function dissimilarCandidate(uniqueSelector: string): CandidateDescriptor {
  return {
    tag: "a",
    role: "link",
    text: "Totally unrelated link text here",
    testId: "",
    attrs: {},
    ordinal: 9,
    parentTag: "nav",
    neighbourSignature: "img|hr",
    uniqueSelector,
  };
}

/** A locator whose `click` always rejects with a TimeoutError (heal trigger). */
function timingOutLocator(): Locator {
  return {
    click: () => Promise.reject(new errors.TimeoutError("locator timed out")),
  } as unknown as Locator;
}

/**
 * Build a HealContext whose `page.evaluate` returns the given candidates and
 * whose `page.locator(sel)` replays GREEN (so a healed decision succeeds), with
 * the broken locator timing out to trigger the heal path. `emit` records every
 * delivered event, mirroring the fire-and-forget onHeal sink wrapPage builds.
 */
function ctxFor(
  candidates: CandidateDescriptor[],
  recorded: SelfmendEvent[],
  store: BaselineStore,
): { ctx: HealContext; broken: Locator } {
  const broken = timingOutLocator();
  const page = {
    // The heal path rebinds via page.locator(newSelector) and replays; resolve
    // green so a healed decision actually sticks.
    locator: () =>
      ({ click: () => Promise.resolve(undefined) }) as unknown as Locator,
    // findCandidates delegates to page.evaluate(fn, args); return the descriptors
    // directly so the REAL score() + decide() run on them.
    evaluate: () => Promise.resolve(candidates),
  } as unknown as Page;

  const ctx: HealContext = {
    page,
    store,
    config,
    emit: (e) => {
      recorded.push(e);
    },
    suite: "spec.ts",
    test: "a raw-mode case",
    replayTimeoutMs: 1000,
    captureTimeoutMs: 2000,
    nextOccurrence: (() => {
      let n = 0;
      return () => n++;
    })(),
  };
  return { ctx, broken };
}

const SELECTOR = "page.locator(button)";

/** Seed the stored fingerprint for SELECTOR so the heal path reaches scoring. */
function seed(store: BaselineStore): void {
  const key = store.identify(SELECTOR, "spec.ts", "a raw-mode case", 0);
  store.set(key, FP);
}

describe("onHeal receives every heal event in raw mode (OUT-01, confirming)", () => {
  it("delivers a HEALED event to onHeal when a candidate clears both gates", async () => {
    const recorded: SelfmendEvent[] = [];
    const store = new BaselineStore();
    seed(store);
    const { ctx, broken } = ctxFor(
      [perfectCandidate('[data-testid="save-btn"]')],
      recorded,
      store,
    );

    const wrapped = wrapLocator(broken, SELECTOR, ctx);
    await wrapped.click(); // heals and replays green

    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.kind).toBe("healed");
  });

  it("delivers a refused 'no-candidates' event to onHeal when enumeration is empty", async () => {
    const recorded: SelfmendEvent[] = [];
    const store = new BaselineStore();
    seed(store);
    const { ctx, broken } = ctxFor([], recorded, store);

    const wrapped = wrapLocator(broken, SELECTOR, ctx);
    await expect(wrapped.click()).rejects.toThrow(/timed out/);

    expect(recorded).toHaveLength(1);
    const event = recorded[0];
    expect(event?.kind).toBe("refused");
    if (event?.kind === "refused") {
      expect(event.reason).toBe("no-candidates");
      // no-candidates carries a null bestScore (nothing was scored).
      expect(event.bestScore).toBeNull();
    }
  });

  it("delivers a refused 'below-floor' event to onHeal for a genuinely-different best match", async () => {
    const recorded: SelfmendEvent[] = [];
    const store = new BaselineStore();
    seed(store);
    const { ctx, broken } = ctxFor(
      [dissimilarCandidate("a.unrelated")],
      recorded,
      store,
    );

    const wrapped = wrapLocator(broken, SELECTOR, ctx);
    await expect(wrapped.click()).rejects.toThrow(/timed out/);

    expect(recorded).toHaveLength(1);
    const event = recorded[0];
    expect(event?.kind).toBe("refused");
    if (event?.kind === "refused") {
      expect(event.reason).toBe("below-floor");
    }
  });

  it("delivers a refused 'ambiguous' event to onHeal for two look-alike duplicates", async () => {
    const recorded: SelfmendEvent[] = [];
    const store = new BaselineStore();
    seed(store);
    // Two identical perfect matches: both clear the floor but their gap is 0,
    // inside the 0.05 margin -> ambiguous (the look-alike / duplicate guard).
    const { ctx, broken } = ctxFor(
      [
        perfectCandidate('[data-testid="row-1"]'),
        perfectCandidate('[data-testid="row-2"]'),
      ],
      recorded,
      store,
    );

    const wrapped = wrapLocator(broken, SELECTOR, ctx);
    await expect(wrapped.click()).rejects.toThrow(/timed out/);

    expect(recorded).toHaveLength(1);
    const event = recorded[0];
    expect(event?.kind).toBe("refused");
    if (event?.kind === "refused") {
      expect(event.reason).toBe("ambiguous");
    }
  });

  it("stays SILENT at onHeal for an uncaptured locator (no-fingerprint), by design", async () => {
    // No stored fingerprint for this selector: the proxy re-throws the original
    // error BEFORE scoring and deliberately does NOT emit a refused event
    // (events.ts:50-56). This is the intentional noise-suppression that makes
    // raw mode identical to fixture mode (the reporter never sees one either).
    const recorded: SelfmendEvent[] = [];
    const store = new BaselineStore(); // intentionally NOT seeded
    const { ctx, broken } = ctxFor(
      [perfectCandidate('[data-testid="save-btn"]')],
      recorded,
      store,
    );

    const wrapped = wrapLocator(broken, SELECTOR, ctx);
    await expect(wrapped.click()).rejects.toThrow(/timed out/);

    // Nothing delivered to onHeal: a missing fingerprint is silent (the same as
    // fixture mode), so "every could-not-heal" means the three post-scoring
    // refusals, not "any failure".
    expect(recorded).toHaveLength(0);
  });
});
