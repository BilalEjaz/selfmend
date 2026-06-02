/**
 * STORE-01 Success Criterion 1, proven end-to-end in RAW mode: a baseline saved
 * on one run via the public saveBaseline(path, store) is loaded on a later run
 * via loadBaseline(path) into a FRESH store, and a broken locator heals off that
 * loaded file ALONE, with no reporter and no shards directory anywhere.
 *
 * This is the standalone-persistence proof: unlike tests/parallel/crossrun
 * (which exercises the reporter + shard machinery), this spec uses ONLY the
 * public wrapPage + loadBaseline/saveBaseline surface a raw-framework adopter
 * touches. The two runs share a single per-test temp FILE path the test owns, so
 * the repo's real .selfmend is never read or written.
 *
 * Run 1 (capture + save): wrap a raw Chromium page with a fresh BaselineStore
 * and a fixed scope, resolve the Submit button via its volatile .btn-primary
 * class so the store captures its fingerprint under key K, then
 * saveBaseline(tmpFile, store).
 *
 * Run 2 (load + heal off the file alone): loadBaseline(tmpFile) into a FRESH
 * store (no carryover from run 1's in-memory store), wrap a NEW raw page with
 * that store and the SAME scope, navigate to broken.html where .btn-primary is
 * gone, and click the broken locator. Same selector + occurrence -> same key K
 * -> the loaded fingerprint is the heal target, the action replays green, and
 * onHeal receives exactly one kind:"healed" event naming the stable Submit
 * button. No SelfmendReporter is registered and no shards dir is created.
 *
 * The never-false-green invariant is honored: this asserts a POSITIVE heal off
 * the loaded file; there is no force-green path.
 */
import { test, expect, chromium, type Browser } from "@playwright/test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve, join } from "node:path";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";

import { wrapPage } from "../src/integration/wrap-page.js";
import { BaselineStore } from "../src/store/store.js";
import { loadBaseline, saveBaseline } from "../src/store/persistence.js";
import type { SelfmendEvent } from "../src/integration/events.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const INDEX_URL = pathToFileURL(resolve(HERE, "./fixture-app/index.html")).href;
const BROKEN_URL = pathToFileURL(resolve(HERE, "./fixture-app/broken.html")).href;

// One launched Chromium for the whole spec, closed in teardown. Each run opens
// its OWN context+page so run 1 and run 2 stay isolated (no fixture page used).
let browser: Browser;

test.beforeAll(async () => {
  browser = await chromium.launch();
});

test.afterAll(async () => {
  await browser.close();
});

// A stable scope shared by capture (run 1) and heal (run 2) so the identity key
// is byte-identical across the save/reload boundary.
const SCOPE = { suite: "standalone-store.spec.ts", test: "save then reload heal" };

test("STORE-01: a heal works on a later run from the saved file ALONE (save run 1, loadBaseline run 2)", async () => {
  // A per-test temp DIRECTORY holding the consumer's own baseline file path. The
  // repo's real .selfmend is never touched.
  const dir = await mkdtemp(join(tmpdir(), "selfmend-standalone-"));
  const baselineFile = join(dir, "my-baseline.json");

  try {
    // ---- Run 1: capture under SCOPE, then saveBaseline to the file path. ----
    const captureStore = new BaselineStore();
    const ctx1 = await browser.newContext();
    const raw1 = await ctx1.newPage();
    const page1 = wrapPage(raw1, {
      store: captureStore,
      scope: () => SCOPE,
    });

    await page1.goto(INDEX_URL);
    // Resolving the Submit button via its volatile class captures its fingerprint
    // under key K = (suite, test, ".btn-primary", occurrence 0).
    await page1.locator(".btn-primary").waitFor();
    expect(captureStore.size).toBeGreaterThanOrEqual(1);

    await saveBaseline(baselineFile, captureStore);
    await ctx1.close();

    // ---- Run 2: loadBaseline the file into a FRESH store, heal off it alone. ----
    const loadedStore = await loadBaseline(baselineFile);
    // The loaded store carries the captured baseline, decoupled from run 1's
    // in-memory store (which is now discarded with its context).
    expect(loadedStore.size).toBeGreaterThanOrEqual(1);

    const events: SelfmendEvent[] = [];
    const ctx2 = await browser.newContext();
    const raw2 = await ctx2.newPage();
    const page2 = wrapPage(raw2, {
      store: loadedStore,
      onHeal: (e) => events.push(e),
      // The SAME scope, so the broken locator keys to the SAME identity K and
      // finds the loaded fingerprint as its heal target.
      scope: () => SCOPE,
    });

    // On broken.html the .btn-primary class is gone. The real click times out,
    // the heal loop scores candidates against the LOADED fingerprint at key K,
    // and the surviving Submit button (identity intact, above the 0.9 floor)
    // replays green off the saved file alone.
    await page2.goto(BROKEN_URL);
    await page2.locator(".btn-primary").click({ timeout: 1500 });

    const healed = page2.locator('[data-testid="submit-btn"]');
    await expect(healed).toHaveText("Submit");

    // Exactly one healed event off the loaded file, naming the stable target.
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe("healed");
    const healedEvent = events[0] as Extract<SelfmendEvent, { kind?: "healed" }>;
    expect(healedEvent.originalSelector).toContain(".btn-primary");
    expect(healedEvent.healedTarget).toContain("submit-btn");
    expect(healedEvent.score).toBeGreaterThanOrEqual(0.9);

    // No shards directory was created anywhere under the temp dir: this heal came
    // from the committed FILE alone, not from the reporter/shard machinery.
    const entries = await readdir(dir);
    expect(entries).not.toContain("shards");
    expect(entries).not.toContain(".selfmend");

    await ctx2.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
