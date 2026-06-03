/**
 * Adopter-reported bug repro (raw wrapPage navigating-action hang).
 *
 * A wrapped locator action that triggers a client-side navigation must resolve
 * its awaited promise PROMPTLY. The success-path fingerprint capture used to be
 * awaited INLINE inside the action and was UNBOUNDED, so after a navigating
 * click the capture's locator.evaluate auto-waited the full default timeout
 * (~30s) on the now-detached element before the swallow caught it. The caller
 * hung for ~30s and timed out.
 *
 * This spec models tests/wrap-page.spec.ts: it launches a plain Chromium
 * browser, opens a RAW page, and wraps it with the public wrapPage. It then
 * clicks a navigating link and asserts the click RESOLVES WITHIN A TIGHT
 * wall-clock budget (it must NOT stall on the detached-element capture). It
 * also asserts the navigation actually happened and that NO heal fired (a
 * normal success, not a heal).
 *
 * On the BUGGY (unfixed) code the click exceeds the budget and this spec FAILS.
 */
import { test, expect, chromium, type Browser } from "@playwright/test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

import { wrapPage } from "../src/integration/wrap-page.js";
import { BaselineStore } from "../src/store/store.js";
import type { SelfmendEvent } from "../src/integration/events.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const NAV_START_URL = pathToFileURL(
  resolve(HERE, "./fixture-app/nav-start.html"),
).href;

// A generous runner timeout so the assertion (not the runner) reports the
// failure on the buggy code: the bug stalls the click ~30s, the budget below is
// 8s, so the budget assertion fires first while the test itself has room.
test.setTimeout(45000);

// Hard wall-clock budget for a navigating action: well under the ~30s default
// auto-wait the unbounded capture used to consume, well over a healthy click.
const CLICK_BUDGET_MS = 8000;

let browser: Browser;

test.beforeAll(async () => {
  browser = await chromium.launch();
});

test.afterAll(async () => {
  await browser.close();
});

test("a wrapped navigating-action resolves promptly (does not hang on the detached-element capture)", async () => {
  const store = new BaselineStore();
  const events: SelfmendEvent[] = [];
  const context = await browser.newContext();
  const raw = await context.newPage();
  const page = wrapPage(raw, {
    store,
    onHeal: (e) => events.push(e),
    scope: () => ({ suite: "wrap-page-navigation.spec.ts", test: "nav" }),
  });

  await page.goto(NAV_START_URL);

  const link = page.locator('[data-testid="nav-link"]');

  // Click the navigating link and measure the wall-clock. On the buggy code the
  // success-path capture stalls on the now-detached link for the full default
  // timeout, so the awaited click does not resolve within the budget.
  const startedAt = Date.now();
  await link.click();
  const elapsedMs = Date.now() - startedAt;

  expect(elapsedMs).toBeLessThan(CLICK_BUDGET_MS);

  // The navigation actually happened (the click was a real, successful action).
  await expect(page).toHaveURL(/index\.html/);

  // This is a normal success, not a heal: no healed event must have fired.
  expect(events.filter((e) => e.kind === "healed")).toHaveLength(0);

  await context.close();
});
