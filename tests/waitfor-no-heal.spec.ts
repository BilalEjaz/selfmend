/**
 * WR-01 proof: `waitFor` is NOT a healable action.
 *
 * `locator.waitFor({ state: "hidden" })` timing out (because the element is
 * still visible) must NOT route through the "find the element" heal path — that
 * would invert the user's intent (assert-it-became-hidden) into a
 * find-it-anyway heal, a semantic false green and a HEAL-02 mis-fire risk.
 *
 * We first capture a fingerprint for the target on success, then issue a
 * `waitFor({ state: "hidden" })` against the still-visible element. The wait
 * MUST throw a TimeoutError (the element never hides) and MUST NOT attach a
 * heal event.
 */
import { expect } from "@playwright/test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

import { healingFixture as test } from "../src/integration/fixture.js";
import { HEAL_ATTACHMENT_NAME } from "../src/integration/events.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const INDEX_URL = pathToFileURL(resolve(HERE, "./fixture-app/index.html")).href;

test("WR-01: a waitFor({state:'hidden'}) timeout does NOT heal and fails normally", async ({
  page,
}, testInfo) => {
  await page.goto(INDEX_URL);

  // Capture a fingerprint for the submit button on a successful action, so a
  // baseline EXISTS for this key — if waitFor were healable, the heal path
  // would have something to match against and could false-green. Reuse ONE
  // wrapped locator so the click (capture) and the waitFor share a baseline
  // key (CR-01).
  const submit = page.locator(".btn-primary");
  await submit.click({ timeout: 1200 });

  // The submit button is visible and never hides. waitFor({state:'hidden'})
  // must time out and the TimeoutError must propagate — NOT be swallowed by a
  // heal that re-finds the (still-visible) element.
  await expect(async () => {
    await submit.waitFor({ state: "hidden", timeout: 1000 });
  }).rejects.toThrow();

  // No heal event was attached: waitFor is not healable.
  const healAttachments = testInfo.attachments.filter(
    (a) => a.name === HEAL_ATTACHMENT_NAME,
  );
  expect(healAttachments).toHaveLength(0);
});
