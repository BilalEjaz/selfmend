/**
 * HEAL-01 proof + no-false-green control, against the offline file:// fixture.
 *
 * Uses the real `healingFixture` page override: every `page.locator(...)` is a
 * healing-aware Proxy. The flow mirrors production:
 *   1. On index.html, resolve the target via its (volatile) class selector ->
 *      a fingerprint is captured (test-id "submit-btn", text, role, position).
 *   2. On broken.html the class changed (".btn-primary" -> ".btn-cta") so the
 *      original selector is gone, but the element's identity survives intact ->
 *      the action heals after the real timeout, above the 0.9 floor, GREEN.
 *
 * CONTROL (no false green): a genuinely-absent element (present on index.html,
 * absent on broken.html, with no surviving candidate above the floor) must
 * re-throw and the action must FAIL normally — proven via an expected-failure
 * wrapper so the spec itself stays green while asserting the failure.
 */
import { expect } from "@playwright/test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

import { healingFixture as test } from "../src/integration/fixture.js";
import { HEAL_ATTACHMENT_NAME } from "../src/integration/events.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const INDEX_URL = pathToFileURL(resolve(HERE, "./fixture-app/index.html")).href;
const BROKEN_URL = pathToFileURL(resolve(HERE, "./fixture-app/broken.html")).href;

test("HEAL-01: a broken-but-present selector heals after timeout and the test stays green", async ({
  page,
}, testInfo) => {
  // 1. Capture on the good page: resolve the submit button via its class
  //    selector (records the fingerprint, incl. the stable test-id). Reuse the
  //    SAME wrapped locator for capture AND heal so its baseline key is stable
  //    across both calls (CR-01: distinct factory calls get distinct steps).
  await page.goto(INDEX_URL);
  const submit = page.locator(".btn-primary");
  await submit.waitFor();

  // 2. The class is renamed in broken.html. The SAME locator keeps the same
  //    baseline key, so the heal loop has a fingerprint to match against.
  await page.goto(BROKEN_URL);

  // The real attempt auto-waits to timeout (.btn-primary is gone), throws
  // TimeoutError, the scorer matches the surviving Submit button (identity
  // intact -> above the 0.9 floor), and the action replays green. A short
  // explicit timeout keeps the test fast.
  await submit.click({ timeout: 1200 });

  // The healed element is the same semantic Submit button.
  const healed = page.locator('[data-testid="submit-btn"]');
  await expect(healed).toHaveText("Submit");
  await expect(healed).toHaveRole("button");

  // A heal event was attached (worker -> main transport for the report).
  const healAttachments = testInfo.attachments.filter(
    (a) => a.name === HEAL_ATTACHMENT_NAME,
  );
  expect(healAttachments).toHaveLength(1);
  const event = JSON.parse(healAttachments[0]!.body!.toString());
  expect(event.originalSelector).toContain(".btn-primary");
  expect(event.healedTarget).toContain("submit-btn");
  expect(event.score).toBeGreaterThanOrEqual(0.9);
});

test("no false green: a genuinely-absent element re-throws and the action fails normally", async ({
  page,
}, testInfo) => {
  // Capture the control element on index.html (it exists here).
  await page.goto(INDEX_URL);
  await page.locator('[data-testid="control-only"]').waitFor();

  // On broken.html the control element is GONE and has no correct heal target.
  await page.goto(BROKEN_URL);

  // Expected-failure wrapper: the action MUST throw (no candidate clears the
  // floor -> the original TimeoutError is re-thrown). If it healed, this would
  // not reject and the assertion would fail — catching a false green.
  await expect(async () => {
    await page.locator('[data-testid="control-only"]').click({ timeout: 1200 });
  }).rejects.toThrow();

  // And no heal event was attached (nothing was healed).
  const healAttachments = testInfo.attachments.filter(
    (a) => a.name === HEAL_ATTACHMENT_NAME,
  );
  expect(healAttachments).toHaveLength(0);
});

test("INST-02: chained locator usage works unchanged through the wrapped page", async ({
  page,
}) => {
  await page.goto(INDEX_URL);

  // Chaining survives the proxy: scope -> getByRole -> first, all healing-aware,
  // resolves and acts normally on the un-mutated page (no heal needed).
  const scoped = page.locator("#signup-form").getByRole("button", { name: "Submit" });
  await expect(scoped).toBeVisible();
  await scoped.click({ timeout: 1200 });

  // The wrapped locator still exposes the full Locator API (passthrough).
  expect(await page.locator('[data-testid="submit-btn"]').count()).toBe(1);
});
