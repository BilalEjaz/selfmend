# selfmend

> Self-healing Playwright locators that run **fully offline** inside your own CI. No API key, no telemetry, no false-green tests.

When a Playwright test fails *only* because a selector changed (not because your app is actually broken), `selfmend` matches the broken locator to the right element using heuristic signal-matching, rebinds it live so the test stays green, and prints a clear console summary of every heal. The entire healing path runs in your own CI. Nothing is ever sent to any external service.

- **Zero-friction install.** One line changes: swap your import.
- **Fully offline.** No network calls, no API keys, no telemetry. This is a hard guarantee, not a setting.
- **No false greens.** A heal only happens when `selfmend` is confident; otherwise the test fails normally.
- **Assertions are sacred.** Only locator *actions* (`click`, `fill`, and so on) heal. `expect(...)` is never routed through the heal path.

## Install

```bash
# npm
npm add -D selfmend

# pnpm
pnpm add -D selfmend
```

`@playwright/test` is a **peer dependency**, so `selfmend` uses *your* Playwright and never bundles its own. You already have it in a Playwright project:

```bash
npm add -D @playwright/test   # if you don't have it yet
```

Requires Node `>=22` and `@playwright/test >=1.42` (tested in CI against 1.42, 1.49, and 1.60).

## The one-line import swap

Change your test imports from `@playwright/test` to `selfmend`. That is the entire setup. Every test using this `test` becomes healing-aware, with no test rewrites.

```diff
- import { test, expect } from "@playwright/test";
+ import { test, expect } from "selfmend";

  test("checkout", async ({ page }) => {
    await page.goto("/checkout");
    await page.getByRole("button", { name: "Pay" }).click();
    await expect(page.getByTestId("status")).toHaveText("paid");
  });
```

Your existing `page`, locator, and `expect` usage is unchanged. On a passing run, `selfmend` fingerprints each resolved locator. When a selector later breaks, it scores the live candidates against that fingerprint and, only when it is confident enough, rebinds and replays so the run stays green.

`expect` is re-exported unchanged (it is literally `@playwright/test`'s `expect`), so the swap is genuinely one line.

## Add the end-of-run heal report

Add the reporter to your `playwright.config.ts` to get a boxed summary of every heal at the end of the run:

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  reporter: [
    ["list"],
    ["selfmend/reporter"],
  ],
});
```

At the end of a run with heals you'll see:

```
┌────────────────────────────────────────────────────────────────────┐
│ selfmend: 1 locator healed                                         │
│ checkout                                                           │
│   page.locator(.btn-primary) -> [data-testid="submit-btn"]  (1.00) │
└────────────────────────────────────────────────────────────────────┘
```

Each row shows the test name, the original (broken) selector, the healed target, and the confidence score. The reporter is **summary-only**: it reads heal events and prints them. It never heals (healing happens live in the worker fixture).

## Configuration

Healing is **on by default** once you swap the import. Tune it per project with `test.use`:

```ts
import { test } from "selfmend";
import type { SelfmendConfig } from "selfmend";

const config: SelfmendConfig = {
  enabled: true,     // turn healing off entirely (CFG-01)
  threshold: 0.9,    // confidence floor in [0, 1]
  margin: 0.05,      // how far ahead the best candidate must be
  testIdAttr: "data-testid", // attribute used for the test-id signal
};

test.use({ selfmendConfig: config });
```

| Option | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Master switch. `false` disables all healing; locators behave like stock Playwright. |
| `threshold` | `0.9` | Confidence floor. A heal is accepted only when the best candidate scores at or above this. Raising it is safer (heals less often, but is more sure when it does). |
| `margin` | `0.05` | How far ahead the best candidate must be over the runner-up. Stops `selfmend` healing to the wrong one of two look-alikes. Raising it is safer. |
| `testIdAttr` | `"data-testid"` | Attribute read for the test-id identity signal. |

These defaults are the single source of truth in `selfmend`'s zod config schema, so the table above mirrors them exactly.

### Understanding the two numbers (`threshold` and `margin`)

When a selector breaks, `selfmend` gives **every visible element a match score between 0 and 1** by comparing it to the fingerprint it captured for the original element (its text, role, `data-testid`, attributes, neighbours, and position). `0` means "nothing in common", `1` means "an exact match".

Two simple gates then decide whether to heal:

- **`threshold` (default `0.9`) is the confidence floor.** Read it as "only heal if I am at least 90% sure this is the same element." If the best candidate scores below it, `selfmend` does not heal.
- **`margin` (default `0.05`) is the lead the winner must have.** If the top two candidates score within `0.05` of each other (think two near-identical "Delete" buttons), `selfmend` can't safely tell them apart, so it refuses rather than risk healing to the wrong one.

A heal happens **only when both gates pass**. Worked examples:

| Best candidate | Runner-up | Floor check (`>= 0.9`) | Margin check (`gap >= 0.05`) | Result |
| --- | --- | --- | --- | --- |
| `0.95` | `0.40` | pass | pass (gap `0.55`) | **Heals** to the best candidate |
| `0.95` | `0.93` | pass | **fail** (gap `0.02`) | **Refuses** (ambiguous look-alikes); test fails normally |
| `0.70` | `0.10` | **fail** | n/a | **Refuses** (not confident); test fails normally |

Both numbers only ever make `selfmend` *more* cautious as you raise them. Lowering them heals more aggressively at the cost of the occasional wrong or uncertain match, which is exactly the false-green risk `selfmend` exists to avoid, so the conservative defaults are recommended.

### Environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `SELFMEND_PRUNE` | _unset (off)_ | Opt-in. When set, prunes orphaned baseline entries (locators no longer exercised), but **only** on a complete, fully-passed run. A filtered run (`--grep`, a single-file path, a shard, and so on) or any failure leaves the baseline untouched, so a partial run can never delete live entries. Off by default; the default path only ever refreshes and adds. |

## Composing with your own fixtures

If you already maintain your own `test.extend`, merge `selfmend`'s healing fixture instead of adopting the bare re-exported `test`:

```ts
import { healingFixture } from "selfmend";

export const test = healingFixture.extend<MyFixtures>({
  // ...your fixtures
});
```

## Using selfmend without @playwright/test

`wrapPage(rawPage, opts)` returns a wrapped page that is a drop-in for the
original, so your step definitions and page objects need no changes. You supply
the healing identity yourself with a `scope()` callback, read live each time a
locator is created, you load and save the baseline file yourself, and you collect
heals with an `onHeal` callback then print them with `renderHealSummary`. There is
no Playwright reporter in this mode, so it works under any framework that drives a
real Playwright `Page`: Cucumber, Mocha, Jest, or a plain script.

Each recipe below is a real file under `examples/`. The blocks here are kept
byte-identical to those files by a check (see `npm run check:readme`), so the code
you read is the code that is type-checked against the published API.

### Plain script

The simplest end-to-end wiring with no test runner: launch Chromium, wrap one
page, load the baseline, drive actions, print the summary, save the baseline.

```ts
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
```

This recipe shows the three pieces every recipe needs: the `scope()` wiring, the
baseline load and save, and the heal output via `renderHealSummary`.

### Cucumber

Create the page once per feature, wrap it onto the World in a `Before` hook so
step definitions stay untouched, and key `scope()` on the feature and scenario
names read live.

```ts
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
```

This recipe shows the three pieces every recipe needs: the `scope()` wiring, the
baseline load and save, and the heal output via `renderHealSummary`.

### Mocha / Jest

One file covers both runners because they share the `before` / `after` /
`beforeEach` hook names. Load the baseline once, wrap one long-lived page, and
update the live test name per test so `scope()` reads the current logical test.

```ts
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
```

This recipe shows the three pieces every recipe needs: the `scope()` wiring, the
baseline load and save, and the heal output via `renderHealSummary`.

### The never-false-green guarantee in raw mode

Raw mode inherits the exact same trust guarantee as the fixture mode, because the
heal decision lives in one pure core that every adapter calls:

- **The same two gates, in the same pure core.** A heal is accepted only when the
  top candidate clears the confidence floor (`threshold`, default `0.9`) **and**
  beats the runner-up by at least the absolute `margin` (default `0.05`). Both
  gates run in the pure `decide()` core, identical in fixture mode and raw mode,
  so every adapter inherits the never-false-green behaviour rather than
  reimplementing it.
- **A wrong or missing `scope()` key is a missed heal, never a wrong heal.** The
  baseline is keyed by `(suite, test)`. If `scope()` returns the wrong key, or no
  key was captured for it, the broken locator simply finds no stored fingerprint
  to match, so the locator fails normally. This is control-tested: a wrong or
  absent scope produces a missed heal, never a heal to the wrong element and never
  a false green.
- **A throwing or absent `scope()` / `onHeal` fails safe.** If `scope()` throws,
  selfmend falls back to a coarse default and the run proceeds; if `onHeal` throws
  or is absent, the error is swallowed and the heal still completes. Neither can
  break the run or change the heal decision.

### Honest limits

Sourced from the project's out-of-scope list, so an adopter is not surprised:

- **Page-level only this milestone.** `wrapPage` heals one Playwright `Page`. A
  popup or a new tab is a separate `Page`, so each needs its own `wrapPage`.
  Whole-`BrowserContext` wrapping (auto-wrapping every page) is a later add.
- **Playwright Pages only.** This works only with frameworks that drive a real
  Playwright `Page`. Cypress and Selenium use incompatible locator models and are
  out of scope.
- **Parallel runs keep per-worker baselines.** Each worker process keeps its own
  baseline. Merge them with `mergeBaselines(...)` in a single final step before
  saving, so two workers never fight over one file.
- **The v1 caveats still apply.** The occurrence-index drift on chained-locator
  calls (fail-safe: a missed heal, never a wrong one) and the
  `selectOption` / `setInputFiles` value-object replay edge case carry over
  unchanged. See the [Limitations](#limitations) section for the full text.

## How healing works, and the never-false-green trust model

1. **Capture on green.** On a passing run, every locator that resolves and acts
   successfully is fingerprinted from derived signals only (text, role, test-id,
   key attributes, neighbours, DOM position). Raw DOM and innerHTML never leave
   the browser and are never stored.
2. **Detect a real break.** Healing only ever triggers on a genuine
   `TimeoutError` from a locator *action* (`click`, `fill`, and so on), meaning
   the selector resolved to nothing. `selfmend` never pre-checks `count()` and
   never intercepts a passing locator.
3. **Score the live candidates.** The broken locator's captured fingerprint is
   scored against the live candidates using a weighted multi-signal scorer.
   Missing signals are skipped on both sides so they never dilute the score.
4. **Two gates, both must pass.** A heal is accepted **only when**:
   - the top candidate's score is at or above the confidence floor
     (`threshold`, default `0.9`), **and**
   - the top candidate beats the runner-up by at least the absolute `margin`
     (default `0.05`).

   If either gate fails (too uncertain, or two look-alike candidates within the
   margin), the match is refused.
5. **Heal or fail honestly.** When both gates pass, `selfmend` rebinds to the
   matched element via a fresh `page.locator(...)` and replays the action so the
   run stays green. When they don't, the original error is re-thrown and the
   test fails exactly as stock Playwright would. There is no force-green path.
6. **Assertions are sacred.** Only locator *actions* are routed through the heal
   path. `expect(...)` is never healed, rewritten, or retried by `selfmend`.
7. **The reporter only reports.** The `selfmend/reporter` runs in the main
   process, reads heal events, and prints the summary. It has no page or DOM
   access and cannot heal, so the heal and report trust boundaries are disjoint.

## Committed baseline workflow

`selfmend` stores fingerprints under `.selfmend/` in your repo:

- **`.selfmend/baseline.json` is committed.** It holds derived signals only (no
  raw DOM, no PII) and is written in a deterministic, byte-stable order, so
  heals persist across runs and across machines and every change is reviewable
  in a normal diff. Commit it like any other fixture.
- **`.selfmend/shards/` and `.selfmend/*.tmp` are transient, so gitignore them.**
  Each parallel worker writes its own shard during a run; the reporter merges
  them into `baseline.json` atomically at the end. They are per-run scratch
  output, not the committed contract.

A `.gitignore` that matches this workflow:

```gitignore
# commit the merged baseline; ignore transient per-worker output
/.selfmend/*
!/.selfmend/baseline.json
/.selfmend/shards/
/.selfmend/*.tmp
```

## Privacy & trust

- **Offline by construction, and verified.** Fingerprinting, scoring, and the
  baseline merge run entirely in-browser and in-process; nothing leaves your CI.
  There is no telemetry and no API key. This is proven by a network-block test
  that throws on any `net`, `http`, `https`, `dns`, `tls`, or `fetch` use and
  asserts a full capture and heal cycle completes with zero egress. The only
  runtime dependencies are `zod` and `picocolors`.
- **No false greens.** Below the confidence floor or inside the second-best
  margin, the original error is re-thrown and the test fails normally.
- **Locator healing only (v1).** Assertions are never healed or rewritten.
  `selfmend` proposes; it never silently changes what your test asserts.

## Limitations

`selfmend` is deliberately conservative. Known limitations in v1:

- **Locator healing only.** No assertion healing, no smart-wait insertion, and
  no LLM-based tiebreaker. Only locator *actions* heal.
- **Playwright only.** Requires `@playwright/test >=1.42` (tested in CI against
  1.42, 1.49, and 1.60). No other test framework is supported in v1.
- **Occurrence index is creation-order sensitive.** A locator's baseline key
  includes an occurrence index that counts chained-method invocations within a
  test. If the heal run takes a different code path than the capture run (a
  conditional that only fires when something is broken, a retry that re-invokes
  a chain, an early return), the occurrence indices can shift and the broken
  locator may not match its captured fingerprint. This is **fail-safe**: a
  missing key means no heal and the original error re-throws. It is a missed
  heal, never a mis-heal or a false green.
- **`selectOption` / `setInputFiles` value-object replay.** On the replay path
  (after a heal has already triggered), a value-object payload passed to
  `selectOption({ label })` or `setInputFiles({ name, mimeType, buffer })` gets a
  `timeout` key merged in. Playwright currently ignores the extra key, so there
  is no observed break, but it is a known latent edge case on the replay path.

## License

MIT
