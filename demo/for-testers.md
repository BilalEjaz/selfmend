# selfmend for testers

*For junior QA and test engineers who write Playwright tests. Explains how to use it, what happens under the hood, and what every part of the code is for and why.*

## What it is, in one paragraph

selfmend is a Playwright add-on. When your tests pass, it records a "fingerprint" of each element your locators resolve to. Later, when a selector breaks because the page changed (but the element is still really there), selfmend recognises the element by its fingerprint, reconnects your locator to it, and lets the test continue. It only does this when it is very confident; otherwise the test fails normally. It then prints a summary of what it healed and what it could not. Everything runs locally and offline.

## Run the demo first

From the project root:

```
npm run demo
```

Watch the three acts (record, heal, refuse). Then come back here. The rest of this doc explains what you just saw.

## How you use it (two ways)

### A) If you use the `@playwright/test` runner

Swap the test import. That is it. Your existing `page` and locator code does not change.

```ts
// before
import { test, expect } from "@playwright/test";

// after
import { test, expect } from "selfmend";
```

Every `page.locator(...)` is now healing-aware. Write tests exactly as you do today.

### B) If you use another framework (Cucumber, Mocha, Jest, a plain script)

Wrap the page once, where you create it, and tell selfmend which logical test you are in:

```ts
import { wrapPage } from "selfmend";

this.page = wrapPage(rawPage, {
  store,                                   // the baseline (see below)
  scope: () => ({ suite: featureName, test: scenarioName }),
});
```

`scope()` gives each element a stable identity (which feature, which scenario) so the right fingerprint is matched on a later run. After that, use `this.page.locator(...)` as normal.

## What actually happens, step by step

This is the heal lifecycle. It is worth understanding because the demo output maps directly onto it.

1. **Capture (on a passing action).** Your test resolves a locator and the action succeeds (a click, a fill). selfmend reads that element's identity signals in one quick call and stores them: visible text, role, `data-testid`, a few stable attributes, its position among siblings, and its immediate neighbours. This is the fingerprint. It is saved to a plain JSON file (the baseline).

2. **A selector breaks (later run).** Someone renamed a class, moved a node, restructured a component. Your locator now matches nothing. Playwright auto-waits and then times out, exactly as it always would.

3. **Score the candidates.** Only after that real timeout, selfmend looks at the elements on the page and scores each one against the stored fingerprint using weighted signals (text and test-id count for a lot, a class does not). It finds the best match and the second best.

4. **Two gates decide.** selfmend heals ONLY if both are true:
   - the best score clears a confidence **floor** (default 0.9), and
   - the best beats the second best by a clear **margin** (so two look-alikes can never be confidently picked).
   If either gate fails, selfmend does nothing and your original error is re-thrown. The test fails normally. This is the no-false-green rule.

5. **Heal.** If both gates pass, selfmend rebinds your locator to the matched element and replays your action. The test continues, green. It records what it healed.

6. **Report.** At the end of the run you get a boxed summary: which locators healed (old selector, new target, confidence score) and which could not heal (and why).

## Reading the demo output

You saw two boxes at the end of the demo:

```
selfmend: 1 locator healed
  checkout
    page.locator(.btn-primary) -> [data-testid="place-order"]  (0.97)
```

That says: in the logical test "checkout", the locator `.btn-primary` broke, and selfmend reconnected it to the button now best identified by `[data-testid="place-order"]`, with 0.97 confidence (well above the 0.9 floor). Green.

```
selfmend: 1 locator could NOT heal
  checkout
    page.locator(.promo-link) x no-candidates  (best n/a)
```

That says: `.promo-link` broke, and there was nothing on the page that matched its fingerprint, so selfmend refused to heal and let the test fail. `no-candidates` is the reason; `best n/a` means there was not even a candidate to score. This is selfmend working correctly: the element was genuinely removed, so faking a pass would have been a lie.

## What is where in the code, and why

A quick tour of `src/`. The design has one big idea: the part that decides "heal or not" is kept pure and separate, so the safety guarantee is easy to read and trust.

| Folder / file | What it does | Why it is there |
| --- | --- | --- |
| `src/matching/scoring.ts` | Given a stored fingerprint and a candidate element, returns a similarity score. | This is the "how alike are these two things" maths. Pure, deterministic, no browser. |
| `src/matching/decision.ts` | The `decide()` function: applies the floor and the margin gates and returns heal / do-not-heal. | This is the no-false-green guarantee in one small, readable place. If you only read one file, read this. |
| `src/matching/types.ts` | The data shapes (fingerprint, candidate, decision). | Shared vocabulary for the pure core. |
| `src/fingerprint/capture.ts` | Reads an element's identity signals in one in-browser call. | Derived signals only (text, role, test-id, position). Never screenshots or raw HTML, for privacy. |
| `src/integration/locator-proxy.ts` | Wraps each locator. Runs your real action; on a timeout, runs the decision and heals or re-throws; captures on success. | This is the bridge between your test and the pure brain. The actual "try, catch, score, replay" loop lives here. |
| `src/integration/wrap-page.ts` | The public `wrapPage(page, opts)` entry for any framework. | Lets Cucumber / Mocha / Jest / scripts use selfmend without the Playwright test runner. |
| `src/integration/fixture.ts` | The `@playwright/test` healing fixture (the `import { test } from "selfmend"` path). | The drop-in path for teams already on the Playwright runner. It is a thin adapter over the same core as `wrapPage`. |
| `src/store/` | Load, save, and merge the baseline JSON file, safely even when tests run in parallel. | The fingerprints have to persist across runs and not corrupt each other. |
| `src/reporter/` | Builds the end-of-run boxed summary. | So a run tells you, honestly and clearly, what it healed and what it did not. |
| `src/config/` | The settings: on/off, the confidence floor, the margin, the test-id attribute name. | So a team can tune how cautious selfmend is. |

The key thing to notice: `src/matching/` knows nothing about Playwright, files, or your tests. It is just "score these, apply the gates." That is deliberate. The promise "never fake a pass" lives in a tiny pure function you can read in a minute, not scattered through browser glue.

## The golden rule for testers

selfmend is a safety net for selector churn, not an excuse for sloppy selectors.

- Still prefer stable selectors (a `data-testid`) when you write tests.
- When selfmend heals something, treat the report as a friendly to-do: go update that selector when you get a chance. A heal is a heads-up that a selector drifted, not a licence to ignore it forever.
- selfmend buys you time and keeps the build green through the churn. It does not replace good test hygiene.

## Try more

- `npm run demo` runs the story end to end.
- `npm run test:e2e` runs the real Playwright test suite, including the actual heal proof and the no-false-green control, against a local file fixture.
- Open `demo/run-demo.mjs` to see exactly which public functions are called and in what order. It uses only the real published API.
