// Recipe: selfmend with Mocha or Jest.
//
// One file covers both runners because they share the before / after /
// beforeEach / describe / it hook names. Wire the runner-agnostic core into the
// hook lifecycle: load the baseline once in before(), wrap one long-lived raw
// page and update the live (suite, test) identity per test in beforeEach(), then
// print the heal summary and save the baseline in after().
//
// This file is type-checked against the published selfmend API. The hook symbols
// resolve through examples/shims/frameworks.d.ts at type-check time; an adopter
// using the real Mocha or Jest gets those globals from the runner itself.

import { chromium, type Browser, type Page } from "@playwright/test";

import {
  wrapPage,
  loadBaseline,
  saveBaseline,
  mergeBaselines,
  renderHealSummary,
  BaselineStore,
  type SelfmendEvent,
} from "selfmend";

const BASELINE_PATH = "./.selfmend/baseline.json";

describe("checkout", () => {
  let browser: Browser;
  let store: BaselineStore = new BaselineStore();
  let page: Page;
  const events: SelfmendEvent[] = [];

  // The suite name is stable; the test name updates per test so scope() reads
  // the current logical test live. NEVER derive these from the page URL.
  const suiteName = "checkout";
  let currentTestName = "";

  before(async () => {
    browser = await chromium.launch();
    store = await loadBaseline(BASELINE_PATH);
    const context = await browser.newContext();
    const raw = await context.newPage();
    page = wrapPage(raw, {
      store,
      scope: () => ({ suite: suiteName, test: currentTestName }),
      onHeal: (event) => {
        events.push(event);
      },
    });
  });

  beforeEach(() => {
    // Point scope() at the test about to run. With Mocha set this from
    // this.currentTest?.title; with Jest from expect.getState().currentTestName.
    currentTestName = "places the order";
  });

  it("places the order", async () => {
    await page.getByRole("button", { name: "Place order" }).click();
  });

  after(async () => {
    console.log(renderHealSummary(events));
    await saveBaseline(BASELINE_PATH, store);
    await browser.close();
  });
});

// Parallel workers note. Mocha and Jest run files in separate worker processes,
// and each worker keeps its OWN BaselineStore, so a single shared store is not
// visible across workers. To persist one merged baseline, collect each worker's
// store (for example by having each worker saveBaseline to its own shard path)
// and merge them deterministically in a final, single-process step before the
// one authoritative save:
//
//   const workerStoreA = await loadBaseline("./.selfmend/shard-0.json");
//   const workerStoreB = await loadBaseline("./.selfmend/shard-1.json");
//   const merged = mergeBaselines(workerStoreA, workerStoreB);
//   await saveBaseline(BASELINE_PATH, merged);
//
// mergeBaselines is order-independent: the result is the same regardless of the
// order the worker stores are passed in.
export async function mergeWorkerBaselines(
  workerStoreA: BaselineStore,
  workerStoreB: BaselineStore,
): Promise<void> {
  const merged = mergeBaselines(workerStoreA, workerStoreB);
  await saveBaseline(BASELINE_PATH, merged);
}
