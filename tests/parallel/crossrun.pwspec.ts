/**
 * INNER cross-run persist-then-heal spec for the CAP-02 proof. Driven by
 * `tests/parallel-store.spec.ts` via TWO sequential child `playwright test`
 * runs sharing the same SELFMEND_STORE_DIR temp dir (NOT run by the default
 * suite, which testIgnores `tests/parallel/`).
 *
 * The SAME test (identical testFile + testTitle + selector + occurrence, so the
 * identity key is byte-identical across runs) branches on SELFMEND_CROSSRUN_PHASE:
 *
 *  - PHASE=capture (run N): on index.html, resolve the Submit button via its
 *    volatile `.btn-primary` class so its fingerprint is captured under key K.
 *    Worker teardown flushes a shard; the child reporter merges it into
 *    baseline.json.
 *  - PHASE=heal (run N+1, a FRESH process): the worker fixture loads ONLY the
 *    committed baseline.json from disk (no in-run capture is possible because
 *    `.btn-primary` does not exist on broken.html). The broken click times out,
 *    the heal loop scores candidates against the LOADED fingerprint at key K,
 *    and the action replays green. This proves a fingerprint captured in run N
 *    heals in run N+1 from the committed file ALONE (CAP-02).
 *
 * Using ONE test title (not two) is load-bearing: the occurrence identity key is
 * `testFile + testTitle + selector + occurrence`, so capture and heal must share
 * the title or the loaded fingerprint would be addressed under a different key.
 */
import { expect } from "@playwright/test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

import { healingFixture as test } from "../../src/integration/fixture.js";
import { HEAL_ATTACHMENT_NAME } from "../../src/integration/events.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const INDEX_URL = pathToFileURL(
  resolve(HERE, "../fixture-app/index.html"),
).href;
const BROKEN_URL = pathToFileURL(
  resolve(HERE, "../fixture-app/broken.html"),
).href;

const PHASE = process.env.SELFMEND_CROSSRUN_PHASE;

test("cross-run: persist on capture, heal from the committed baseline ALONE", async ({
  page,
}, testInfo) => {
  if (PHASE === "capture") {
    // Run N: capture the Submit button via its volatile class. The identity key
    // is K = (file, title, ".btn-primary", occurrence 0). waitFor success
    // records the fingerprint; teardown + reporter persist it to baseline.json.
    await page.goto(INDEX_URL);
    await page.locator(".btn-primary").waitFor({ state: "attached" });
    return;
  }

  // PHASE === "heal" — run N+1, a FRESH process. The only fingerprint available
  // for key K is the one LOADED from baseline.json (.btn-primary is gone on
  // broken.html, so there is no in-run capture). Same selector + occurrence ->
  // same key K -> the loaded fingerprint is the heal target.
  await page.goto(BROKEN_URL);
  await page.locator(".btn-primary").click({ timeout: 1500 });

  const healed = page.locator('[data-testid="submit-btn"]');
  await expect(healed).toHaveText("Submit");

  const healAttachments = testInfo.attachments.filter(
    (a) => a.name === HEAL_ATTACHMENT_NAME,
  );
  expect(healAttachments).toHaveLength(1);
  const event = JSON.parse(healAttachments[0]!.body!.toString());
  expect(event.originalSelector).toContain(".btn-primary");
  expect(event.healedTarget).toContain("submit-btn");
  expect(event.score).toBeGreaterThanOrEqual(0.9);
});
