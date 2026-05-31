import { errors, type Locator, type Page, type TestInfo } from "@playwright/test";

import type { SelfmendConfig } from "../config/schema.js";
import { captureFingerprint } from "../fingerprint/capture.js";
import { findCandidates } from "../matching/candidate-finder.js";
import { decide } from "../matching/decision.js";
import { score } from "../matching/scoring.js";
import type { ScoredCandidate } from "../matching/types.js";
import type { BaselineStore } from "../store/store.js";
import { attachHealEvent } from "./events.js";

/**
 * The Locator Proxy heal loop (HEAL-01, HEAL-02, INST-02).
 *
 * `wrapLocator` returns a `Proxy` over the REAL Locator (never an empty `{}` —
 * that is the `playwright-selfheal@1.0.9` mistake that loses the Locator API and
 * breaks chaining). The `get` trap partitions methods exactly as locked in
 * `spike/FINDINGS.md`:
 *
 *  - ACTION methods run the real action to its real timeout, then on a genuine
 *    `errors.TimeoutError` run the pure scorer + decision and, only above the
 *    conservative floor, rebind via a fresh `page.locator(newSelector)` and
 *    replay (HEAL-01). On success they capture a fingerprint (CAP-01, deduped).
 *  - CHAIN methods call the real method and RE-WRAP the returned Locator so
 *    healing survives chaining (INST-02).
 *  - Everything else (properties, `page()`, `count`, `evaluate`, ...) and the
 *    assertion machinery (`expect(locator)` routes through matchers, not these
 *    action methods) passes straight through — assertions stay sacred by
 *    construction (FINDINGS (c) / PROOF 3).
 *
 * The heal NEVER fires on a transient poll miss: it only runs after the real
 * action's `TimeoutError`, which by definition fires after Playwright auto-wait
 * exhausts (HEAL-02 / D-10). It NEVER false-greens: no stored fingerprint, no
 * candidate, or a below-floor best all re-throw the ORIGINAL error so the test
 * fails normally (D-09 / Pitfall 2).
 */

/** Methods that trigger capture-on-success / heal-on-TimeoutError. */
const ACTION = new Set<string>([
  "click",
  "fill",
  "type",
  "press",
  "hover",
  "check",
  "uncheck",
  "dblclick",
  "tap",
  "selectOption",
  "setInputFiles",
  "focus",
  "blur",
  "dragTo",
  "scrollIntoViewIfNeeded",
  "waitFor",
]);

/** Methods that return a new Locator and must be re-wrapped to keep healing. */
const CHAIN = new Set<string>([
  "first",
  "last",
  "nth",
  "filter",
  "and",
  "or",
  "locator",
  "getByRole",
  "getByText",
  "getByLabel",
  "getByTestId",
  "getByPlaceholder",
  "getByAltText",
  "getByTitle",
]);

/**
 * Everything the heal path needs, injected once by the fixture (plan 03) and
 * threaded through every wrapped locator in a test.
 */
export interface HealContext {
  /** The real (unwrapped) page, used to rebind: `page.locator(newSelector)`. */
  page: Page;
  /** Per-worker in-process baseline store. */
  store: BaselineStore;
  /** Resolved, on-by-default config (enabled, threshold, testIdAttr). */
  config: SelfmendConfig;
  /** Active test info, for the worker -> main heal-event attachment. */
  testInfo: TestInfo;
  /** Stable test-file identity component for the store key. */
  testFile: string;
  /**
   * Bounded replay budget (ms). The real attempt keeps the user's configured
   * timeout (do not shorten auto-wait semantics); the replay is capped so a
   * flaky heal target cannot balloon the per-action wall-clock (FINDINGS (b)).
   */
  replayTimeoutMs: number;
}

/** Detect a genuine post-auto-wait resolution timeout (FINDINGS (a) idiom). */
function isTimeoutError(err: unknown): boolean {
  return (
    err instanceof errors.TimeoutError ||
    (err as { name?: string } | null)?.name === "TimeoutError"
  );
}

/**
 * True only for a PLAIN options object — an object literal (`{ ... }`) or a
 * null-prototype bag. Class instances (a Playwright `Locator`, `ElementHandle`,
 * `RegExp`, `Date`, ...) and arrays are explicitly excluded: a trailing
 * `Locator` (e.g. `dragTo(target)`) must NOT be mistaken for an options bag and
 * shallow-spread into a junk object (WR-04).
 */
function isPlainOptions(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * If the last positional argument is a PLAIN options object, return a shallow
 * clone with `timeout` overridden; otherwise append a fresh `{ timeout }`. Used
 * to cap the REPLAY only (the real attempt is left untouched).
 *
 * Non-plain final args (a `Locator` target for `dragTo`, an array of values for
 * `selectOption`, a string for `fill`/`press`) pass through untouched and the
 * options bag is appended after them.
 *
 * Exported for unit testing (WR-04).
 */
export function withTimeout(args: unknown[], timeout: number): unknown[] {
  const last = args[args.length - 1];
  if (isPlainOptions(last)) {
    return [...args.slice(0, -1), { ...last, timeout }];
  }
  return [...args, { timeout }];
}

/**
 * Wrap a real Locator so its actions capture-on-success and heal-on-timeout,
 * and its chaining methods stay healing-aware.
 *
 * @param realLocator The genuine Playwright Locator to wrap.
 * @param selector The selector string this locator was built from (store key).
 * @param ctx The shared heal context.
 */
export function wrapLocator(
  realLocator: Locator,
  selector: string,
  ctx: HealContext,
): Locator {
  // Monotonic step within this locator's identity, so the same selector used
  // at different steps keeps distinct baselines.
  const key = ctx.store.identify(selector, ctx.testFile, 0);

  return new Proxy(realLocator, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown;
      if (typeof value !== "function") return value;

      if (typeof prop === "string" && ACTION.has(prop)) {
        return (...args: unknown[]) =>
          actionOrHeal(target, selector, key, prop, args, ctx);
      }

      if (typeof prop === "string" && CHAIN.has(prop)) {
        return (...args: unknown[]) => {
          const next = (value as (...a: unknown[]) => Locator).apply(
            target,
            args,
          );
          // Re-wrap with a selector that records the chained refinement, so the
          // baseline key stays distinct from the parent locator's.
          const chainedSelector = `${selector} >> ${prop}(${describeArgs(args)})`;
          return wrapLocator(next, chainedSelector, ctx);
        };
      }

      // Passthrough: properties, page(), count, evaluate, and (critically) the
      // surface the assertion matchers read. Bind so `this` stays the real
      // Locator.
      return (value as (...a: unknown[]) => unknown).bind(target);
    },
  });
}

/** Compact, side-effect-free description of chain args for the store key. */
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
 * Run a single action method against the real Locator; on a real TimeoutError,
 * run the pure heal decision and (only above the floor) rebind + replay.
 */
async function actionOrHeal(
  real: Locator,
  selector: string,
  key: string,
  method: string,
  args: unknown[],
  ctx: HealContext,
): Promise<unknown> {
  const invoke = real[method as keyof Locator] as (
    ...a: unknown[]
  ) => Promise<unknown>;

  try {
    // Real attempt: keep the user's configured timeout (auto-wait semantics).
    const result = await invoke.apply(real, args);
    // Green path: capture once per key per run (dedup-guarded).
    if (ctx.config.enabled && !ctx.store.has(key)) {
      try {
        const fp = await captureFingerprint(real, ctx.config.testIdAttr);
        ctx.store.set(key, fp);
      } catch {
        // Capture is best-effort; never fail a passing action because the
        // fingerprint round-trip hiccuped.
      }
    }
    return result;
  } catch (err) {
    if (!isTimeoutError(err)) throw err; // not a resolution failure -> propagate
    if (!ctx.config.enabled) throw err; // healing disabled (CFG-01) -> fail normally

    const fingerprint = ctx.store.get(key);
    if (!fingerprint) throw err; // never heal an unseen locator (no false green)

    const candidates = await findCandidates(
      ctx.page,
      fingerprint,
      ctx.config.testIdAttr,
    );
    const scored: ScoredCandidate[] = candidates.map((candidate) => ({
      candidate,
      score: score(fingerprint, candidate),
    }));

    const decision = decide(scored, ctx.config.threshold);
    if (!decision.heal) throw err; // below floor / no candidate -> re-throw original

    await attachHealEvent(ctx.testInfo, {
      testName: ctx.testInfo.title,
      originalSelector: selector,
      healedTarget: decision.newSelector,
      score: decision.event.score,
    });

    // Rebind = FRESH page.locator(newSelector) (cannot reuse an ElementHandle,
    // issue #10571). Replay the SAME action with a bounded replay budget.
    const healed = ctx.page.locator(decision.newSelector);
    const replayInvoke = healed[method as keyof Locator] as (
      ...a: unknown[]
    ) => Promise<unknown>;
    return replayInvoke.apply(healed, withTimeout(args, ctx.replayTimeoutMs));
  }
}
