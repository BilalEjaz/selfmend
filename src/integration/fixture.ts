import { test as base, type Page, type Locator } from "@playwright/test";

import { defaultConfig } from "../config/defaults.js";
import type { SelfmendConfig } from "../config/schema.js";
import { BaselineStore } from "../store/store.js";
import {
  loadBaseline,
  writeShard,
  shardPath,
} from "../store/persistence.js";
import {
  wrapLocator,
  createOccurrenceCounter,
  describeArgs,
  type HealContext,
} from "./locator-proxy.js";
import {
  attachHealEvent,
  attachRefusedEvent,
  type SelfmendEvent,
} from "./events.js";

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
 * Wrap a real `page` so its locator-factory methods return healing-aware
 * Locators. Non-factory members pass straight through to the real page. The
 * shared per-test `nextOccurrence` is threaded into the hardened arg
 * stringifier (IN-02) so non-serializable factory args stay collision-distinct.
 */
function wrapPage(
  realPage: Page,
  nextOccurrence: (contentKey: string) => number,
  makeCtx: () => HealContext,
): Page {
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
          const selector = buildPageSelector(prop, args, nextOccurrence);
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

  // Override the built-in page: return a Proxy whose locators heal.
  page: async ({ page, selfmendConfig, selfmendStore }, use, testInfo) => {
    // One per-content occurrence counter PER TEST (D-04/D-05): shared across
    // every wrapped locator (and chained re-wrap) in this test so distinct
    // factory calls of the same selector get distinct baseline keys, while the
    // index for the Nth use of a selector is identical on capture and heal runs.
    const nextOccurrence = createOccurrenceCounter();
    // File-rooted, stable test title (D-04). titlePath is [file, ...describes,
    // test] — joining it scopes the occurrence key to this exact test.
    const testTitle = testInfo.titlePath.join(" > ");
    // The @playwright/test adapter for the pluggable `emit` seam (D-08): map the
    // SelfmendEvent union back onto the EXISTING testInfo.attach transport, so
    // keys and attachments stay byte-identical to the pre-refactor proxy
    // (WRAP-04 zero behaviour change). `kind` discriminates the two arms; a
    // missing kind is a healed event (back-compat).
    const emit = async (event: SelfmendEvent): Promise<void> => {
      if (event.kind === "refused") {
        await attachRefusedEvent(testInfo, event);
      } else {
        await attachHealEvent(testInfo, event);
      }
    };
    const wrapped = wrapPage(page, nextOccurrence, () => ({
      page,
      store: selfmendStore,
      config: selfmendConfig,
      emit,
      // D-09 adapter mapping: suite = testInfo.file, test = file-rooted title,
      // EXACTLY as the old testFile/testTitle, so committed baselines match.
      suite: testInfo.file,
      test: testTitle,
      // Bounded replay budget: cap so a flaky heal target cannot balloon the
      // per-action wall-clock (FINDINGS (b)). Mirror the configured action
      // timeout, falling back to a safe fixed cap.
      replayTimeoutMs: testInfo.timeout > 0 ? Math.min(testInfo.timeout, 5000) : 5000,
      nextOccurrence,
    }));
    await use(wrapped);
  },
});
