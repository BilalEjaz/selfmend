# selfmend demo

A self-contained way to show the team what selfmend does, why it matters, and how it works. Pick the path that fits your audience.

## Run the live demo (about 30 seconds)

From the project root:

```
npm run demo
```

It builds the package, launches a real Chromium browser, and tells a three-act story against two tiny local web pages:

1. **Record.** A test passes on the current build. selfmend records what the elements look like, into a plain local JSON file. Nothing leaves the machine.
2. **Heal.** A "redesign" renames the button's CSS class. The old test would break. selfmend recognises the button by its identity and keeps the test green, then reports what it reconnected and how confident it was.
3. **Trust check.** A second element is genuinely removed. selfmend refuses to fake a pass. The test fails, honestly. No false green.

You can run it as many times as you like; it cleans up after itself.

## Read the explainers

- **[for-stakeholders.md](./for-stakeholders.md)** for managers, product, and anyone non-technical. Plain English: the problem, the value, the safety guarantee, the cost (none) and where the data goes (nowhere). No code.
- **[for-testers.md](./for-testers.md)** for junior QA and test engineers. How to use it, the heal lifecycle step by step, how to read the output, and a tour of what every part of the code does and why.

## What is in this folder

| File | What it is |
| --- | --- |
| `run-demo.mjs` | The narrated live demo. Uses only the real public selfmend API (`wrapPage`, `BaselineStore`, `loadBaseline`, `saveBaseline`, `renderHealSummary`). |
| `pages/checkout-before.html` | The "current build" page. The button uses the class `.btn-primary`. |
| `pages/checkout-after.html` | The "redesigned build" page. The same button, class renamed to `.cta`; the promo link removed. |
| `for-stakeholders.md` | Non-technical one-pager. |
| `for-testers.md` | Technical walkthrough and code map. |

## Suggested way to present it

1. Open with **for-stakeholders.md** (or just talk through it) so the room understands the problem and the promise.
2. Run `npm run demo` live. Narrate the three acts. Pause on the final report, point at the heal (green, with a confidence score) and the refusal (it would not fake it).
3. For the testers in the room, walk **for-testers.md**: the two-line setup, the lifecycle, and the code map. Then run `npm run test:e2e` to show the real regression suite, including the no-false-green control.

The one line to leave them with: selfmend keeps the suite green through harmless selector churn, and it never, ever hides a real failure.
