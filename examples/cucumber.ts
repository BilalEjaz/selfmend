// Recipe: selfmend with Cucumber (@cucumber/cucumber).
//
// Wires the runner-agnostic core into Cucumber's hook lifecycle. The page is
// created once per feature and wrapped once; scope() is keyed on two stable
// identifiers (the feature name and the scenario name) read live, so each
// scenario's locators key to a distinct baseline. resetScope is called in a
// Before hook so a same-scope retry restarts occurrence counting cleanly.
//
// This file is type-checked against the published selfmend API. The Cucumber
// symbols resolve through examples/shims/frameworks.d.ts at type-check time; an
// adopter installs @cucumber/cucumber, whose real types then replace the shim.

import {
  Before,
  BeforeAll,
  AfterAll,
  When,
  type SelfmendWorld,
} from "@cucumber/cucumber";
import { chromium, type Browser, type Page } from "@playwright/test";

import {
  wrapPage,
  resetScope,
  loadBaseline,
  saveBaseline,
  renderHealSummary,
  BaselineStore,
  type SelfmendEvent,
} from "selfmend";

const BASELINE_PATH = "./.selfmend/baseline.json";

// Shared across the whole feature run: one browser, one store loaded once, and
// one events array the AfterAll hook renders. createPage builds a fresh raw page
// per feature; the Before hook wraps it onto the World.
let browser: Browser;
let store: BaselineStore = new BaselineStore();
const events: SelfmendEvent[] = [];

async function createPage(): Promise<Page> {
  const context = await browser.newContext();
  return context.newPage();
}

// Load the committed baseline once before any scenario runs.
BeforeAll(async () => {
  browser = await chromium.launch();
  store = await loadBaseline(BASELINE_PATH);
});

// Per scenario: build a raw page, wrap it onto the World, and reset the
// occurrence scope. scope() reads this.featureName and this.scenarioName LIVE,
// so step definitions and page objects keep using this.page untouched.
Before(async function (this: SelfmendWorld) {
  const raw = await createPage();
  this.page = wrapPage(raw, {
    store,
    scope: () => ({ suite: this.featureName, test: this.scenarioName }),
    onHeal: (event) => {
      events.push(event);
    },
  });

  // resetScope makes a same-scope retry restart occurrence counting at zero.
  // It is a safe no-op on a page selfmend did not wrap, and omitting it only
  // risks a missed heal on retry, never a wrong heal.
  resetScope(this.page);
});

// A representative step. The wrapped page heals drifted locators above the
// confidence floor and replays; below the floor the step fails normally.
When("the user places the order", async function (this: SelfmendWorld) {
  const page = this.page;
  if (!page) throw new Error("page was not initialized in the Before hook");
  await page.getByRole("button", { name: "Place order" }).click();
});

// After the whole feature run: print the boxed heal summary from the collected
// events, save the refreshed baseline, and close the browser.
AfterAll(async () => {
  console.log(renderHealSummary(events));
  await saveBaseline(BASELINE_PATH, store);
  await browser.close();
});
