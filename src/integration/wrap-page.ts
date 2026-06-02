import { configSchema, type SelfmendConfig } from "../config/schema.js";
import { createOccurrenceCounter } from "./locator-proxy.js";

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
