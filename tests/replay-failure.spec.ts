/**
 * WR-03 proof: a failing healed-replay must NOT over-report a heal and must NOT
 * produce a false green.
 *
 * Flow:
 *   1. Capture the submit button's fingerprint on index.html (good page).
 *   2. Navigate to a page where the volatile selector is broken (so the
 *      original action times out) BUT the element's identity is intact, so the
 *      scorer finds a high-confidence match and the heal decision is `true`.
 *   3. The page covers that element with a pointer-intercepting overlay, so the
 *      REPLAYED click times out.
 *
 * The action must therefore REJECT (the user's original failure surfaces, not a
 * misleading replay error masquerading as success) and NO heal event may be
 * attached — the heal was attempted but did not succeed, so the summary must
 * not over-report it.
 */
import { expect } from "@playwright/test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

import { healingFixture as test } from "../src/integration/fixture.js";
import { HEAL_ATTACHMENT_NAME } from "../src/integration/events.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const INDEX_URL = pathToFileURL(resolve(HERE, "./fixture-app/index.html")).href;
const REPLAY_FAILS_URL = pathToFileURL(
  resolve(HERE, "./fixture-app/broken-replay-fails.html"),
).href;

test("WR-03: a failing healed-replay re-throws and attaches no heal event", async ({
  page,
}, testInfo) => {
  // 1. Capture on the good page.
  await page.goto(INDEX_URL);
  await page.locator(".btn-primary").click({ timeout: 1200 });

  // 2 + 3. Broken selector + a still-present element that the replay cannot act
  // on (overlay intercepts the click).
  await page.goto(REPLAY_FAILS_URL);

  // The action must FAIL: original times out -> heal matches -> replay click
  // times out under the overlay -> ORIGINAL error surfaces. No false green.
  await expect(async () => {
    await page.locator(".btn-primary").click({ timeout: 1200 });
  }).rejects.toThrow();

  // And crucially: NO heal event was attached. The heal was attempted but the
  // replay failed, so the run summary must not count it as a heal (WR-03).
  const healAttachments = testInfo.attachments.filter(
    (a) => a.name === HEAL_ATTACHMENT_NAME,
  );
  expect(healAttachments).toHaveLength(0);
});
