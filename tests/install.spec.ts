/**
 * INST-01 / INST-02 proof: the one-line import swap works and existing Playwright
 * tests run UNCHANGED, with assertions never routed through the heal path.
 *
 * The only thing that changed vs. a stock Playwright test is the import line:
 *
 *     import { test, expect } from "@playwright/test";   // before
 *     import { test, expect } from "selfmend";           // after  (this file)
 *
 * Here we import from the LOCAL package entry (`../src/index.js`, the same
 * module the package `exports` map points at). Everything below is ordinary
 * Playwright usage — `page.goto`, `page.getByRole(...).click()`, `expect(...)`
 * matchers — and must pass with no rewrites (INST-01). On the un-mutated fixture
 * app nothing breaks, so no heal occurs: existing usage is transparently
 * unchanged (INST-02), and assertions are proven not to heal.
 */
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

// THE IMPORT SWAP: test + expect come from selfmend's public entry, not
// @playwright/test. This single line is the whole install ergonomic (D-02/D-03).
import { test, expect } from "../src/index.js";
import { HEAL_ATTACHMENT_NAME } from "../src/integration/events.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const INDEX_URL = pathToFileURL(resolve(HERE, "./fixture-app/index.html")).href;

test("INST-01: an unchanged page/locator test runs green through the swapped import", async ({
  page,
}, testInfo) => {
  await page.goto(INDEX_URL);

  // Ordinary Playwright locator usage — exactly what a user already wrote.
  const submit = page.getByRole("button", { name: "Submit" });
  await expect(submit).toBeVisible();
  await submit.click();

  // Ordinary assertions — these are @playwright/test's expect, re-exported
  // unchanged. They resolve normally on the present elements.
  await expect(page.getByTestId("status")).toHaveText("idle");
  await expect(page.getByRole("button", { name: "Submit" })).toBeEnabled();

  // INST-02: nothing broke, so nothing healed — the existing test is unchanged.
  const healAttachments = testInfo.attachments.filter(
    (a) => a.name === HEAL_ATTACHMENT_NAME,
  );
  expect(healAttachments).toHaveLength(0);
});

test("INST-02: a failing assertion fails normally and is NOT healed (assertions sacred)", async ({
  page,
}, testInfo) => {
  await page.goto(INDEX_URL);

  // An assertion against a value that is wrong on purpose. The heal path only
  // wraps ACTION methods (click/fill/...), never expect matchers, so this must
  // reject as a normal assertion failure — selfmend must NOT "heal" it green.
  await expect(async () => {
    await expect(page.getByTestId("status")).toHaveText("definitely-not-idle", {
      timeout: 800,
    });
  }).rejects.toThrow();

  // No heal event was produced by an assertion (T-05-04): assertions never
  // enter the heal loop.
  const healAttachments = testInfo.attachments.filter(
    (a) => a.name === HEAL_ATTACHMENT_NAME,
  );
  expect(healAttachments).toHaveLength(0);
});

test("INST-01: the public entry re-exports the same expect as @playwright/test", async () => {
  const selfmend = await import("../src/index.js");
  const pw = await import("@playwright/test");
  // The swap is truly one line because `expect` is literally re-exported.
  expect(selfmend.expect).toBe(pw.expect);
  // And the composable fixture + config type surface are present (D-04/CFG-01).
  expect(typeof selfmend.healingFixture).toBe("function");
  expect(typeof selfmend.SelfmendReporter).toBe("function");
  expect(selfmend.test).toBe(selfmend.healingFixture);
});
