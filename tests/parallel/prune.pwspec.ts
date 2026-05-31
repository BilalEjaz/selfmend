/**
 * INNER prune-gate spec for the D-09 proof. Driven by `tests/prune.spec.ts`
 * via child `playwright test` runs sharing one SELFMEND_STORE_DIR temp dir (NOT
 * run by the default suite, which testIgnores `tests/parallel/`).
 *
 * Two tests each capture a DISTINCT key:
 *  - a full (unfiltered) run records BOTH keys into baseline.json;
 *  - a `--grep`-filtered run that touches only ONE test must REFRESH but NOT
 *    prune the unseen key (D-09 / Pitfall 2): the filtered run is not COMPLETE,
 *    so even with SELFMEND_PRUNE set the destructive prune is gated off and the
 *    untouched key survives in baseline.json.
 *  - a complete passing run WITHOUT SELFMEND_PRUNE must also not delete the
 *    unseen key (the opt-in gate): refresh-only never removes entries.
 */
import { expect } from "@playwright/test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

import { healingFixture as test } from "../../src/integration/fixture.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const INDEX_URL = pathToFileURL(
  resolve(HERE, "../fixture-app/index.html"),
).href;

// Stable, greppable tags so the driver can run exactly one test.
test("prune-alpha captures the submit button", async ({ page }) => {
  await page.goto(INDEX_URL);
  await page.locator('[data-testid="submit-btn"]').waitFor({ state: "attached" });
});

test("prune-beta captures the status line", async ({ page }) => {
  await page.goto(INDEX_URL);
  await page.locator('[data-testid="status"]').waitFor({ state: "attached" });
});
