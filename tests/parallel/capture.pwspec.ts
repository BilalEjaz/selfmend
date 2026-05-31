/**
 * INNER capture spec for the CAP-03 parallel-merge proof. Driven by
 * `tests/parallel-store.spec.ts` via a child `playwright test --workers=N`
 * against `playwright.parallel.config.ts` (NOT run by the default suite, which
 * testIgnores `tests/parallel/`).
 *
 * Each test captures a DISTINCT fingerprint through the real healing fixture, so
 * multiple workers running concurrently each flush their own
 * `shard-<parallelIndex>.json`. The child run's reporter (`onEnd`) then merges
 * all shards into ONE baseline.json in the SELFMEND_STORE_DIR temp dir. The
 * parent driver asserts that merged file holds EVERY captured key with no loss
 * or corruption (CAP-03).
 *
 * Parallel mode is forced per-file so the run uses real concurrency even though
 * the repo default config is workers:1 (project memory: sequential on Windows).
 */
import { expect } from "@playwright/test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

import { healingFixture as test } from "../../src/integration/fixture.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const INDEX_URL = pathToFileURL(
  resolve(HERE, "../fixture-app/index.html"),
).href;

// Real concurrency: each test is independent and may land on its own worker.
test.describe.configure({ mode: "parallel" });

// Each distinct selector -> a distinct occurrence/identity key -> a distinct
// baseline entry, so a clean merge must contain ALL of them.
const TARGETS = [
  '[data-testid="submit-btn"]',
  '[data-testid="control-only"]',
  '[data-testid="status"]',
  "#email",
];

for (const selector of TARGETS) {
  test(`captures a fingerprint for ${selector}`, async ({ page }) => {
    await page.goto(INDEX_URL);
    // Resolving a wrapped locator on the success path records its fingerprint
    // into the worker store; worker teardown flushes the shard.
    const loc = page.locator(selector);
    await loc.first().waitFor({ state: "attached" });
    expect(await loc.count()).toBeGreaterThanOrEqual(1);
  });
}
