/**
 * MATCH-04 / REP-02 proof: an AMBIGUOUS duplicate FAILS rather than heals.
 *
 * This is the load-bearing empirical calibration of the 0.05 second-best margin
 * (D-01, MATCH-03). The fixture has TWO near-identical "Delete" buttons sharing
 * every strong identity signal (data-testid, text, role, tag); they differ only
 * in weak positional signals. When the captured button's volatile selector
 * breaks, both survivors score near-identically high (above the 0.9 floor) but
 * within 0.05 of each other, so `decide()` returns reason "ambiguous" and the
 * action must FAIL normally — observability (a refused event) is attached but
 * NEVER substitutes for the failure (D-06, no false green).
 *
 * Calibration cross-check (RESEARCH Open Question 3): the genuine single-survivor
 * heal in `heal.spec.ts` must STILL heal under the same 0.05 margin. If THIS test
 * heals (the duplicate) the margin is too small / the scorer too flat; if
 * heal.spec.ts breaks the margin is too large. They are run together in CI.
 */
import { expect } from "@playwright/test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

import { healingFixture as test } from "../src/integration/fixture.js";
import { HEAL_ATTACHMENT_NAME } from "../src/integration/events.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const AMBIGUOUS_URL = pathToFileURL(
  resolve(HERE, "./fixture-app/ambiguous.html"),
).href;
const AMBIGUOUS_BROKEN_URL = pathToFileURL(
  resolve(HERE, "./fixture-app/ambiguous-broken.html"),
).href;

test("MATCH-04: an ambiguous duplicate FAILS (no heal) and is reported as refused-ambiguous", async ({
  page,
}, testInfo) => {
  // 1. Capture on the baseline page: resolve the first row's delete button via
  //    its volatile class. The SAME wrapped locator is reused for capture AND
  //    the (failing) action so its baseline key is stable (CR-01). The captured
  //    fingerprint carries the shared identity (data-testid="delete-item",
  //    text "Delete", role button) — the same identity BOTH survivors keep.
  await page.goto(AMBIGUOUS_URL);
  const deleteBtn = page.locator(".btn-delete-primary");
  await deleteBtn.waitFor();

  // 2. The volatile class is renamed in the broken page. The SAME locator keeps
  //    its baseline key, so the heal loop has a fingerprint to match — but now
  //    TWO equally-plausible survivors remain.
  await page.goto(AMBIGUOUS_BROKEN_URL);

  // 3. The real attempt auto-waits to timeout (.btn-delete-primary is gone),
  //    scoring yields two candidates within the 0.05 margin -> decide() refuses
  //    as ambiguous -> the ORIGINAL error is re-thrown. The action MUST reject
  //    (no false green). If it healed, this would resolve and the test fails.
  await expect(async () => {
    await deleteBtn.click({ timeout: 1200 });
  }).rejects.toThrow();

  // 4. No healed attachment was written (nothing was healed)...
  const attachments = testInfo.attachments.filter(
    (a) => a.name === HEAL_ATTACHMENT_NAME,
  );
  const parsed = attachments.map((a) => JSON.parse(a.body!.toString()));
  const healed = parsed.filter((e) => e.kind === "healed" || e.kind === undefined);
  expect(healed).toHaveLength(0);

  // 5. ...and exactly one refused-ambiguous event was attached (REP-02).
  const refused = parsed.filter((e) => e.kind === "refused");
  expect(refused).toHaveLength(1);
  expect(refused[0].reason).toBe("ambiguous");
  expect(refused[0].originalSelector).toContain(".btn-delete-primary");
  // The best score seen still cleared the floor — it was the AMBIGUITY (two
  // near-equal survivors), not a weak match, that refused the heal.
  expect(refused[0].bestScore).toBeGreaterThanOrEqual(0.9);
});
