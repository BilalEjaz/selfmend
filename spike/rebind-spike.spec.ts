/**
 * THROWAWAY SPIKE — DELETE AFTER plan 04 consumes spike/FINDINGS.md.
 *
 * Purpose (from 01-RESEARCH.md "Spike recommendation"): lock the three live-rebind
 * timing/mechanics details against @playwright/test 1.60 BEFORE integration code (plan 04):
 *
 *   1. Catch the real errors.TimeoutError from a wrapped click() on a deleted-then-renamed
 *      selector, then page.locator(newSel).click() replays GREEN. Heal fires ONLY after the
 *      real timeout, never on a transient poll miss (HEAL-02 / D-10).
 *   2. A Proxy-over-Locator re-wraps chained locators (getByRole(...).first()) without losing
 *      healing or breaking strict-mode / auto-wait.
 *   3. expect(locator) assertion matchers do NOT route through the wrapped action heal path
 *      (assertions stay sacred — research Open Question 2).
 *   4. Measure + bound the timeout-budget split between the real attempt and the heal replay.
 *
 * This is NOT production code. It is a proof harness. The durable output is spike/FINDINGS.md.
 *
 * Run: npx playwright test spike/rebind-spike.spec.ts
 */
import { test, expect, errors, type Locator, type Page } from "@playwright/test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

// ESM-safe __dirname (package.json has "type": "module").
const HERE = dirname(fileURLToPath(import.meta.url));

// file:// URLs for the two fixture states (offline; no dev server — security property).
const INDEX_URL = pathToFileURL(resolve(HERE, "../tests/fixture-app/index.html")).href;
const BROKEN_URL = pathToFileURL(resolve(HERE, "../tests/fixture-app/broken.html")).href;

// Conservative real-attempt budget for the spike. Real Playwright auto-waits the full
// configured timeout; we pass an explicit short timeout so the spike runs fast AND so we
// can MEASURE the real-attempt-vs-replay split (Task 2). plan 04 decides the production value.
const REAL_ATTEMPT_TIMEOUT_MS = 1200;
const REPLAY_TIMEOUT_MS = 5000;

// ---------------------------------------------------------------------------
// Minimal Proxy-over-Locator wrapper (research Pattern 1 + Pattern 2).
// Wraps the REAL locator; delegates by default; intercepts only the action set
// (heal-on-TimeoutError) and the chaining set (re-wrap so healing survives chains).
// expect()'s matchers are NOT in either set, so they pass straight through.
// ---------------------------------------------------------------------------

interface HealHook {
  /** Given the broken locator's identity, return a fresh selector that resolves, or null. */
  rebind(): Promise<string | null>;
  /** Spike instrumentation: record measured timings. */
  record(ev: { event: "heal"; realMs: number; healMs: number; newSelector: string }): void;
}

// Action methods: run capture-on-success / heal-on-TimeoutError.
const ACTION = new Set([
  "click", "fill", "type", "press", "hover", "check", "uncheck",
  "dblclick", "tap", "selectOption", "setInputFiles", "focus", "blur",
  "dragTo", "scrollIntoViewIfNeeded", "waitFor",
]);

// Chaining/refinement methods: call real, then re-wrap the returned Locator.
const CHAIN = new Set([
  "first", "last", "nth", "filter", "and", "or", "locator",
  "getByRole", "getByText", "getByLabel", "getByTestId",
  "getByPlaceholder", "getByAltText", "getByTitle",
]);

function wrapLocator(page: Page, real: Locator, hook: HealHook): Locator {
  return new Proxy(real, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;

      // ACTION: real attempt to its timeout → catch TimeoutError → rebind + replay.
      if (typeof prop === "string" && ACTION.has(prop)) {
        return async (...args: unknown[]) => {
          const realStart = Date.now();
          try {
            // Force the explicit short real-attempt timeout for the spike measurement.
            const lastArg = args[args.length - 1];
            const opts =
              typeof lastArg === "object" && lastArg !== null && !Array.isArray(lastArg)
                ? { ...(lastArg as object), timeout: REAL_ATTEMPT_TIMEOUT_MS }
                : { timeout: REAL_ATTEMPT_TIMEOUT_MS };
            const callArgs =
              typeof lastArg === "object" && lastArg !== null && !Array.isArray(lastArg)
                ? [...args.slice(0, -1), opts]
                : [...args, opts];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return await (value as any).apply(target, callArgs);
          } catch (err) {
            const realMs = Date.now() - realStart;
            // HEAL-02 guard: only a genuine post-auto-wait TimeoutError triggers healing.
            const isTimeout =
              err instanceof errors.TimeoutError ||
              (err as { name?: string })?.name === "TimeoutError";
            if (!isTimeout) throw err;

            const healStart = Date.now();
            const newSelector = await hook.rebind();
            if (!newSelector) throw err; // no candidate → re-throw → test fails normally (no false green)

            // Rebind = FRESH page.locator(newSelector) (cannot reuse an ElementHandle, issue #10571).
            const healed = page.locator(newSelector);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const result = await (healed as any)[prop](
              ...args,
              ...(args.length === 0 ? [{ timeout: REPLAY_TIMEOUT_MS }] : []),
            );
            const healMs = Date.now() - healStart;
            hook.record({ event: "heal", realMs, healMs, newSelector });
            return result;
          }
        };
      }

      // CHAIN: re-wrap the returned Locator so healing survives chaining.
      if (typeof prop === "string" && CHAIN.has(prop)) {
        return (...args: unknown[]) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const next = (value as any).apply(target, args) as Locator;
          return wrapLocator(page, next, hook);
        };
      }

      // Everything else (expect matchers route here via the unwrapped locator; properties; page()): pass through.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (value as any).bind(target);
    },
  });
}

// ---------------------------------------------------------------------------
// PROOF 1 — catch real TimeoutError + replay green against the mutated-selector fixture.
// ---------------------------------------------------------------------------
test("PROOF 1: wrapped click catches TimeoutError on a renamed selector, then replays green", async ({
  page,
}) => {
  await page.goto(BROKEN_URL);

  const recorded: Array<{ event: string; realMs: number; healMs: number; newSelector: string }> = [];

  // The broken locator: pinned to the OLD data-testid that broken.html renamed away.
  // It auto-waits to timeout (the element with submit-btn does not exist), throwing TimeoutError.
  const brokenSelector = '[data-testid="submit-btn"]';

  const hook: HealHook = {
    async rebind() {
      // Spike rebind stand-in: the surviving semantic element is the submit button.
      // Plan 04's scorer chooses this; here we assert the mechanism, not the scorer.
      // Prefer the new stable test-id; verify it uniquely resolves (count()===1) before accepting.
      const candidate = '[data-testid="primary-action"]';
      const count = await page.locator(candidate).count();
      return count === 1 ? candidate : null;
    },
    record(ev) {
      recorded.push(ev);
    },
  };

  const broken = wrapLocator(page, page.locator(brokenSelector), hook);

  // CRITICAL: we do NOT pre-check count(). We let click() auto-wait to timeout and heal.
  await broken.click();

  // The replay clicked the surviving submit button → form's submit handler is wired in fixture?
  // The fixture has no JS handler, so assert structurally: the healed element exists and was clicked.
  expect(recorded).toHaveLength(1);
  expect(recorded[0].event).toBe("heal");
  expect(recorded[0].newSelector).toBe('[data-testid="primary-action"]');

  // Confirm the heal target is the SAME semantic Submit button (text + role preserved).
  const healed = page.locator('[data-testid="primary-action"]');
  await expect(healed).toHaveText("Submit");
  await expect(healed).toHaveRole("button");
});

// ---------------------------------------------------------------------------
// PROOF 2 — the Proxy re-wraps chained locators (getByRole(...).first()) and heals through them.
// ---------------------------------------------------------------------------
test("PROOF 2: chained locator (getByRole(...).first()) re-wraps and still heals", async ({
  page,
}) => {
  await page.goto(BROKEN_URL);

  const recorded: Array<{ event: string }> = [];
  const hook: HealHook = {
    async rebind() {
      const candidate = '[data-testid="primary-action"]';
      return (await page.locator(candidate).count()) === 1 ? candidate : null;
    },
    record(ev) {
      recorded.push({ event: ev.event });
    },
  };

  // Start from a wrapped page.locator scope, then chain getByRole(...).first().
  // A broken role+name that does NOT match (we use a deliberately wrong name to force timeout).
  const scope = wrapLocator(page, page.locator("body"), hook);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chained = (scope as any)
    .getByRole("button", { name: "Nonexistent Label" })
    .first() as Locator;

  // chained must be a Proxy (re-wrapped), so its click() heals rather than just throwing.
  await chained.click();

  expect(recorded).toHaveLength(1);
  expect(recorded[0].event).toBe("heal");

  // Strict-mode / auto-wait must still work on the healed element.
  const healed = page.locator('[data-testid="primary-action"]');
  await expect(healed).toBeVisible();
});

// ---------------------------------------------------------------------------
// PROOF 3 — expect(locator) assertion matchers do NOT route through the wrapped action heal path.
// Assertions stay sacred (research Open Question 2 / threat T-03-02).
// ---------------------------------------------------------------------------
test("PROOF 3: expect(locator) matchers bypass the heal path (assertions stay sacred)", async ({
  page,
}) => {
  await page.goto(BROKEN_URL);

  let healAttempted = false;
  const hook: HealHook = {
    async rebind() {
      healAttempted = true; // if an assertion ever routed here, this flips.
      return '[data-testid="primary-action"]';
    },
    record() {
      healAttempted = true;
    },
  };

  // Wrap a locator pinned to the OLD (now-missing) selector.
  const wrapped = wrapLocator(page, page.locator('[data-testid="submit-btn"]'), hook);

  // expect(wrapped).toBeVisible() should FAIL (the element is gone) and must NOT heal.
  // The matcher reads the locator's query surface, not our intercepted action set,
  // so the heal hook must never be invoked.
  await expect(async () => {
    await expect(wrapped).toBeVisible({ timeout: 800 });
  }).rejects.toThrow();

  expect(healAttempted).toBe(false); // PROVEN: assertions never reach the heal path.
});

// ---------------------------------------------------------------------------
// PROOF 4 — measure the timeout-budget split (real attempt vs heal enumeration + replay)
// and assert total wall-clock is BOUNDED (threat T-03-03: unbounded heal DoS).
// ---------------------------------------------------------------------------
test("PROOF 4: timeout budget is measured and bounded (real attempt vs heal replay)", async ({
  page,
}) => {
  await page.goto(BROKEN_URL);

  const recorded: Array<{ realMs: number; healMs: number; newSelector: string }> = [];
  const hook: HealHook = {
    async rebind() {
      const candidate = '[data-testid="primary-action"]';
      return (await page.locator(candidate).count()) === 1 ? candidate : null;
    },
    record(ev) {
      recorded.push({ realMs: ev.realMs, healMs: ev.healMs, newSelector: ev.newSelector });
    },
  };

  const broken = wrapLocator(page, page.locator('[data-testid="submit-btn"]'), hook);

  const wallStart = Date.now();
  await broken.click();
  const totalMs = Date.now() - wallStart;

  expect(recorded).toHaveLength(1);
  const { realMs, healMs } = recorded[0];

  // The real attempt should consume ~the explicit REAL_ATTEMPT_TIMEOUT_MS (it ran to timeout).
  // The heal (enumeration + replay) should be a SMALL fraction of it.
  // Surface the numbers so they can be copied into FINDINGS.md.
  // eslint-disable-next-line no-console
  console.log(
    `[BUDGET] realAttempt=${realMs}ms healEnumReplay=${healMs}ms total=${totalMs}ms ` +
      `(configured realTimeout=${REAL_ATTEMPT_TIMEOUT_MS}ms replayTimeout=${REPLAY_TIMEOUT_MS}ms)`,
  );

  // Bound assertions (the de-risk): real attempt dominates; heal is bounded and short.
  expect(realMs).toBeGreaterThanOrEqual(REAL_ATTEMPT_TIMEOUT_MS - 200);
  expect(realMs).toBeLessThan(REAL_ATTEMPT_TIMEOUT_MS + 1500);
  expect(healMs).toBeLessThan(REPLAY_TIMEOUT_MS); // heal never exceeds its own budget
  expect(totalMs).toBeLessThan(REAL_ATTEMPT_TIMEOUT_MS + REPLAY_TIMEOUT_MS + 1000); // bounded
});

// ---------------------------------------------------------------------------
// SANITY — the SAME wrapped locator works WITHOUT healing on the un-mutated baseline.
// Confirms the wrapper is transparent on the green hot path (no premature heal — HEAL-02).
// ---------------------------------------------------------------------------
test("SANITY: wrapped click on the baseline resolves with zero heals (no premature heal)", async ({
  page,
}) => {
  await page.goto(INDEX_URL);

  const recorded: Array<unknown> = [];
  const hook: HealHook = {
    async rebind() {
      return null;
    },
    record(ev) {
      recorded.push(ev);
    },
  };

  const ok = wrapLocator(page, page.locator('[data-testid="submit-btn"]'), hook);
  await ok.click();

  expect(recorded).toHaveLength(0); // green path: real attempt succeeds, no heal fired.
});
