/**
 * WRAP-01 + the never-false-green invariant (D-11), proven in RAW mode.
 *
 * Unlike heal.spec.ts (which drives the `@playwright/test` healing fixture), this
 * spec exercises the runner-agnostic core directly: it launches a plain Chromium
 * browser, opens a RAW `page` (NOT the healingFixture page override), and wraps it
 * with the public `wrapPage(page, { store, onHeal, scope })`. This is the contract
 * a Cucumber / Mocha / plain-script adopter uses (D-01: `this.page = wrapPage(...)`).
 *
 * It proves the four properties the core must hold OUTSIDE the runner:
 *
 *  1. HEAL-GREEN — a broken-but-present locator heals green through wrapPage with a
 *     real in-process BaselineStore: capture the submit button's fingerprint on
 *     index.html, then on broken.html (class renamed) the SAME wrapped locator heals
 *     after the real timeout and replays green; onHeal receives a kind:"healed"
 *     SelfmendEvent naming the stable [data-testid="submit-btn"] target (WRAP-01).
 *  2. WRONG-SCOPE CONTROL — capture under one scope, attempt the broken action under
 *     a DELIBERATELY-DIFFERENT scope so the stored fingerprint's key never matches:
 *     NO heal, the action fails normally (never-false-green, D-11).
 *  3. ABSENT-ELEMENT CONTROL — the genuinely-absent control-only element on
 *     broken.html has no candidate above the floor: NO heal, the action fails
 *     normally, onHeal saw no healed event.
 *  4. FAIL-SAFE — a throwing onHeal still heals green (throw swallowed, D-07); a
 *     throwing scope() does not crash the wrap (it falls back to the coarse default
 *     and the run proceeds, D-04 / T-05-02).
 *
 * The store is constructed in-process (standalone load/save is Phase 6): each case
 * captures on index.html then heals on broken.html within the SAME store, so the
 * cross-run key it relies on is exercised end-to-end in one spec.
 */
import { test, expect, chromium, type Browser } from "@playwright/test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

import { wrapPage } from "../src/integration/wrap-page.js";
import { BaselineStore } from "../src/store/store.js";
import type { SelfmendEvent } from "../src/integration/events.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const INDEX_URL = pathToFileURL(resolve(HERE, "./fixture-app/index.html")).href;
const BROKEN_URL = pathToFileURL(resolve(HERE, "./fixture-app/broken.html")).href;

// One launched Chromium for the whole spec, closed in teardown. Every test opens
// its OWN context+page so they stay isolated (no fixture page override anywhere).
let browser: Browser;

test.beforeAll(async () => {
  browser = await chromium.launch();
});

test.afterAll(async () => {
  await browser.close();
});

test("WRAP-01: a broken-but-present locator heals green through wrapPage on a RAW page", async () => {
  const store = new BaselineStore();
  const events: SelfmendEvent[] = [];
  const context = await browser.newContext();
  // A RAW page, then wrapped by the public core — NOT the healingFixture page.
  const raw = await context.newPage();
  const page = wrapPage(raw, {
    store,
    onHeal: (e) => events.push(e),
    scope: () => ({ suite: "wrap-page.spec.ts", test: "raw heal" }),
  });

  // Capture on the good page: resolve the submit button via its volatile class
  // and reuse the SAME wrapped locator for capture + heal so the baseline key is
  // stable across both calls (CR-01).
  await page.goto(INDEX_URL);
  const submit = page.locator(".btn-primary");
  await submit.waitFor();

  // The class is renamed on broken.html; the same locator keeps the same key, so
  // the heal loop has a fingerprint to match against. The real attempt auto-waits
  // to a TimeoutError, the scorer matches the surviving Submit button (identity
  // intact, above the 0.9 floor), and the action replays green.
  await page.goto(BROKEN_URL);
  await submit.click({ timeout: 1200 });

  // The healed element is the same semantic Submit button.
  const healed = page.locator('[data-testid="submit-btn"]');
  await expect(healed).toHaveText("Submit");

  // onHeal received exactly one healed event naming the stable target (WRAP-01).
  expect(events).toHaveLength(1);
  expect(events[0]!.kind).toBe("healed");
  const healedEvent = events[0] as Extract<SelfmendEvent, { kind?: "healed" }>;
  expect(healedEvent.originalSelector).toContain(".btn-primary");
  expect(healedEvent.healedTarget).toContain("submit-btn");
  expect(healedEvent.score).toBeGreaterThanOrEqual(0.9);

  await context.close();
});

test("D-11 control: a deliberately-WRONG scope yields no heal and the action fails normally", async () => {
  const store = new BaselineStore();
  const events: SelfmendEvent[] = [];
  const context = await browser.newContext();
  const raw = await context.newPage();

  // CAPTURE under scope A: the fingerprint is keyed to (suiteA, testA).
  let scopeSuite = "wrap-page.spec.ts";
  let scopeTest = "scope-A";
  const page = wrapPage(raw, {
    store,
    onHeal: (e) => events.push(e),
    scope: () => ({ suite: scopeSuite, test: scopeTest }),
  });

  await page.goto(INDEX_URL);
  // Capture the submit button's fingerprint under scope A.
  await page.locator(".btn-primary").waitFor();

  // HEAL ATTEMPT under scope B: a brand-new wrapped locator created under a
  // DIFFERENT (suite, test) keys to a DIFFERENT identity, so the captured
  // fingerprint is never found -> no fingerprint -> early re-throw, no heal.
  scopeSuite = "wrap-page.spec.ts";
  scopeTest = "scope-B-deliberately-different";
  await page.goto(BROKEN_URL);

  await expect(async () => {
    await page.locator(".btn-primary").click({ timeout: 1200 });
  }).rejects.toThrow();

  // Never-false-green: a wrong key is a MISSED heal, never a wrong heal (D-11).
  expect(events.filter((e) => e.kind === "healed")).toHaveLength(0);

  await context.close();
});

test("D-11 control: a genuinely-absent element yields no heal and the action fails normally", async () => {
  const store = new BaselineStore();
  const events: SelfmendEvent[] = [];
  const context = await browser.newContext();
  const raw = await context.newPage();
  const page = wrapPage(raw, {
    store,
    onHeal: (e) => events.push(e),
    scope: () => ({ suite: "wrap-page.spec.ts", test: "absent control" }),
  });

  // Capture the control-only element on index.html (it exists here). Reuse the
  // SAME wrapped locator for capture + heal so the key matches.
  await page.goto(INDEX_URL);
  const control = page.locator('[data-testid="control-only"]');
  await control.waitFor();

  // On broken.html the control element is GONE and has NO correct heal target:
  // no candidate clears the floor, so the original error re-throws.
  await page.goto(BROKEN_URL);
  await expect(async () => {
    await control.click({ timeout: 1200 });
  }).rejects.toThrow();

  // Nothing healed (no false green on a genuinely-absent element).
  expect(events.filter((e) => e.kind === "healed")).toHaveLength(0);

  await context.close();
});

test("D-07/T-05-01: a THROWING onHeal still heals green (the throw is swallowed)", async () => {
  const store = new BaselineStore();
  let onHealCalls = 0;
  const context = await browser.newContext();
  const raw = await context.newPage();
  const page = wrapPage(raw, {
    store,
    // A hostile onHeal that throws synchronously on every event. Fire-and-forget
    // means the throw is swallowed and the heal still completes green (D-07).
    onHeal: () => {
      onHealCalls += 1;
      throw new Error("onHeal blew up");
    },
    scope: () => ({ suite: "wrap-page.spec.ts", test: "throwing onHeal" }),
  });

  await page.goto(INDEX_URL);
  const submit = page.locator(".btn-primary");
  await submit.waitFor();
  await page.goto(BROKEN_URL);

  // Despite the throwing onHeal, the action heals and replays GREEN (no throw
  // escapes to fail the action).
  await submit.click({ timeout: 1200 });
  const healed = page.locator('[data-testid="submit-btn"]');
  await expect(healed).toHaveText("Submit");
  // onHeal WAS invoked (and threw) — proving the throw was swallowed, not skipped.
  expect(onHealCalls).toBe(1);

  await context.close();
});

test("T-05-02: a THROWING scope() does not crash the wrap; it falls back to the coarse default and heals", async () => {
  const store = new BaselineStore();
  const events: SelfmendEvent[] = [];
  const context = await browser.newContext();
  const raw = await context.newPage();
  const page = wrapPage(raw, {
    store,
    onHeal: (e) => events.push(e),
    // A hostile scope() that throws on every call. readScope must catch it and
    // fall back to the coarse { suite:"", test:"" } default (D-04 / T-05-02), so
    // capture AND heal key to the SAME coarse identity and the heal still works.
    scope: () => {
      throw new Error("scope blew up");
    },
  });

  await page.goto(INDEX_URL);
  const submit = page.locator(".btn-primary");
  // The factory call must NOT throw even though scope() throws.
  await submit.waitFor();
  await page.goto(BROKEN_URL);

  // The wrap did not crash; the coarse-default key matches across capture+heal so
  // the action still heals green (the run proceeds — never crashed by scope()).
  await submit.click({ timeout: 1200 });
  const healed = page.locator('[data-testid="submit-btn"]');
  await expect(healed).toHaveText("Submit");
  expect(events.filter((e) => e.kind === "healed")).toHaveLength(1);

  await context.close();
});
