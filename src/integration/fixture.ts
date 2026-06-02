import { test as base } from "@playwright/test";

import { defaultConfig } from "../config/defaults.js";
import type { SelfmendConfig } from "../config/schema.js";
import { BaselineStore } from "../store/store.js";
import {
  loadBaseline,
  writeShard,
  shardPath,
} from "../store/persistence.js";
import { describeArgs } from "./locator-proxy.js";
import {
  attachHealEvent,
  attachRefusedEvent,
  type SelfmendEvent,
} from "./events.js";
import { wrapPage } from "./wrap-page.js";

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

/**
 * Locator-factory methods on `page` that must return wrapped Locators. Shared
 * with the public {@link import("./wrap-page.js").wrapPage} so the
 * `@playwright/test` fixture and the runner-agnostic core wrap the exact same
 * factory surface (one source of truth, WRAP-04).
 */
export const PAGE_LOCATOR_FACTORIES = new Set<string>([
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
 * Build the store-key selector string for a page-factory call (IN-02). Uses the
 * SINGLE hardened {@link describeArgs} shared with the locator proxy — NOT a
 * weaker local copy — so a non-serializable factory arg (a circular object, a
 * `Locator` passed as `{ has }`, a `RegExp`) folds in a distinguishing
 * `<typeof#N>` token instead of collapsing to `""`. That keeps two genuinely
 * different factory calls on distinct baseline keys and closes the LO-02/CR-01
 * collision class on the fixture path. `nextOccurrence` is the per-test counter
 * threaded from the page fixture so the distinguishing tokens are deterministic
 * within a test. Exported for unit testing.
 */
export function buildPageSelector(
  prop: string,
  args: unknown[],
  nextOccurrence: (contentKey: string) => number,
): string {
  return `page.${prop}(${describeArgs(args, nextOccurrence)})`;
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

  // Worker-scoped store (CAP-02 load half + CAP-03 capture half, D-11):
  //  - SETUP: load the committed baseline.json read-only so this worker's
  //    in-memory store is seeded with prior-run fingerprints; a locator broken
  //    THIS run can heal against run N-1's capture loaded from the committed
  //    file alone (CAP-02). A missing/bad file loads as EMPTY (never throws).
  //  - TEARDOWN (code after `use`, runs at worker end): flush this worker's
  //    captures + seen-keys to its OWN shard named by `parallelIndex` — bounded,
  //    unique among concurrently-running workers, and overwritten by a restart
  //    of the same parallelIndex (RESEARCH Pattern 2). Workers NEVER write
  //    baseline.json — only their shard (the CAP-03 anti-pattern is avoided);
  //    the single committed write happens once in the reporter's onEnd.
  // `rootDir` anchors the store; the SELFMEND_STORE_DIR override (resolved
  // inside persistence.ts under rootDir) lets the parallel/prune/persist specs
  // redirect to a temp dir so they never touch the repo's real .selfmend.
  selfmendStore: [
    async ({}, use, workerInfo) => {
      const rootDir = workerInfo.config.rootDir;
      const store = await loadBaseline(rootDir);
      await use(store);
      // Worker teardown: lock-free per-worker shard flush.
      await writeShard(
        shardPath(rootDir, workerInfo.parallelIndex),
        store.toShard(),
      );
    },
    { scope: "worker" },
  ],

  // Override the built-in page: return the BARE wrapped page from the shared
  // runner-agnostic core (WRAP-04). The fixture is now ONE THIN ADAPTER over the
  // public `wrapPage` — a single code path, no parallel proxy/heal copy — that
  // supplies the two @playwright/test-specific seams:
  //
  //   - `scope` maps the live identity to (suite = testInfo.file, test =
  //     file-rooted titlePath), EXACTLY as the pre-refactor testFile/testTitle,
  //     so the store keys `suite :: test :: selector :: occurrence` are
  //     BYTE-IDENTICAL and committed baselines keep matching (D-09).
  //   - `onHeal` (the core's emit sink) maps each SelfmendEvent back onto the
  //     EXISTING testInfo.attach transport (attachHealEvent / attachRefusedEvent
  //     keyed on `event.kind`), so the `selfmend-heal` attachment name and bodies
  //     stay byte-identical (D-08). A missing kind is a healed event (back-compat).
  //
  // The core's own `wrapPage` builds the per-test occurrence counter, the
  // auto-resetting scope-lifetime controller, and the locator-proxy heal loop;
  // the fixture no longer owns any of that (WRAP-04 single source of truth).
  page: async ({ page, selfmendConfig, selfmendStore }, use, testInfo) => {
    const emit = async (event: SelfmendEvent): Promise<void> => {
      if (event.kind === "refused") {
        await attachRefusedEvent(testInfo, event);
      } else {
        await attachHealEvent(testInfo, event);
      }
    };
    const wrapped = wrapPage(page, {
      store: selfmendStore,
      config: selfmendConfig,
      onHeal: emit,
      // D-09 adapter mapping: suite = testInfo.file, test = file-rooted title,
      // read LIVE per locator creation (constant within one test) — EXACTLY the
      // old testFile/testTitle so committed baselines and keys are byte-identical.
      scope: () => ({
        suite: testInfo.file,
        test: testInfo.titlePath.join(" > "),
      }),
      // Bounded replay budget: cap so a flaky heal target cannot balloon the
      // per-action wall-clock (FINDINGS (b)). Mirror the configured action
      // timeout, falling back to a safe fixed cap — identical to before.
      replayTimeoutMs:
        testInfo.timeout > 0 ? Math.min(testInfo.timeout, 5000) : 5000,
    });
    await use(wrapped);
  },
});
