import type { Locator, Page } from "@playwright/test";

import { configSchema, type SelfmendConfig } from "../config/schema.js";
import type { BaselineStore } from "../store/store.js";
import {
  wrapLocator,
  type HealContext,
} from "./locator-proxy.js";
import { createOccurrenceCounter } from "./locator-proxy.js";
import type { SelfmendEvent } from "./events.js";
import { PAGE_LOCATOR_FACTORIES, buildPageSelector } from "./fixture.js";

/**
 * The runner-agnostic core entry (WRAP-01/02/03). This module owns the two
 * pure-ish mechanics that sit AROUND the unchanged healing engine:
 *
 *  1. {@link createScopeController} — the scope-lifetime controller. It reads a
 *     caller-supplied `scope()` LIVE per locator creation (D-03), keys under the
 *     coarse `{ suite: "", test: "" }` default when no scope is supplied (D-04),
 *     auto-resets the occurrence counter when `scope()`'s `(suite, test)` tuple
 *     differs from the immediately-previous call (D-05), and exposes an explicit
 *     `reset()` for same-scope retries that {@link resetScope} delegates to
 *     (D-06). It NEVER derives identity from the page URL.
 *
 *  2. {@link resolveConfig} — the config merge. A `Partial<SelfmendConfig>` is
 *     resolved over `defaultConfig` THROUGH `configSchema` so other keys default
 *     and out-of-range values are rejected with the schema's readable error
 *     (T-05-03 / ASVS V5 input validation).
 *
 * Both are Playwright/Locator-free so they unit-test without a browser (driven
 * by a plain scope-source function + the existing `createOccurrenceCounter`).
 */

/** The `(suite, test)` identity tuple feeding the cross-run content key. */
export interface Scope {
  /** Maps to the store key's `testFile` component (suite-level identity). */
  suite: string;
  /** Maps to the store key's `testTitle` component (test-level identity). */
  test: string;
}

/** A caller-supplied identity source, read LIVE at each locator creation. */
export type ScopeSource = () => Scope;

/** The coarse no-scope default (D-04): one scope for the whole page. */
const COARSE_SCOPE: Scope = { suite: "", test: "" };

/**
 * What a single locator creation resolves to: the live `(suite, test)` tuple
 * plus the occurrence counter to stamp this locator's content key. The counter
 * is the SAME instance across creations under one stable tuple (so a repeated
 * selector increments 0,1,2 — today's per-content semantics), and a fresh
 * instance after an auto- or explicit reset.
 */
export interface ResolvedScope extends Scope {
  /** The live per-content occurrence source for this creation (D-04/D-05). */
  nextOccurrence: (contentKey: string) => number;
}

/** The scope-lifetime controller `wrapPage` builds per wrapped page. */
export interface ScopeController {
  /**
   * Resolve the scope for ONE locator creation: read `scope()` live, auto-reset
   * the counter on a tuple change, and return the current tuple + live counter.
   */
  resolve: () => ResolvedScope;
  /**
   * Force an occurrence-counter reset for a same-scope retry (D-06). The next
   * `resolve()` under the unchanged tuple restarts every content key at 0.
   */
  reset: () => void;
}

/**
 * Read the caller's `scope()` defensively (T-05-02): a throwing `scope()` must
 * NEVER crash the locator factory — fall back to the coarse default tuple. A
 * coarse/wrong key is a MISSED heal, never a wrong heal (D-04/D-11), so failing
 * safe here cannot produce a false green.
 */
function readScope(scope: ScopeSource | undefined): Scope {
  if (!scope) return COARSE_SCOPE;
  try {
    const s = scope();
    return { suite: s.suite, test: s.test };
  } catch {
    return COARSE_SCOPE;
  }
}

/**
 * Build a scope-lifetime controller around the existing
 * {@link createOccurrenceCounter}. Tracks the last-seen `(suite, test)` tuple
 * and rebuilds the counter whenever the current tuple differs (D-05) or an
 * explicit {@link ScopeController.reset} is requested (D-06). With no `scope`
 * the tuple is always the coarse default, so the counter never auto-resets
 * (D-04). The tuple is read LIVE per `resolve()` (D-03), never from a URL.
 */
export function createScopeController(scope?: ScopeSource): ScopeController {
  let counter = createOccurrenceCounter();
  // `null` until the first resolve(), so the first creation never spuriously
  // "changes" tuple (the first call simply establishes the baseline tuple).
  let lastTuple: Scope | null = null;

  function resolve(): ResolvedScope {
    const current = readScope(scope);
    if (
      lastTuple !== null &&
      (lastTuple.suite !== current.suite || lastTuple.test !== current.test)
    ) {
      // Tuple changed since the previous creation -> fresh counter (D-05).
      counter = createOccurrenceCounter();
    }
    lastTuple = current;
    return {
      suite: current.suite,
      test: current.test,
      nextOccurrence: (contentKey: string) => counter(contentKey),
    };
  }

  function reset(): void {
    counter = createOccurrenceCounter();
  }

  return { resolve, reset };
}

/**
 * Resolve a caller-supplied partial config over the defaults THROUGH the schema
 * (T-05-03). Spreading the partial over `defaultConfig` then re-parsing means an
 * empty/absent partial yields exactly `defaultConfig` and any out-of-range or
 * wrong-typed value is rejected with `configSchema`'s readable error — no silent
 * coercion across the user-config trust boundary.
 */
export function resolveConfig(
  partial?: Partial<SelfmendConfig>,
): SelfmendConfig {
  return configSchema.parse({ ...(partial ?? {}) });
}

/** The options bag the public {@link wrapPage} accepts (D-01). */
export interface WrapPageOptions {
  /** The baseline store this page captures into and heals against (required). */
  store: BaselineStore;
  /** Optional config partial, merged over the defaults through the schema. */
  config?: Partial<SelfmendConfig>;
  /**
   * Optional fire-and-forget heal-event sink (D-07). Receives the full
   * {@link SelfmendEvent} union (healed + refused). Invoked but NOT awaited;
   * a throw or rejected promise is swallowed so it can never slow, stall, or
   * break the run. Omit it and heal events are simply dropped (emit is a no-op).
   */
  onHeal?: (event: SelfmendEvent) => void;
  /**
   * Optional live identity source (D-03). Read at EACH locator creation so one
   * long-lived page tracks the current logical test. Omit it and every locator
   * keys under the coarse `{ suite: "", test: "" }` default (D-04). NEVER derive
   * this from the page URL.
   */
  scope?: ScopeSource;
  /**
   * Optional bounded replay budget (ms) — the cap on a HEALED action's replay
   * (the real attempt always keeps the caller's own timeout). Omit it and the
   * raw-mode default {@link RAW_REPLAY_TIMEOUT_MS} applies. The `@playwright/test`
   * adapter (the fixture) passes its `Math.min(testInfo.timeout, 5000)` value
   * through here so the fixture's per-action wall-clock budget stays byte-identical
   * to the pre-refactor proxy (WRAP-04 zero behaviour change). Not part of the
   * documented public surface for raw adopters — it exists for the adapter.
   */
  replayTimeoutMs?: number;
}

/**
 * The raw-mode replay budget (ms). The real attempt keeps the caller's own
 * timeout (auto-wait is untouched); only the REPLAY is capped so a flaky heal
 * target cannot balloon the per-action wall-clock (FINDINGS (b)). Fixed in raw
 * mode (no `testInfo.timeout` to mirror — Claude's discretion per CONTEXT).
 */
const RAW_REPLAY_TIMEOUT_MS = 5000;

/**
 * Resolve the wrapped page's scope controller (D-06). Keyed by the RETURNED
 * proxy so the bare-Page return (D-01) is preserved — the controller lives
 * off-object in a side table, never as a visible property on the page.
 */
const CONTROLLERS = new WeakMap<object, ScopeController>();

/**
 * Wrap a real Playwright `Page` so its locator-factory methods return
 * healing-aware Locators, returning the BARE wrapped page (D-01) — a drop-in for
 * the original `page`, so `this.page = wrapPage(rawPage, opts)` leaves all step
 * / page-object code untouched. This is the runner-agnostic core entry
 * (WRAP-01); the `@playwright/test` fixture is one adapter on top of the same
 * `wrapLocator` + `HealContext` seam.
 *
 * Per factory call it builds a fresh {@link HealContext} from the live scope
 * (auto-resetting the occurrence counter on a `(suite, test)` tuple change,
 * D-05) and an `emit` that forwards to `onHeal` fire-and-forget with errors
 * swallowed (D-07); with no `onHeal`, emit is a safe no-op. Never-false-green
 * is unchanged: it lives in the pure `decide()`, so a coarse/wrong/absent key is
 * a MISSED heal, never a wrong heal (D-11).
 */
export function wrapPage(page: Page, opts: WrapPageOptions): Page {
  const config = resolveConfig(opts.config);
  const controller = createScopeController(opts.scope);
  // The replay cap: the adapter (fixture) supplies its mirror of the test
  // timeout; raw adopters fall back to the fixed raw-mode budget (D-08).
  const replayTimeoutMs = opts.replayTimeoutMs ?? RAW_REPLAY_TIMEOUT_MS;

  // Fire-and-forget heal-event sink (D-07): call onHeal but never await it, and
  // swallow any throw or rejected promise so observability can never affect the
  // run. With no onHeal, emit is a no-op.
  const emit = (event: SelfmendEvent): void => {
    const handler = opts.onHeal;
    if (!handler) return;
    try {
      const maybePromise = handler(event) as unknown;
      if (
        maybePromise &&
        typeof (maybePromise as { then?: unknown }).then === "function"
      ) {
        (maybePromise as Promise<unknown>).then(undefined, () => {});
      }
    } catch {
      // Fire-and-forget: a throwing onHeal never affects the run.
    }
  };

  const wrapped = new Proxy(page, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown;
      if (typeof value !== "function") return value;

      if (typeof prop === "string" && PAGE_LOCATOR_FACTORIES.has(prop)) {
        return (...args: unknown[]): Locator => {
          const real = (value as (...a: unknown[]) => Locator).apply(
            target,
            args,
          );
          // Read the scope LIVE for THIS creation (D-03): auto-resets the
          // counter on a tuple change and returns the current (suite, test).
          const resolved = controller.resolve();
          const selector = buildPageSelector(
            prop,
            args,
            resolved.nextOccurrence,
          );
          const ctx: HealContext = {
            page: target,
            store: opts.store,
            config,
            emit,
            suite: resolved.suite,
            test: resolved.test,
            replayTimeoutMs,
            nextOccurrence: resolved.nextOccurrence,
          };
          return wrapLocator(real, selector, ctx);
        };
      }

      return (value as (...a: unknown[]) => unknown).bind(target);
    },
  });

  // Stash the controller keyed by the returned proxy so resetScope can find it
  // without exposing it on the bare-Page return (D-06).
  CONTROLLERS.set(wrapped, controller);
  return wrapped;
}

/**
 * Force an occurrence-counter reset for a same-scope retry on a reused wrapped
 * page (D-06). The auto-reset cannot see a retry that re-enters the IDENTICAL
 * `(suite, test)` tuple, so callers wire `resetScope(page)` in a Before hook
 * when they have such retries. Resolves the page's controller via the
 * {@link CONTROLLERS} WeakMap (keyed by the returned proxy); calling it on a
 * page selfmend did not wrap is a safe no-op. Omitting it is fail-safe — a
 * missed heal on retry, never a wrong heal.
 */
export function resetScope(page: Page): void {
  const controller = CONTROLLERS.get(page as unknown as object);
  controller?.reset();
}
