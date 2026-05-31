/**
 * Integration proof for CAP-01 (fingerprint capture) and MATCH-01 wiring
 * (candidate enumeration), run in the real Playwright/Chromium worker against
 * the offline file:// fixture app.
 *
 * These tests exercise the Playwright-touching adapters around the pure core:
 *   - `BaselineStore`: in-process, single-worker, keyed by locator identity.
 *   - `captureFingerprint`: ONE batched `locator.evaluate` -> derived signals.
 *   - `findCandidates`: ONE scoped `page.evaluate` enumeration -> descriptors
 *     each carrying a uniquely-resolving `uniqueSelector`.
 *
 * A thin inline wrapper stands in for the real fixture (Task 3) so this spec
 * can prove capture/enumeration before the proxy + page override land.
 */
import { test, expect } from "@playwright/test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

import { BaselineStore } from "../src/store/store.js";
import { captureFingerprint } from "../src/fingerprint/capture.js";
import { findCandidates } from "../src/matching/candidate-finder.js";
import { DEFAULT_TEST_ID_ATTR } from "../src/config/schema.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const INDEX_URL = pathToFileURL(resolve(HERE, "./fixture-app/index.html")).href;
const BROKEN_URL = pathToFileURL(resolve(HERE, "./fixture-app/broken.html")).href;

test("captures exactly one fingerprint with CAP-01 signals on a resolved locator", async ({
  page,
}) => {
  await page.goto(INDEX_URL);
  const store = new BaselineStore();
  const key = store.identify('[data-testid="submit-btn"]', "capture.spec.ts", 0);

  const locator = page.locator('[data-testid="submit-btn"]');
  await locator.waitFor();

  // Capture-on-success: dedup-guarded record of derived signals only.
  if (!store.has(key)) {
    const fp = await captureFingerprint(locator, DEFAULT_TEST_ID_ATTR);
    store.set(key, fp);
  }

  expect(store.size).toBe(1);
  const fp = store.get(key);
  expect(fp).toBeDefined();
  if (!fp) throw new Error("unreachable");

  // CAP-01 signals all present and derived/normalized.
  expect(fp.tag).toBe("button");
  expect(fp.role).toBe("button");
  expect(fp.text).toBe("Submit"); // normalized: whitespace collapsed + trimmed
  expect(fp.testId).toBe("submit-btn");
  expect(fp.attrs).toMatchObject({ type: "submit" });
  expect(fp.ordinal).toBeGreaterThanOrEqual(0);
  expect(fp.parentTag).toBe("form");
  expect(typeof fp.neighbourSignature).toBe("string");
});

test("dedups a second capture of the same key without a second round-trip", async ({
  page,
}) => {
  await page.goto(INDEX_URL);
  const store = new BaselineStore();
  const key = store.identify('[data-testid="submit-btn"]', "capture.spec.ts", 0);
  const locator = page.locator('[data-testid="submit-btn"]');
  await locator.waitFor();

  let evaluateCalls = 0;
  const capture = async () => {
    if (store.has(key)) return; // dedup: skip the round-trip entirely
    evaluateCalls++;
    store.set(key, await captureFingerprint(locator, DEFAULT_TEST_ID_ATTR));
  };

  await capture();
  await capture(); // second call must be a no-op (deduped)

  expect(store.size).toBe(1);
  expect(evaluateCalls).toBe(1); // the green hot path was not slowed by a 2nd capture
});

test("stores derived signals only — no raw innerText blob, no full DOM (PII-minimization)", async ({
  page,
}) => {
  await page.goto(INDEX_URL);
  const store = new BaselineStore();
  const locator = page.locator('[data-testid="submit-btn"]');
  await locator.waitFor();

  const fp = await captureFingerprint(locator, DEFAULT_TEST_ID_ATTR);

  // The fingerprint is a flat, fixed set of derived fields. Assert the shape
  // is exactly the CAP-01 contract and nothing else leaks through (no html,
  // no innerHTML, no outerHTML, no raw children).
  const keys = Object.keys(fp).sort();
  expect(keys).toEqual(
    [
      "attrs",
      "neighbourSignature",
      "ordinal",
      "parentTag",
      "role",
      "tag",
      "testId",
      "text",
    ].sort(),
  );
  expect(fp).not.toHaveProperty("html");
  expect(fp).not.toHaveProperty("innerHTML");
  expect(fp).not.toHaveProperty("outerHTML");
  // text is normalized (collapsed), not a raw multi-line innerText blob.
  expect(fp.text).not.toMatch(/\n/);
});

test("findCandidates enumerates descriptors that each resolve uniquely", async ({
  page,
}) => {
  // On broken.html the original submit-btn is gone but the semantic button
  // survives (renamed to primary-action). Enumeration must surface it as a
  // candidate carrying a uniquely-resolving selector.
  await page.goto(BROKEN_URL);

  const fingerprint = {
    tag: "button",
    role: "button",
    text: "Submit",
    testId: "submit-btn",
    attrs: { type: "submit" },
    ordinal: 2,
    parentTag: "form",
    neighbourSignature: "",
  };

  const candidates = await findCandidates(page, fingerprint, DEFAULT_TEST_ID_ATTR);

  expect(candidates.length).toBeGreaterThan(0);

  // Every candidate carries a non-empty uniqueSelector that resolves to exactly
  // one element (the candidate-finder validated uniqueness in-browser).
  for (const c of candidates) {
    expect(c.uniqueSelector.length).toBeGreaterThan(0);
    expect(await page.locator(c.uniqueSelector).count()).toBe(1);
  }

  // The surviving semantic button must be among the candidates.
  const surviving = candidates.find((c) => c.text === "Submit" && c.role === "button");
  expect(surviving).toBeDefined();
});
