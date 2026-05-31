/**
 * HEAL-02 proof: healing fires ONLY after the real auto-wait/timeout, never on
 * a transient slow-but-present element.
 *
 * A slow element is injected so it appears just AFTER the action starts but
 * WELL WITHIN the action's auto-wait budget. Playwright auto-waits and resolves
 * it on its own; no TimeoutError is thrown, so the heal path is never entered.
 * We assert (a) the action succeeded on the original locator and (b) no heal
 * event was attached.
 */
import { expect } from "@playwright/test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

import { healingFixture as test } from "../src/integration/fixture.js";
import { HEAL_ATTACHMENT_NAME } from "../src/integration/events.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const INDEX_URL = pathToFileURL(resolve(HERE, "./fixture-app/index.html")).href;

test("HEAL-02: a slow-but-present element resolves on its own and does NOT heal", async ({
  page,
}, testInfo) => {
  await page.goto(INDEX_URL);

  // Inject a button that does NOT exist yet but appears after ~400ms — well
  // within the action's auto-wait budget. Auto-wait should resolve it without
  // ever throwing a TimeoutError, so no heal can fire.
  await page.evaluate(() => {
    setTimeout(() => {
      const btn = document.createElement("button");
      btn.setAttribute("data-testid", "slow-btn");
      btn.textContent = "Slow";
      document.querySelector("main")?.appendChild(btn);
    }, 400);
  });

  // The action auto-waits up to its budget; the element shows at ~400ms and the
  // click succeeds on the ORIGINAL locator. No fingerprint was ever captured
  // for this key, so if a heal HAD fired it would have re-thrown (no-fingerprint)
  // — proving the click here succeeded purely via auto-wait.
  await page.locator('[data-testid="slow-btn"]').click({ timeout: 5000 });

  // It really is present now.
  expect(await page.locator('[data-testid="slow-btn"]').count()).toBe(1);

  // No heal event was attached: the slow-but-present element did not trigger a heal.
  const healAttachments = testInfo.attachments.filter(
    (a) => a.name === HEAL_ATTACHMENT_NAME,
  );
  expect(healAttachments).toHaveLength(0);
});
