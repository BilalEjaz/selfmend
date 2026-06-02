// Recipe: selfmend in a plain Node script (no test runner).
//
// The simplest end-to-end wiring of the runner-agnostic core. Launch a real
// Chromium, wrap one raw Page with wrapPage, load a baseline at the start, drive
// real locator actions, then print the heal summary and save the baseline at the
// end. This file is type-checked against the published selfmend API; it does not
// need to be executed to prove the recipe compiles.

import { chromium, type Page } from "@playwright/test";

import {
  wrapPage,
  loadBaseline,
  saveBaseline,
  renderHealSummary,
  type SelfmendEvent,
} from "selfmend";

// The baseline file this script owns. selfmend never reaches outside this path:
// it loads it at the start of the run and saves the refreshed store at the end.
const BASELINE_PATH = "./.selfmend/baseline.json";

async function main(): Promise<void> {
  // Load the committed baseline into a store. On the very first run the file may
  // not exist yet; loadBaseline returns a fresh empty store in that case, so the
  // first run captures fingerprints and later runs heal against them.
  const store = await loadBaseline(BASELINE_PATH);

  // Collect every heal event for the end-of-run summary. onHeal receives the
  // full SelfmendEvent union (healed and refused), fire-and-forget.
  const events: SelfmendEvent[] = [];

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    const raw = await context.newPage();

    // Wrap the raw page once. scope() returns the (suite, test) identity, read
    // live per locator creation. In a plain script there is no runner to ask, so
    // we pass a stable literal identity. NEVER derive scope from the page URL.
    const page: Page = wrapPage(raw, {
      store,
      scope: () => ({ suite: "smoke", test: "checkout" }),
      onHeal: (event) => {
        events.push(event);
      },
    });

    // Drive real locator actions through the wrapped page. If a selector has
    // drifted since the baseline was captured, selfmend heals it above the
    // confidence floor and replays; below the floor it fails normally.
    await page.goto("https://example.com/checkout");
    await page.getByRole("button", { name: "Place order" }).click();

    await context.close();
  } finally {
    await browser.close();
  }

  // Print the same boxed summary the @playwright/test reporter prints, built
  // from the collected events with no reporter involved.
  console.log(renderHealSummary(events));

  // Save the refreshed baseline. saveBaseline is refresh-and-add only: it never
  // prunes, so a locator not exercised this run keeps its stored fingerprint.
  await saveBaseline(BASELINE_PATH, store);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
