# Rebind Spike — FINDINGS (the contract plan 04 implements)

> THROWAWAY spike. `spike/` is deleted once plan 04 consumes this file. **This file is the durable output.**
>
> Verified against `@playwright/test@1.60.0`, Node 24.12, Chromium, on `tests/fixture-app/{index,broken}.html`.
> Run: `npx playwright test --config=spike/playwright.config.ts` -> **5 passed**.
>
> **VERDICT: the live-rebind mechanism is PROVEN exactly as 01-RESEARCH.md predicted.** Catch the real
> `TimeoutError`, rebind to a fresh `page.locator(newSelector)`, replay -> green. Chained locators re-wrap.
> Assertions never reach the heal path. The heal overhead is a tiny, bounded fraction of the real attempt.

---

## (a) TimeoutError detection idiom — copy into plan 04

Import `errors` from the host Playwright and test BOTH ways (belt-and-suspenders across minors):

```ts
import { errors } from "@playwright/test";

catch (err) {
  const isTimeout =
    err instanceof errors.TimeoutError ||
    (err as { name?: string })?.name === "TimeoutError";
  if (!isTimeout) throw err; // not a resolution failure -> propagate untouched
  // ...heal path...
}
```

- **Confirmed:** a wrapped `click()` on a selector that resolves on `index.html` but is renamed in
  `broken.html` (`[data-testid="submit-btn"]` renamed to `primary-action`) auto-waits to its full timeout
  and throws `errors.TimeoutError`. The catch fires **after** auto-wait by construction -> satisfies
  **HEAL-02 / D-10** (heal never fires on a transient poll miss). PROVEN by SANITY test: the same wrapper on
  the un-mutated baseline fires **zero** heals.
- **Do NOT** pre-check `count()` / `waitFor()` and branch (the `playwright-selfheal@1.0.9` mistake). Let the
  real action run to timeout.

## (b) Timeout-budget strategy — DECIDED, with measured numbers

**Decision: pass an explicit `{ timeout }` on the FIRST (real) attempt, and a SEPARATE short `{ timeout }`
on the replay.** Relying on config/testInfo defaults works but leaves the wall-clock unbounded and
un-measurable; an explicit two-budget split keeps total time bounded and observable.

Measured on PW 1.60 (PROOF 4, `[BUDGET]` log line):

| Segment | Configured | Measured |
|---|---|---|
| Real attempt (runs to timeout) | `1200 ms` | **1207 ms** |
| Heal enumeration + replay | `5000 ms` ceiling | **48 ms** actual |
| **Total wall-clock** | — | **1255 ms** |

- The heal (enumerate candidate, verify uniqueness, `page.locator(newSel)`, replay) costs **~48 ms** —
  roughly **4%** of the real attempt. Healing does not balloon the run (threat **T-03-03** mitigated).
- **Plan 04 production guidance:**
  - First attempt: respect the user's configured action/locator timeout (do **not** shorten it — that
    would change auto-wait semantics the user expects). The spike used an explicit 1200 ms only to make the
    split fast and measurable.
  - Replay: give it a **bounded, short** budget (a few seconds is ample; measured replay was 48 ms). Cap it
    so a flaky heal target cannot double the per-action wall-clock. A `replayTimeout` around the configured
    action timeout (or a smaller fixed cap) is safe; never unbounded.
  - Net upper bound per healed action is approximately `realTimeout + replayTimeout` (plus negligible
    scoring). Document this.

## (c) Method-set partition — the three sets plan 04 wires into the Locator Proxy

Wrap the **real** Locator (never an empty `{}`). The `get` trap routes by method name:

**ACTION set (intercept -> capture-on-success / heal-on-TimeoutError):**
```
click, fill, type, press, hover, check, uncheck, dblclick, tap,
selectOption, setInputFiles, focus, blur, dragTo, scrollIntoViewIfNeeded, waitFor
```

**CHAIN set (call real, then RE-WRAP the returned Locator so healing survives chaining):**
```
first, last, nth, filter, and, or, locator,
getByRole, getByText, getByLabel, getByTestId, getByPlaceholder, getByAltText, getByTitle
```

**ASSERTION exclusion (sacred — must NOT be in either set):** `expect(locator).toBeVisible()` /
`.toHaveText()` / etc. resolve through Playwright's **matcher** machinery (`expect`), not through the
Locator's action methods. PROOF 3 confirms: an `expect(wrapped).toBeVisible()` against a missing element
**fails normally and never invokes the heal hook** (`healAttempted === false`). Therefore plan 04 does NOT
need to special-case assertions — simply scoping the ACTION set to real action methods keeps assertions out
of the heal path by construction. (Threat **T-03-02** mitigated: assertions cannot be silently healed.)

- Everything else (properties, `page()`, `count`, `evaluate`, etc.): `return value.bind(target)` — pass
  through.
- PROOF 2 confirms chaining: `wrappedScope.getByRole('button',{name}).first()` returns a **re-wrapped** Proxy
  whose `click()` heals; strict-mode and auto-wait are intact; the healed element passes `toBeVisible()`.

## (d) Rebind selector-construction approach

- **You cannot turn an `ElementHandle` into a `Locator`** (PW issue #10571). Rebind MUST yield a fresh
  **selector string** and call `page.locator(newSelector)`. Confirmed: replay via
  `page.locator(newSel)[action](...)` goes green.
- Candidate-selector preference order (plan 04 enumeration + scorer produces these): **test-id -> stable
  attribute -> scoped `nth`**. (PROOF used the surviving `[data-testid="primary-action"]`.)
- **Uniqueness gate:** before accepting a candidate selector, verify `page.locator(candidate).count() === 1`.
  This prevents binding to an ambiguous match. Keep this check (the prior-art does it right) — but
  **acceptance is gated on the SCORE/floor, not on `count()===1` alone** (the prior-art's false-green hole).
  If `rebind()` returns `null` (no candidate clears uniqueness AND floor), **re-throw the original
  TimeoutError** -> the test fails normally (no false green). PROOF 3's negative path and the
  `rebind() -> null` branch confirm this re-throw shape.

## (e) Prior-art gotchas

- **`playwright-selfheal@1.0.9`** (read from npm tarball in 01-RESEARCH): proxies an **empty `{}`** and
  re-resolves on every call (loses the real Locator API + chaining), pre-checks `count()` before auto-wait
  (HEAL-02 violation -> flaky/false-green), and computes a heuristic score but **never gates** the return.
  Do NOT copy. Our wrapper inverts all three: wrap the real Locator, catch the real TimeoutError, gate on
  the floor.
- **`qosha1/healing-playwright`, `amrsa1/healwright`, `paulocoliveira/playwright-auto-heal`:** READMEs/source
  were **unreachable this session** (outbound WebFetch/curl blocked — see 01-RESEARCH Environment
  Availability). Their fixture+wrapper *shape* is corroborated by the one source we did read plus Playwright
  docs; the spike independently proves the mechanism works on PW 1.60, so reachability of these three is
  **not blocking**. If reachable later, sanity-check their gate/timing against our floor + post-timeout
  rules.

## Integration-config note for plan 04

The root `playwright.config.ts` pins `testDir: "tests"`, which excludes `spike/`. The spike therefore carries
its own `spike/playwright.config.ts` (`testDir: "."`). Plan 04's integration tests live under `tests/` and use
the root config — no change needed there. The spike config is deleted with `spike/`.
