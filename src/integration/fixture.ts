import { test as base, type Page, type Locator } from "@playwright/test";

import { defaultConfig } from "../config/defaults.js";
import type { SelfmendConfig } from "../config/schema.js";
import { BaselineStore } from "../store/store.js";
import {
  wrapLocator,
  createStepCounter,
  type HealContext,
} from "./locator-proxy.js";

/**
 * The page-override healing fixture (INST-02, D-03, D-04, D-08).
 *
 * `healingFixture` is a `test.extend` mixin that:
 *  - injects a worker-scoped {@link SelfmendConfig} (defaults from
 *    `defaultConfig`, on-by-default per D-08) overridable per project via
 *    `test.use({ selfmendConfig })`;
 *  - injects a per-worker {@link BaselineStore} (single-worker Phase 1);
 *  - OVERRIDES the built-in `page` fixture to return a `Proxy(page)` whose
 *    locator-factory methods (`locator`, `getByRole`, ...) return
 *    `wrapLocator`-wrapped Locators, so existing `page`/locator usage keeps
 *    working unchanged while every resolved locator becomes healing-aware.
 *
 * Exported as a COMPOSABLE fixture (D-04): teams with their own `test.extend`
 * can merge `healingFixture` into their fixtures. The bare re-exported `test`
 * and public entry point are wired in plan 05.
 */

/** Locator-factory methods on `page` that must return wrapped Locators. */
const PAGE_LOCATOR_FACTORIES = new Set<string>([
  "locator",
  "getByRole",
  "getByText",
  "getByLabel",
  "getByPlaceholder",
  "getByAltText",
  "getByTitle",
  "getByTestId",
]);

/** Worker-scoped fixtures + options contributed by selfmend. */
export interface SelfmendWorkerFixtures {
  /** Overridable resolved config (worker-scoped option). */
  selfmendConfig: SelfmendConfig;
  /** Per-worker in-process baseline store (worker-scoped). */
  selfmendStore: BaselineStore;
}

/**
 * Build a best-effort description of a factory call's arguments for the store
 * key, so distinct locators on a page get distinct baselines.
 */
function describeArgs(args: unknown[]): string {
  try {
    return args
      .map((a) => (typeof a === "string" ? a : JSON.stringify(a) ?? ""))
      .join(",");
  } catch {
    return "";
  }
}

/**
 * Wrap a real `page` so its locator-factory methods return healing-aware
 * Locators. Non-factory members pass straight through to the real page.
 */
function wrapPage(realPage: Page, makeCtx: () => HealContext): Page {
  return new Proxy(realPage, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown;
      if (typeof value !== "function") return value;

      if (typeof prop === "string" && PAGE_LOCATOR_FACTORIES.has(prop)) {
        return (...args: unknown[]): Locator => {
          const real = (value as (...a: unknown[]) => Locator).apply(
            target,
            args,
          );
          const selector = `page.${prop}(${describeArgs(args)})`;
          return wrapLocator(real, selector, makeCtx());
        };
      }

      return (value as (...a: unknown[]) => unknown).bind(target);
    },
  });
}

/**
 * The composable healing fixture. Merge into your own `test.extend`, or use the
 * `test` re-exported by the package entry (plan 05) for zero-config healing.
 */
export const healingFixture = base.extend<
  Record<never, never>,
  SelfmendWorkerFixtures
>({
  // Worker-scoped config option; override via test.use({ selfmendConfig }).
  selfmendConfig: [defaultConfig, { option: true, scope: "worker" }],

  // Worker-scoped store: one in-process baseline per worker (Phase 1).
  selfmendStore: [
    async ({}, use) => {
      await use(new BaselineStore());
    },
    { scope: "worker" },
  ],

  // Override the built-in page: return a Proxy whose locators heal.
  page: async ({ page, selfmendConfig, selfmendStore }, use, testInfo) => {
    // One monotonic step counter PER TEST (CR-01): shared across every wrapped
    // locator (and chained re-wrap) in this test so distinct factory calls of
    // the same selector string get distinct baseline keys.
    const nextStep = createStepCounter();
    const wrapped = wrapPage(page, () => ({
      page,
      store: selfmendStore,
      config: selfmendConfig,
      testInfo,
      testFile: testInfo.file,
      // Bounded replay budget: cap so a flaky heal target cannot balloon the
      // per-action wall-clock (FINDINGS (b)). Mirror the configured action
      // timeout, falling back to a safe fixed cap.
      replayTimeoutMs: testInfo.timeout > 0 ? Math.min(testInfo.timeout, 5000) : 5000,
      nextStep,
    }));
    await use(wrapped);
  },
});
