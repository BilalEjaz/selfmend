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
  threshold: 0.9,    // conservative confidence floor in [0, 1]
  margin: 0.05,      // absolute gap the top candidate must beat the runner-up by
  testIdAttr: "data-testid", // attribute used for the test-id signal
};

test.use({ selfmendConfig: config });
```

| Option | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Master switch. `false` disables all healing; locators behave like stock Playwright. |
| `threshold` | `0.9` | Confidence floor in `[0, 1]`. A heal is accepted only at or above this score; below it the test fails normally — no false green. Raising it is safer (refuses more). |
| `margin` | `0.05` | Second-best margin gate in `[0, 1]`. The top candidate must beat the runner-up by at least this absolute gap, or the match is refused as ambiguous. Raising it is safer. |
| `testIdAttr` | `"data-testid"` | Attribute read for the test-id identity signal. |

These defaults are the single source of truth in `selfmend`'s zod config schema — the table above mirrors them exactly.

### Environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `SELFMEND_PRUNE` | _unset (off)_ | Opt-in. When set, prunes orphaned baseline entries (locators no longer exercised) — but **only** on a complete, fully-passed run. A filtered run (`--grep`, a single-file path, a shard, etc.) or any failure leaves the baseline untouched, so a partial run can never delete live entries. Off by default; the default path only ever refreshes and adds. |

## Composing with your own fixtures

If you already maintain your own `test.extend`, merge `selfmend`'s healing fixture instead of adopting the bare re-exported `test`:

```ts
import { healingFixture } from "selfmend";

export const test = healingFixture.extend<MyFixtures>({
  // ...your fixtures
});
```

## How healing works — and the never-false-green trust model

1. **Capture on green.** On a passing run, every locator that resolves and acts
   successfully is fingerprinted from derived signals only (text, role, test-id,
   key attributes, neighbours, DOM position). Raw DOM and innerHTML never leave
   the browser and are never stored.
2. **Detect a real break.** Healing only ever triggers on a genuine
   `TimeoutError` from a locator *action* (`click`, `fill`, …) — i.e. the
   selector resolved to nothing. `selfmend` never pre-checks `count()` and never
   intercepts a passing locator.
3. **Score the live candidates.** The broken locator's captured fingerprint is
   scored against the live candidates using a weighted multi-signal scorer.
   Missing signals are skipped on both sides so they never dilute the score.
4. **Two gates, both must pass.** A heal is accepted **only when**:
   - the top candidate's score is at or above the confidence floor
     (`threshold`, default `0.9`), **and**
   - the top candidate beats the runner-up by at least the absolute `margin`
     (default `0.05`).

   If either gate fails — too uncertain, or two look-alike candidates within the
   margin — the match is refused.
5. **Heal or fail honestly.** When both gates pass, `selfmend` rebinds to the
   matched element via a fresh `page.locator(...)` and replays the action so the
   run stays green. **When they don't, the original error is re-thrown and the
   test fails exactly as stock Playwright would.** There is no force-green path.
6. **Assertions are sacred.** Only locator *actions* are routed through the heal
   path. `expect(...)` is never healed, rewritten, or retried by `selfmend`.
7. **The reporter only reports.** The `selfmend/reporter` runs in the main
   process, reads heal events, and prints the summary. It has no page or DOM
   access and cannot heal — the heal/report trust boundaries are disjoint.

## Committed baseline workflow

`selfmend` stores fingerprints under `.selfmend/` in your repo:

- **`.selfmend/baseline.json` is committed.** It holds derived signals only (no
  raw DOM, no PII) and is written in a deterministic, byte-stable order, so
  heals persist across runs and across machines and every change is reviewable
  in a normal diff. Commit it like any other fixture.
- **`.selfmend/shards/` and `.selfmend/*.tmp` are transient — gitignore them.**
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
  that throws on any `net`/`http`/`https`/`dns`/`tls`/`fetch` use and asserts a
  full capture + heal cycle completes with zero egress. The only runtime
  dependencies are `zod` and `picocolors`.
- **No false greens.** Below the confidence floor or inside the second-best
  margin, the original error is re-thrown and the test fails normally.
- **Locator healing only (v1).** Assertions are never healed or rewritten.
  `selfmend` proposes — it never silently changes what your test asserts.

## Limitations

`selfmend` is deliberately conservative. Known limitations in v1:

- **Locator healing only.** No assertion healing, no smart-wait insertion, and
  no LLM-based tiebreaker. Only locator *actions* heal.
- **Playwright only.** Requires `@playwright/test >=1.42` (tested against 1.60).
  No other test framework is supported in v1.
- **Occurrence index is creation-order sensitive.** A locator's baseline key
  includes an occurrence index that counts chained-method invocations within a
  test. If the heal run takes a different code path than the capture run (a
  conditional that only fires when something is broken, a retry that re-invokes
  a chain, an early return), the occurrence indices can shift and the broken
  locator may not match its captured fingerprint. This is **fail-safe**: a
  missing key means no heal and the original error re-throws — it is a missed
  heal, never a mis-heal or a false green.
- **`selectOption` / `setInputFiles` value-object replay.** On the replay path
  (after a heal has already triggered), a value-object payload passed to
  `selectOption({ label })` or `setInputFiles({ name, mimeType, buffer })` gets a
  `timeout` key merged in. Playwright currently ignores the extra key, so there
  is no observed break, but it is a known latent edge case on the replay path.

## License

MIT
