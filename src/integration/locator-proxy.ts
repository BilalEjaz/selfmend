import { errors, type Locator, type Page } from "@playwright/test";

import type { SelfmendConfig } from "../config/schema.js";
import { captureFingerprint } from "../fingerprint/capture.js";
import { findCandidates } from "../matching/candidate-finder.js";
import { decide } from "../matching/decision.js";
import { score } from "../matching/scoring.js";
import type { ScoredCandidate } from "../matching/types.js";
import type { BaselineStore } from "../store/store.js";
import type { SelfmendEvent } from "./events.js";

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
]);

/**
 * Methods that capture-on-success but must NEVER heal-on-timeout (WR-01).
 *
 * `waitFor` is closer to an assertion than an action: `waitFor({state:'hidden'})`
 * times out precisely when the element is still VISIBLE, so routing its timeout
 * through the "find the element" heal would invert the user's intent (a
 * semantic false green) and is the closest thing in the action surface to a
 * HEAL-02 state-poll mis-fire. We still fingerprint on a SUCCESSFUL wait (a
 * resolved `waitFor` is a fine capture point), but a `waitFor` timeout always
 * propagates unchanged.
 */
const CAPTURE_ONLY = new Set<string>(["waitFor"]);

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
  /**
   * Pluggable, best-effort heal-event transport (D-08). The core no longer
   * references the Playwright test-info object: it hands every accepted heal /
   * refused attempt to `emit` and lets the adapter decide where it goes (the
   * `@playwright/test` adapter builds `emit` from the reporter attach path;
   * `wrapPage` builds it from the fire-and-forget `onHeal`). `emit` is
   * observability only and must NEVER suppress, slow, or stall the run: a
   * throwing/rejecting `emit` is swallowed by the proxy's guard so the ORIGINAL
   * error always propagates (T-05-01).
   */
  emit: (event: SelfmendEvent) => void | Promise<void>;
  /**
   * The suite-level identity component (D-09): mapped to the store key's
   * `testFile` arg so the cross-run key `suite :: test :: selector ::
   * occurrence` stays byte-identical to the pre-refactor `testFile :: ...`. The
   * `@playwright/test` adapter sets `suite` from the test file path; `wrapPage`
   * sets it from the caller's live `scope().suite` (coarse `""` by default).
   * NEVER derived from the page URL.
   */
  suite: string;
  /**
   * The test-level identity component (D-09): mapped to the store key's
   * `testTitle` arg. The `@playwright/test` adapter sets `test = titlePath`
   * joined (as today); `wrapPage` sets it from `scope().test` (coarse `""`).
   * Together with `suite` it scopes a selector's occurrence counter to one test.
   */
  test: string;
  /**
   * Bounded replay budget (ms). The real attempt keeps the user's configured
   * timeout (do not shorten auto-wait semantics); the replay is capped so a
   * flaky heal target cannot balloon the per-action wall-clock (FINDINGS (b)).
   */
  replayTimeoutMs: number;
  /**
   * Bounded budget (ms) for the best-effort success-path fingerprint capture so
   * a navigating / detached element cannot stall the action. Capture is
   * fire-and-forget: it NEVER extends the action's promise. This budget caps the
   * in-browser `evaluate` round-trip the capture performs, so after a navigating
   * action the capture fails fast (no fingerprint this run) instead of
   * auto-waiting the full default timeout on the now-detached element. Both ctx
   * builders supply {@link CAPTURE_TIMEOUT_MS}.
   */
  captureTimeoutMs: number;
  /**
   * Per-TEST, per-CONTENT occurrence source (D-04/D-05). Called once per
   * `wrapLocator` with the content identity (`testFile :: testTitle ::
   * selector`); returns the 0-based Nth CREATION of that content within the
   * test. Because the count depends only on how many times that selector was
   * created earlier in the test — deterministic execution order, NOT whether the
   * element resolved — the index is IDENTICAL on a green capture run and a later
   * broken heal run (Pitfall 4). This makes the baseline key cross-run stable,
   * which the Phase 1 run-order `step` counter never was. Reset per test (a new
   * counter per test, like the old step counter).
   */
  nextOccurrence: (contentKey: string) => number;
}

/**
 * Default bounded budget (ms) for the best-effort success-path fingerprint
 * capture (CAP-01). A sensible cap: long enough for a healthy in-browser
 * `evaluate` round-trip on a still-attached element, short enough that a
 * navigating / detached element fails the capture fast instead of stalling. Both
 * ctx builders (the `@playwright/test` fixture and the raw `wrapPage`) wire this
 * into `HealContext.captureTimeoutMs`.
 */
export const CAPTURE_TIMEOUT_MS = 2000;

/**
 * Build a fresh per-test, per-content occurrence counter (D-04/D-05). Each call
 * with a given content key returns the next 0-based index for THAT content; a
 * new counter (a new test) restarts every content key at 0. Inserting an
 * unrelated locator does not shift another content's indices (Pitfall 3),
 * because each content key has its own independent count.
 */
export function createOccurrenceCounter(): (contentKey: string) => number {
  const counts = new Map<string, number>();
  return (contentKey) => {
    const n = counts.get(contentKey) ?? 0;
    counts.set(contentKey, n + 1);
    return n;
  };
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
  // Occurrence key (D-04/D-05): stamped ONCE per wrapped locator at CREATION
  // time. The occurrence index counts how many times this (file, title,
  // selector) content was created earlier in the test, so two separate factory
  // calls of the same selector get distinct keys, while a single reused wrapped
  // locator keeps one key across its capture->heal lifetime — and the sequence
  // is identical on a green run and a later broken run (the element need not
  // resolve to be counted). Mark the key seen so the reporter's prune knows it
  // was executed even if no fingerprint is ever captured for it (D-09).
  const contentKey = `${ctx.suite} ${ctx.test} ${selector}`;
  const occurrence = ctx.nextOccurrence(contentKey);
  const key = ctx.store.identify(
    selector,
    ctx.suite,
    ctx.test,
    occurrence,
  );
  ctx.store.markSeen(key);

  return new Proxy(realLocator, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown;
      if (typeof value !== "function") return value;

      if (typeof prop === "string" && ACTION.has(prop)) {
        return (...args: unknown[]) =>
          actionOrHeal(target, selector, key, prop, args, ctx);
      }

      if (typeof prop === "string" && CAPTURE_ONLY.has(prop)) {
        return (...args: unknown[]) =>
          captureOnly(target, key, prop, args, ctx);
      }

      if (typeof prop === "string" && CHAIN.has(prop)) {
        return (...args: unknown[]) => {
          const next = (value as (...a: unknown[]) => Locator).apply(
            target,
            args,
          );
          // Re-wrap with a selector that records the chained refinement, so the
          // baseline key stays distinct from the parent locator's.
          const chainedSelector = `${selector} >> ${prop}(${describeArgs(args, ctx.nextOccurrence)})`;
          return wrapLocator(next, chainedSelector, ctx);
        };
      }

      // `constructor` must pass through UNBOUND. Older Playwright's expect()
      // detects a Locator via `receiver.constructor.name === "Locator"`
      // (1.60 switched to `receiver._apiName`). Binding the constructor makes
      // its `.name` become "bound Locator", so expect() on <= 1.59 would reject
      // the wrapped locator ("X can be only used with Locator object").
      if (prop === "constructor") return value;

      // Passthrough: properties, page(), count, evaluate, and (critically) the
      // surface the assertion matchers read. Bind so `this` stays the real
      // Locator.
      return (value as (...a: unknown[]) => unknown).bind(target);
    },
  });
}

/**
 * Compact description of chain args for the store key.
 *
 * Serializable args render to a stable string (`"text"`, `{"hasText":"Save"}`)
 * so a re-built identical chain re-derives the same baseline key. A
 * non-serializable arg (circular object, `RegExp`, `Locator`, ...) has no
 * stable serialization, so instead of collapsing it to `""` — which would let
 * two genuinely-different refinements share one baseline identity and risk a
 * heal matched against the wrong element's fingerprint (the CR-01 collision
 * class) — we fold in a DISTINGUISHING token: its `typeof` plus a per-test
 * monotonic index from {@link HealContext.nextOccurrence}. Distinct non-serializable
 * args within a test therefore get distinct tokens. The index is a per-test
 * occurrence count under a fixed content key, so it is deterministic within the
 * test (the same reason the main occurrence key is cross-run stable, D-05).
 */
export function describeArgs(
  args: unknown[],
  nextOccurrence: (contentKey: string) => number,
): string {
  return args
    .map((a) => {
      if (typeof a === "string") return a;
      try {
        const json = JSON.stringify(a);
        // `undefined`, a function, or a symbol stringify to `undefined` — treat
        // those as non-serializable too so they cannot collapse together.
        if (json !== undefined) return json;
      } catch {
        // Fall through to the distinguishing token below.
      }
      // A non-serializable arg has no stable serialization: fold in a
      // per-content occurrence index under a fixed pseudo-content key so two
      // distinct non-serializable args within a test get distinct tokens (LO-02)
      // without colliding with real selector content keys.
      return `<${typeof a}#${nextOccurrence("\u0000describeArgs:" + typeof a)}>`;
    })
    .join(",");
}

/**
 * Run a single action method against the real Locator; on a real TimeoutError,
 * run the pure heal decision and (only above the floor) rebind + replay.
 */
/**
 * Best-effort capture-on-success for the given key (deduped per run).
 *
 * BOUNDED + TRACKED (CAP-01): kicks off a `captureFingerprint` capped by
 * `ctx.captureTimeoutMs` so a detached / navigating element can never make the
 * `evaluate` round-trip auto-wait the full default timeout. The capture swallows
 * its own errors (best-effort: a miss means no fingerprint this run, never a
 * failed action), so the returned promise NEVER rejects. The promise is
 * registered via `ctx.store.track` so the heal path and the persist / teardown
 * flush can `await store.settle()` and guarantee an in-flight capture has landed
 * before they read or persist it.
 *
 * The promise is RETURNED so the two call sites can pick their semantics:
 *
 *  - The ACTION path ({@link actionOrHeal}) does NOT await it (fire-and-forget),
 *    so a navigating click resolves immediately instead of stalling on the
 *    now-detached element (the adopter-reported hang). A same-run reuse still
 *    finds the fingerprint because the heal path awaits `store.settle()` first.
 *  - The CAPTURE_ONLY path ({@link captureOnly}, e.g. `waitFor`) DOES await it.
 *    `waitFor` never itself navigates, and callers rely on the capture being
 *    landed by the time `waitFor` resolves (e.g. capture-then-saveBaseline), so
 *    the bounded await is both safe and required there.
 */
function captureOnSuccess(
  real: Locator,
  key: string,
  ctx: HealContext,
): Promise<void> {
  if (!ctx.config.enabled || ctx.store.has(key)) return Promise.resolve();
  const p = (async (): Promise<void> => {
    try {
      const fp = await captureFingerprint(
        real,
        ctx.config.testIdAttr,
        ctx.captureTimeoutMs,
      );
      ctx.store.set(key, fp);
    } catch {
      // Capture is best-effort: a detached / navigating element or a bounded
      // timeout simply means no fingerprint this run, never a failed action.
    }
  })();
  ctx.store.track(p);
  return p;
}

/**
 * Run a CAPTURE_ONLY method (e.g. `waitFor`): fingerprint on success, but on
 * ANY failure (including a TimeoutError) propagate unchanged — never heal
 * (WR-01). A `waitFor` is assertion-like, so its timeout must not route through
 * the find-the-element heal path.
 */
async function captureOnly(
  real: Locator,
  key: string,
  method: string,
  args: unknown[],
  ctx: HealContext,
): Promise<unknown> {
  const invoke = real[method as keyof Locator] as (
    ...a: unknown[]
  ) => Promise<unknown>;
  const result = await invoke.apply(real, args);
  // `waitFor` never navigates and callers rely on the capture being landed by
  // the time it resolves (capture-then-saveBaseline). Await the BOUNDED capture
  // so a same-run save / size check sees the fingerprint; the cap keeps even a
  // surprise detach from stalling.
  await captureOnSuccess(real, key, ctx);
  return result;
}

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
    // Green path: capture once per key per run (dedup-guarded). FIRE-AND-FORGET
    // and bounded, never awaited, so a navigating action resolves immediately
    // instead of stalling on a detached-element capture (the adopter bug).
    captureOnSuccess(real, key, ctx);
    return result;
  } catch (err) {
    if (!isTimeoutError(err)) throw err; // not a resolution failure -> propagate
    if (!ctx.config.enabled) throw err; // healing disabled (CFG-01) -> fail normally

    // Ensure any in-flight fire-and-forget capture from THIS run has landed
    // before reading the fingerprint, so a same-run capture-then-heal still
    // finds its baseline (the heal path is the one place that must wait).
    await ctx.store.settle();
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

    const decision = decide(scored, {
      floor: ctx.config.threshold,
      margin: ctx.config.margin,
    });
    if (!decision.heal) {
      // Post-scoring refusal (no-candidates / below-floor / ambiguous): record a
      // refused event for the report (REP-02, D-04), THEN unconditionally
      // re-throw the ORIGINAL error so the test fails normally (D-06, MATCH-04).
      // The attach is additive observability and must NEVER suppress the
      // failure (Pitfall 2): guard the ATTACH, not the throw, so even if the
      // attach rejects the original error still propagates.
      // Scope the refused event to the three post-scoring reasons; decide()
      // never returns `no-fingerprint` (that is the early re-throw above), but
      // the narrow keeps the wire contract honest and excludes it by type.
      if (
        decision.reason === "no-candidates" ||
        decision.reason === "below-floor" ||
        decision.reason === "ambiguous"
      ) {
        try {
          await ctx.emit({
            kind: "refused",
            testName: ctx.test,
            originalSelector: selector,
            reason: decision.reason,
            bestScore: decision.bestScore,
          });
        } catch {
          // Observability is best-effort; never let a failed emit mask `err`.
        }
      }
      throw err;
    }

    // Rebind = FRESH page.locator(newSelector) (cannot reuse an ElementHandle,
    // issue #10571). Replay the SAME action with a bounded replay budget.
    const healed = ctx.page.locator(decision.newSelector);
    const replayInvoke = healed[method as keyof Locator] as (
      ...a: unknown[]
    ) => Promise<unknown>;

    let result: unknown;
    try {
      result = await replayInvoke.apply(
        healed,
        withTimeout(args, ctx.replayTimeoutMs),
      );
    } catch {
      // The matched target was found but the replay itself failed (also broken,
      // or the bounded replay budget elapsed). Surface the user's ORIGINAL
      // error so the failure is not masked by a misleading replay error
      // (WR-03), and do NOT attach a heal event — there was no successful heal.
      throw err;
    }

    // Emit the heal event ONLY after the replay actually succeeded, so the
    // end-of-run summary never over-reports a heal that did not stick (WR-03).
    // Best-effort: a throwing/rejecting emit must NOT turn a successful heal
    // into a failure (D-08), so guard it and return the green result regardless.
    try {
      await ctx.emit({
        kind: "healed",
        testName: ctx.test,
        originalSelector: selector,
        healedTarget: decision.newSelector,
        score: decision.event.score,
      });
    } catch {
      // Observability is best-effort; a failed emit never fails a real heal.
    }
    return result;
  }
}
