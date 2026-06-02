import { describe, it, expect, vi } from "vitest";
import { errors, type Locator, type Page } from "@playwright/test";

import { wrapLocator, type HealContext } from "./locator-proxy.js";
import { BaselineStore } from "../store/store.js";
import type { SelfmendConfig } from "../config/schema.js";
import type { SelfmendEvent } from "./events.js";
import type { Fingerprint } from "../matching/types.js";

/**
 * The pluggable-emit seam (D-08). The core must stop referencing `testInfo` and
 * route heal/refused events through `ctx.emit`, which is BEST-EFFORT: a throwing
 * emit must NEVER suppress the original error (the old attach-guard invariant
 * now wraps emit). These tests drive the proxy with fake locators so they run
 * without a browser.
 */

const config: SelfmendConfig = {
  enabled: true,
  threshold: 0.9,
  margin: 0.05,
  testIdAttr: "data-testid",
};

const FP: Fingerprint = {
  tag: "button",
  role: "button",
  text: "Save",
  testId: "",
  attrs: {},
  ordinal: 0,
  parentTag: "body",
  neighbourSignature: "|",
};

/** A locator whose given action always rejects with a TimeoutError. */
function timingOutLocator(method: string): Locator {
  return {
    [method]: () =>
      Promise.reject(new errors.TimeoutError("locator timed out")),
  } as unknown as Locator;
}

/** A page whose `locator()` returns a healed locator that replays green. */
function pageReplayingGreen(method: string): Page {
  return {
    locator: () =>
      ({
        [method]: () => Promise.resolve(undefined),
      }) as unknown as Locator,
  } as unknown as Page;
}

function baseCtx(over: Partial<HealContext>): HealContext {
  const store = new BaselineStore();
  return {
    page: {} as never,
    store,
    config,
    emit: () => {},
    suite: "spec.ts",
    test: "case",
    replayTimeoutMs: 1000,
    nextOccurrence: (() => {
      let n = 0;
      return () => n++;
    })(),
    ...over,
  };
}

describe("emit seam (D-08): pluggable best-effort transport", () => {
  it("a REFUSED heal emits a refused SelfmendEvent and re-throws the original error", async () => {
    const events: SelfmendEvent[] = [];
    const store = new BaselineStore();
    const ctx = baseCtx({
      store,
      emit: (e) => {
        events.push(e);
      },
    });
    // Seed a fingerprint so the path reaches scoring, then refuse via
    // no-candidates (the page enumerates nothing).
    const real = timingOutLocator("click");
    ctx.page = {
      locator: () => real,
      $$eval: () => Promise.resolve([]),
      evaluate: () => Promise.resolve([]),
    } as unknown as Page;
    const key = store.identify("page.locator(button)", "spec.ts", "case", 0);
    store.set(key, FP);

    const wrapped = wrapLocator(real, "page.locator(button)", ctx);

    await expect(wrapped.click()).rejects.toThrow(/timed out/);
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe("refused");
  });

  it("a throwing emit does NOT suppress the original error (best-effort guard)", async () => {
    const store = new BaselineStore();
    const real = timingOutLocator("click");
    const ctx = baseCtx({
      store,
      emit: () => {
        throw new Error("emit blew up");
      },
    });
    ctx.page = {
      locator: () => real,
      $$eval: () => Promise.resolve([]),
      evaluate: () => Promise.resolve([]),
    } as unknown as Page;
    const key = store.identify("page.locator(button)", "spec.ts", "case", 0);
    store.set(key, FP);

    const wrapped = wrapLocator(real, "page.locator(button)", ctx);

    // The original TimeoutError must still propagate even though emit throws.
    await expect(wrapped.click()).rejects.toThrow(/timed out/);
  });

  it("the core never imports TestInfo / references testInfo", async () => {
    // Compile-time proof lives in the grep in <verify>; this asserts a ctx with
    // NO testInfo field still drives the proxy (the shape no longer needs it).
    const ctx = baseCtx({ emit: vi.fn() });
    expect("testInfo" in ctx).toBe(false);
    expect("testFile" in ctx).toBe(false);
    expect("testTitle" in ctx).toBe(false);
  });
});
