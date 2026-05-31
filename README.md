# selfmend

> Self-healing Playwright locators that run **fully offline** inside your own CI — no API key, no telemetry, no false-green tests.

When a Playwright test fails *only* because a selector changed (not because your app is actually broken), `selfmend` matches the broken locator to the right element using heuristic signal-matching, rebinds it live so the test stays green, and prints a clear console summary of every heal. The entire healing path runs in your own CI — nothing is ever sent to any external service.

- **Zero-friction install.** One line changes: swap your import.
- **Fully offline.** No network calls, no API keys, no telemetry. This is a hard guarantee, not a setting.
- **No false greens.** A heal only happens above a conservative confidence floor; otherwise the test fails normally.
- **Assertions are sacred.** Only locator *actions* (`click`, `fill`, …) heal — `expect(...)` is never routed through the heal path.

## Install

```bash
# npm
npm add -D selfmend

# pnpm
pnpm add -D selfmend
```

`@playwright/test` is a **peer dependency** — `selfmend` uses *your* Playwright, it never bundles its own. You already have it in a Playwright project:

```bash
npm add -D @playwright/test   # if you don't have it yet
```

Requires Node `>=22` and `@playwright/test >=1.42` (tested against 1.60).

## The one-line import swap

Change your test imports from `@playwright/test` to `selfmend`. That's the entire setup — every test using this `test` becomes healing-aware, with no test rewrites.

```diff
- import { test, expect } from "@playwright/test";
+ import { test, expect } from "selfmend";

  test("checkout", async ({ page }) => {
    await page.goto("/checkout");
    await page.getByRole("button", { name: "Pay" }).click();
    await expect(page.getByTestId("status")).toHaveText("paid");
  });
```

Your existing `page` / locator / `expect` usage is unchanged. On a passing run, `selfmend` fingerprints each resolved locator. When a selector later breaks, it scores the live candidates against that fingerprint and — only above the confidence floor — rebinds and replays so the run stays green.

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
┌───────────────────────────────────────────────────────────────────┐
│ selfmend: 1 locator healed                                        │
│ checkout                                                          │
│   page.locator(.btn-primary) -> [data-testid="submit-btn"]  (1.00)│
└───────────────────────────────────────────────────────────────────┘
```

Each row shows the test name, the original (broken) selector, the healed target, and the confidence score. The reporter is **summary-only**: it reads heal events and prints them, it never heals (healing happens live in the worker fixture).

## Configuration

Healing is **on by default** once you swap the import. Tune it per project with `test.use`:

```ts
import { test } from "selfmend";
import type { SelfmendConfig } from "selfmend";

const config: SelfmendConfig = {
  enabled: true,     // turn healing off entirely (CFG-01)
  threshold: 0.9,    // conservative confidence floor in [0, 1] (D-09)
  testIdAttr: "data-testid", // attribute used for the test-id signal
};

test.use({ selfmendConfig: config });
```

| Option | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Master switch. `false` disables all healing; locators behave like stock Playwright. |
| `threshold` | `0.9` | Minimum confidence to accept a heal. Below this, the test fails normally — no false green. |
| `testIdAttr` | `"data-testid"` | Attribute read for the test-id identity signal. |

## Composing with your own fixtures

If you already maintain your own `test.extend`, merge `selfmend`'s healing fixture instead of adopting the bare re-exported `test`:

```ts
import { healingFixture } from "selfmend";

export const test = healingFixture.extend<MyFixtures>({
  // ...your fixtures
});
```

## Privacy & trust

- **Offline by construction.** Fingerprinting and scoring run in-browser and in-process; nothing leaves your CI. There is no telemetry and no API key.
- **No false greens.** Below the confidence floor, the original error is re-thrown and the test fails normally.
- **Locator healing only (v1).** Assertions are never healed or rewritten. `selfmend` proposes — it never silently changes what your test asserts.

## License

MIT
