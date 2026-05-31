# Phase 1: Thinnest Real Heal - Research

**Researched:** 2026-05-31
**Domain:** Playwright plugin integration seam — live locator wrap + post-timeout rebind, fingerprint capture, pure scorer, boxed console reporter, dual ESM/CJS package skeleton
**Confidence:** HIGH on integration mechanics and APIs (verified against Playwright docs + prior-art source); MEDIUM on exact default threshold number (calibrated in Phase 2)

## Summary

The riskiest unknown — the live locator-rebind hook — is **PROVEN achievable on public, supported Playwright surfaces, and a short throwaway spike is still recommended** to lock the exact failure-detection timing before the integration tasks are written. The mechanism: a `test.extend` fixture overrides the built-in `page` fixture and returns a `Proxy`-wrapped `page` whose locator factory (`page.locator`, `getByRole`, `getByTestId`, and the other `getBy*`) returns `Proxy`-wrapped Locators. The wrapper intercepts the action methods (`click`, `fill`, etc.). On success it captures a fingerprint; on a genuine `TimeoutError` it runs the pure scorer against live DOM candidates and, if the top candidate clears the conservative floor, rebinds by constructing a **fresh `page.locator(newSelector)`** from the matched candidate and replays the action. This is the same shape every credible OSS prior-art uses, and it is the only surface with live DOM access inside the worker.

Two hard mechanical facts shape the design and must be honored in planning. **(1) You cannot reconstruct a `Locator` from an `ElementHandle`** (confirmed; Playwright issue #10571 still open). Rebind therefore produces a fresh *selector string* (a uniquely-identifying attribute / test-id / `nth`-index) from the winning candidate and calls `page.locator()` — it does not wrap a handle. **(2) Healing must fire only after the action's real `TimeoutError`, never on a poll miss.** The prior-art `playwright-selfheal@1.0.9` violates exactly this (it calls `locator.count()` and branches *before* letting Playwright auto-wait), which makes it both flaky and false-green-prone — it has no confidence floor and no margin gate, returning the first candidate where `count()===1`. Our design inverts this: let the real action run to its timeout, catch `TimeoutError`, then heal.

**Primary recommendation:** Build Phase 1 in dependency order — package skeleton + config schema first, then the pure Playwright-free scorer (TDD), then the single-worker in-process baseline store, then the capture + candidate-finder `page.evaluate` payloads, then the locator-proxy + fixture that wires the heal loop catching `TimeoutError`, then the boxed reporter. Run a ~1-day throwaway rebind spike against Playwright 1.60 *before* writing the integration tasks to confirm the catch-and-replay timing on a real mutated-selector fixture.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Package is named `selfmend` (verified available on npm 2026-05-31). Supersedes "Playwright SelfHeal" working name. `playwright-selfheal` rejected (taken; v1.0.9 is prior art / competitor).
- **D-02:** Public import path is `selfmend`. Primary usage: `import { test } from 'selfmend'`.
- **D-03:** Enablement is via import-swap: developer changes import from `@playwright/test` to `selfmend`, which re-exports a `test` extended with the healing fixture. Healing applies to every test using that `test` object. (Idiomatic `test.extend` + wrapped-locator-factory.)
- **D-04:** Also provide a composable fixture export so teams with their own `test.extend` can merge selfmend's healing fixture into existing fixtures rather than being forced onto the bare re-exported `test`.
- **D-05:** Reporter is summary-only (end-of-run output); it does NOT perform healing. Live healing happens in the worker via the fixture. Monkey-patching Playwright internals is rejected.
- **D-06:** v1 output is a boxed summary block at end of run: header like `selfmend: N locators healed`, then indented rows showing test name, original selector, healed target, confidence score. Scannable, clearly attributable to the plugin, reads as a visible audit trail.
- **D-07:** Phase 2 extends the report (healed vs failed-to-heal, runner-up margin); Phase 1 ships the healed-rows view.
- **D-08:** Healing is ON by default once import-swapped; disable via config (CFG-01). Lowest-friction "it just works."
- **D-09:** Ship a conservative / high-confidence posture (default threshold around 0.9). Heal only when very confident; prefer leaving a locator unhealed over healing wrong. Exact number calibrated from literature (Similo, Healenium) and benchmarks, but posture is "lean safe."
- **D-10:** Healing must trigger only after Playwright's normal auto-wait/timeout, never on a transient poll miss (HEAL-02).

### Claude's Discretion
- Internal architecture of the pure scorer, fingerprint serialization format, candidate enumeration mechanism, baseline store shape for the single-worker case, and config schema details. Keep scoring + heal-decision logic pure (Playwright-free) and built test-first per the project's TDD default.

### Deferred Ideas (OUT OF SCOPE for Phase 1)
- Distinguishing healed vs failed-to-heal in the report and showing second-best margin: Phase 2 (REP-02, MATCH-03).
- Cross-run persistence and parallel-worker-safe baseline store: Phase 3 (CAP-02, CAP-03). Phase 1 may use the simplest in-process/single-worker baseline that proves the loop.
- Configurable floor and margin: Phase 2 (CFG-02). Phase 1 ships the conservative default only.
- LLM tiebreaker, assertion-drift diagnosis, smart waits, PR/diff delivery: v2 (out of scope per REQUIREMENTS.md).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| INST-01 | Add plugin to existing project via npm install + single config/fixture import | Package skeleton (dual ESM/CJS, `exports` map, peerDependency) + `import { test } from 'selfmend'` re-export proven; install path documented below |
| INST-02 | Works with existing `page`/locator usage without rewriting tests | Fixture overrides `page`; `Proxy`-wrapped Locator preserves full API so `page.getByRole(...)` keeps working transparently — confirmed pattern (Enes Kuhn proxy-logging article; prior-art uses same shape) |
| CAP-01 | On a passing run, record fingerprint (text, role, test-id, attrs, neighbour, DOM position) per resolved locator | Single batched `locator.evaluate` / `page.evaluate` payload extracts all signals in one round-trip; `ariaSnapshot` (>=1.49) gives role+name; fields enumerated below |
| MATCH-01 | When a locator fails, enumerate candidates and score each against the fingerprint with weighted signals | `page.evaluate` enumerates candidate descriptors; pure scorer (Playwright-free) ranks them; interface below |
| HEAL-01 | On accepted match, rebind broken locator to matched element so the test continues | Rebind = build fresh `page.locator(newSelector)` from winning candidate's unique signal and replay the action. Cannot reuse an ElementHandle as a Locator (issue #10571) |
| HEAL-02 | Healing triggers only after auto-wait/timeout, never on transient poll miss | Catch the action's real `TimeoutError` (thrown after the locator's configured timeout exhausts). Do NOT pre-check `count()` and branch early (the prior-art's mistake) |
| REP-01 | At end of run, print console summary of every heal (original selector, healed target, confidence) | Worker emits heal events via `testInfo.attach`; Reporter aggregates in `onTestEnd`, renders boxed block in `onEnd`. Margin column is Phase 2 (REP-02) |
| CFG-01 | Toggle healing on/off via plugin config | `zod`-validated config with `enabled` default `true`, `threshold` default ~0.9; injected via worker-scoped fixture option |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Locator wrap + heal trigger | Worker process (fixture) | — | Only context with live `page`/DOM; runs in-process inside the action |
| Fingerprint capture on success | Worker process (in-browser `evaluate`) | — | DOM is in the real browser; serialize signals there in one round-trip |
| Candidate enumeration on failure | Worker process (in-browser `evaluate`) | — | Needs live DOM at the moment of failure |
| Scoring + heal decision | Pure TS module (no tier) | — | Zero Playwright/`fs` dependency; most-testable unit, TDD'd in isolation |
| Single-worker baseline store | Worker process (in-memory + optional disk) | Disk | Phase 1 is single-worker; in-process map proves the loop. Disk/parallel safety deferred to Phase 3 |
| Heal-event transport | Worker → Main (`testInfo.attach`) | — | Only sanctioned cross-process channel (custom IPC unavailable, issue #31559) |
| Boxed console summary | Main process (Reporter API) | — | Post-hoc aggregation; no DOM needed; cannot and must not heal |
| Config load/validate | Worker-scoped fixture option | — | Single source of truth injected into the fixture |

## THE LIVE-REBIND HOOK (the riskiest unknown) — Findings

### Verdict: PROVEN on public surfaces; short spike recommended to lock failure-detection timing

The five sub-questions from the brief, answered with code-level detail:

### Q1 — How to wrap `page.locator` / `getBy*` so every Locator is healing-aware while preserving the full Locator API

**Answer (HIGH confidence):** A `test.extend` override of the built-in `page` fixture returns a `Proxy` over `page`. The `get` trap intercepts the locator-factory methods (`locator`, `getByRole`, `getByText`, `getByLabel`, `getByPlaceholder`, `getByAltText`, `getByTitle`, `getByTestId`) and returns a function that calls the real factory, then wraps the returned `Locator` in a second `Proxy`. The Locator `Proxy`'s `get` trap:
- For **action methods** (`click`, `fill`, `type`, `press`, `hover`, `check`, `uncheck`, `selectOption`, `setInputFiles`, `dblclick`, `tap`, `focus`, `blur`, `dragTo`, `scrollIntoViewIfNeeded`, `waitFor`): return a wrapped async function that runs capture-on-success / heal-on-`TimeoutError`.
- For **chaining/refinement methods** that return a new `Locator` (`first`, `last`, `nth`, `filter`, `and`, `or`, `getByRole` and the other `getBy*` on the Locator, `locator`): call the real method and **re-wrap the returned Locator** so healing survives chaining.
- For everything else (properties, `page()`, etc.): pass through to the real Locator.

The `Proxy`-over-Locator pattern is established and public (Playwright Locators with Custom Logging using Proxies, Enes Kuhn) [CITED: medium.com/@enesku/playwright-locators-with-custom-logging-using-proxies-244674ca559a]. Crucial correction vs prior art: `playwright-selfheal@1.0.9` proxies an **empty object `{}`** and re-resolves via `helper.find(selector)` on every method call — this loses the real Locator surface (chaining returns nothing healing-aware, lazy semantics break) and re-queries on every action. **Do not copy that.** Wrap the *real* Locator and delegate by default; only intercept the specific method sets above. [VERIFIED: prior-art source `playwright-selfheal@1.0.9` `dist/src/HeuristicHeal(Non_AI)/SelfHealingPage.js`]

### Q2 — How to detect a genuine post-auto-wait resolution failure without firing on transient poll misses

**Answer (HIGH confidence):** Do **not** pre-check `count()`/`waitFor` and branch. Let the real action method run with the locator's normal timeout; Playwright auto-waits (resolves to exactly one element, visible, stable, enabled, receives events) and only throws `TimeoutError` after the timeout exhausts. Catch that `TimeoutError` — by definition it fires *after* auto-wait, so it cannot be a transient poll miss. This satisfies HEAL-02 by construction. [CITED: playwright.dev/docs/actionability — "If the required checks do not pass within the given timeout, action fails with the TimeoutError"]

- **Error type:** `TimeoutError` is exported as `import { errors } from '@playwright/test'` → `errors.TimeoutError` (also `import { TimeoutError } from 'playwright-core'`). It subclasses `Error`; distinguish at runtime via `error instanceof errors.TimeoutError` or `error.name === 'TimeoutError'`. [CITED: playwright.dev/docs/api/class-timeouterror — "TimeoutError is emitted whenever certain operations are terminated due to timeout, e.g. locator.waitFor()"]
- **"Element genuinely gone" vs "wrong selector but element present elsewhere":** Playwright does NOT tell you which. A `TimeoutError` only means "the original locator did not resolve to one actionable element in time." Disambiguation is the **scorer's** job, not Playwright's: enumerate candidates, score them, and the floor + (Phase 2) margin gate decide. If the element is genuinely gone, no candidate clears the floor → re-throw → test fails normally. This is exactly the false-green guard.
- **Timeout-budget caveat (spike target):** the wrapped action should respect the user's configured timeout for the *real* attempt, then spend a *separate, short* budget on candidate enumeration + rebind replay, so total wall-clock does not balloon. Whether to pass an explicit `{ timeout }` on the first attempt or read `testInfo`/config defaults is the one timing detail the spike should pin against 1.60.

### Q3 — How to enumerate candidates and re-drive the action (rebind)

**Answer (HIGH confidence on mechanism, with one hard constraint):**
- **You cannot turn an `ElementHandle` into a `Locator`.** Confirmed limitation; Playwright issue #10571 (open since Nov 2021) requests it and it does not exist. [CITED: github.com/microsoft/playwright/issues/10571] Therefore rebind must yield a **fresh selector string** and call `page.locator(newSelector)`.
- **Enumeration:** at failure, run one `page.evaluate` (or `page.locator('*').evaluateAll` / role-scoped query) that walks plausible elements and returns lightweight `CandidateDescriptor[]` (tag, role, accessible name/text, test-id, key attrs, a uniquely-identifying selector string, neighbour signature, DOM-path index). Keep this in-browser and serializable. Scope it (by role, by tag, by neighbourhood of a stable anchor) to avoid scoring the whole DOM.
- **Rebind:** from the winning candidate, the enumeration must have produced a **uniquely-resolving selector** (prefer test-id, then a stable attribute, then a scoped `nth`). `page.locator(thatSelector)` → replay the original action on it. The prior-art validates uniqueness with `count()===1` before accepting a candidate selector — keep that uniqueness check (it prevents binding to an ambiguous match) but gate acceptance on the **score**, which the prior-art fails to do. [VERIFIED: prior-art `HealingStrategies.js` `generateLocatorCandidates` / `addIfUnique`]
- **`selectors.register()` — useful but not the rebind mechanism.** It registers a custom *selector engine* (`query`/`queryAll`, must be registered before page creation; worker-scoped via a `scope:'worker'` fixture; `contentScript:true` isolates it). [CITED: playwright.dev/docs/extensibility, playwright.dev/docs/api/class-selectors] It could help candidate querying (a `selfmend=` engine), but it does not provide a "resolution failed → rebind and replay" hook. **Phase 1 does not need it**; plain `page.evaluate` enumeration + `page.locator()` rebind is sufficient. Treat `selectors.register()` as an optional Phase 4 optimization, not a Phase 1 dependency.

### Q4 — How fingerprint capture hooks successful resolution; which API; performance

**Answer (HIGH confidence):** On the success path of a wrapped action, capture in **one batched `locator.evaluate(el => ({...}))`** that returns tag, computed/explicit role, accessible name / normalized text, `data-testid` (configurable attr), id, stable class tokens (filter volatile/generated), key `data-*`/semantic attrs (`name`, `type`), ordinal among siblings, a short parent DOM-path, and optionally an `ariaSnapshot` slice. One round-trip per locator-key per run. [CITED: playwright.dev/docs/api/class-locator — `evaluate`, `evaluateAll`, `getAttribute`, `textContent`]
- `locator.ariaSnapshot()` (added **v1.49**) gives a YAML role+name tree — an excellent single-signal capture; gate it behind a version check so the >=1.42 floor still works with text/attr signals only. [CITED: playwright.dev/docs/aria-snapshots]
- **Performance:** prefer a single `evaluate` over per-signal `getAttribute`/`textContent` calls (each is a separate CDP round-trip). Capture **once per locator key per run** (dedup; skip if a fingerprint already exists this run) so the green hot path is not slowed. Full overhead benchmark is a Phase 4 CI gate, but Phase 1 should already batch + dedup.
- **Security:** store derived/normalized signals, not raw innerText/full DOM (avoid persisting PII/secrets). Phase-1 single-worker store is in-process, so this is mostly forward-design, but normalize text at capture.

### Q5 — What the OSS prior art actually does, and where it falls short

| Project | Integration technique | Floor / margin gate? | Heals after timeout? | Verdict |
|---------|----------------------|----------------------|----------------------|---------|
| `playwright-selfheal@1.0.9` (npm; under our rejected name) | `Proxy` over **empty `{}`**, re-resolves via `helper.find(selector)` on every action; generates CSS/XPath candidate selectors and picks first with `count()===1` | **NO floor, NO margin.** `heuristicScore` is computed and logged but **never gates** the return | **NO — pre-checks `count()` and branches before auto-wait.** Violates HEAL-02; flaky and false-green-prone | Confirms the wrap+candidate-selector technique; a textbook example of the **two failure modes we must avoid** (no gate, heals on poll miss). Also has an AI tier (out of scope; offline-only for us). [VERIFIED: tarball source read this session] |
| `qosha1/healing-playwright` | Fixture + locator wrapper (per project description; README fetch blocked this session) | Unconfirmed | Unconfirmed | Confirms fixture+wrapper shape. Read source during the spike. [ASSUMED — source not reachable this session] |
| `amrsa1/healwright` | Fixture + locator wrapper (per description) | Unconfirmed | Unconfirmed | Same — confirms shape; verify in spike. [ASSUMED] |
| `paulocoliveira/playwright-auto-heal` | Locator-factory override (per description) | Unconfirmed | Unconfirmed | Same — confirms shape; verify in spike. [ASSUMED] |

**What they get right:** the fixture + wrapped-locator-factory + generate-candidate-selectors + `page.locator()` rebind shape is universal — strong corroboration the seam is correct. **Where they fall short (our differentiation):** none of the confirmed ones enforce a confidence floor + second-best margin, and the one we read heals *before* the real timeout. Our trust contract (floor now, margin in Phase 2, heal strictly post-`TimeoutError`, loud audit trail) is the gap in the field.

### Spike recommendation

**Run a ~1-day throwaway spike before writing integration tasks.** It is NOT needed to prove feasibility (proven above) — it is needed to lock three timing/mechanics details against the real engine:
1. Confirm catching `errors.TimeoutError` from a wrapped `click()` on a deleted-then-renamed selector, then `page.locator(newSel).click()` replays green — on Playwright 1.60.
2. Pin the timeout-budget split (real attempt vs heal-replay) so total time is bounded.
3. Confirm the Locator `Proxy` re-wraps chained Locators (`page.getByRole(...).first()`) without losing healing and without breaking strict-mode/auto-wait semantics.
Throwaway code in a `spike/` dir, deleted after; its findings feed the `integration/` tasks. Validate against the declared floor (>=1.42 tested where feasible) and read the three GitHub prior-art repos' source during it.

## Standard Stack

### Core
| Library | Version (verified 2026-05-31) | Purpose | Why Standard |
|---------|--------------|---------|--------------|
| TypeScript | 6.0.3 (npm `latest`) | Plugin language | Mandated by CLAUDE.md; strict types are the selling point. **Note:** research docs said 5.9; npm `latest` is now 6.0.3 — confirm intended major at planning (6.x is a valid choice; `module: nodenext`, `strict: true`). |
| `@playwright/test` | `^1.60` (peerDependency `>=1.42`) | Host framework + extension surface (`test.extend`, `Reporter`, `Locator`) | Latest stable 1.60.0; 1.61 alpha in flight. Declare peer so the plugin uses the user's Playwright. [VERIFIED: npm `@playwright/test@1.60.0`] |
| Node.js | 24.12 (primary), `>=22` floor | Runtime target | Node 24 Active LTS; 22 Maintenance. `engines.node: ">=22"`. [VERIFIED: local `node v24.12.0`] |
| tsdown | 0.22.1 (npm `latest`) | Library bundler (ESM+CJS+`.d.ts`) | Rolldown-powered (`github.com/rolldown/tsdown`), 2026 successor to unmaintained tsup. [VERIFIED: npm registry, source repo confirmed] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `zod` | 4.4.3 | Validate plugin config (CFG-01) + later the store schema | Loading user config; guards corrupt/old store formats. [VERIFIED: npm, repo `colinhacks/zod`] |
| `picocolors` | 1.1.1 | Colorized boxed console summary | The end-of-run report. Tiny, zero-dep. [VERIFIED: npm, repo `alexeyraspopov/picocolors`] |
| (hand-rolled) | — | Text/attribute similarity scoring | Levenshtein / token-overlap in-house — the core IP, must be deterministic + offline. No dependency. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| tsdown | tsup | tsup is unmaintained in 2026; tsdown is the forward path |
| picocolors | chalk | chalk is larger with CJS baggage |
| Vitest | Jest | Jest is heavier and ESM-awkward for new libs |
| In-process Phase-1 store | JSON file on disk | Disk persistence is Phase 3 scope; Phase 1 proves the loop in-process |

**Installation:**
```bash
corepack enable && corepack prepare pnpm@latest --activate
pnpm add -D @playwright/test typescript tsdown vitest @arethetypeswrong/cli publint
pnpm add zod picocolors
```

## Package Legitimacy Audit

> slopcheck was unavailable this session (offline-restricted environment). Packages below were verified manually via `npm view` (registry existence + age + source repo). All are long-established mainstream packages with authoritative source repos — treat as MEDIUM-HIGH, but the planner should still gate the actual `pnpm add` behind normal review.

| Package | Registry | Created | Source Repo | slopcheck | Disposition |
|---------|----------|---------|-------------|-----------|-------------|
| typescript | npm | (Microsoft) | github.com/microsoft/TypeScript | n/a | Approved |
| @playwright/test | npm | (Microsoft) | github.com/microsoft/playwright | n/a | Approved (peer) |
| tsdown | npm | 2023-10-29 | github.com/rolldown/tsdown | n/a | Approved |
| vitest | npm | 2021-12-03 | github.com/vitest-dev/vitest | n/a | Approved (dev) |
| zod | npm | 2020-03-07 | github.com/colinhacks/zod | n/a | Approved |
| picocolors | npm | 2021-09-27 | github.com/alexeyraspopov/picocolors | n/a | Approved |
| publint | npm | 2022-05-01 | github.com/publint/publint | n/a | Approved (dev) |
| @arethetypeswrong/cli | npm | (attw) | github.com/arethetypeswrong/arethetypeswrong.github.io | n/a | Approved (dev) |

**Packages removed due to slopcheck [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** none.

> Vitest npm `latest` is now **4.1.7** (research docs said 3.x) and TypeScript `latest` is **6.0.3** (docs said 5.9). These are version drift, not new packages — confirm intended majors at planning. No postinstall-script risk: none of these run network postinstalls.

## Architecture Patterns

### System Architecture Diagram

```
USER TEST  (import { test } from 'selfmend')
   │  page.getByRole('button',{name:'Submit'}).click()
   ▼
┌─ WORKER PROCESS ────────────────────────────────────────────────┐
│  Healing Fixture (test.extend, overrides `page`)                 │
│     │ returns Proxy(page)                                        │
│     ▼                                                            │
│  Locator factory trap → returns Proxy(real Locator)             │
│     │                                                            │
│     ├─ action method (click/fill/…)                              │
│     │     │  try { await real.click(/*normal timeout*/) }        │
│     │     ├─ SUCCESS ─► capture: locator.evaluate(signals)       │
│     │     │              └─► dedup ─► in-process baseline (key)   │
│     │     └─ catch TimeoutError ─► HEAL PATH                      │
│     │            │ store.get(key) ── missing ─► re-throw (no heal)│
│     │            │ page.evaluate → CandidateDescriptor[]         │
│     │            │ PURE scorer: (fp, candidate) → score          │
│     │            │ PURE decision: top ≥ floor(0.9) ?             │
│     │            │     ├─ NO  ─► re-throw original (test FAILS)   │
│     │            │     └─ YES ─► page.locator(newSel).click()     │
│     │            │                (replay, GREEN)                 │
│     │            └─► testInfo.attach('selfmend-heal', {…})        │
│     └─ chaining method (first/nth/filter/getBy*) ─► re-wrap Locator│
└──────────────────────────────────┬──────────────────────────────┘
                                    │ heal events (TestResult attachments)
┌─ MAIN PROCESS ────────────────────▼──────────────────────────────┐
│  selfmend Reporter:  onTestEnd → collect ; onEnd → boxed summary  │
│  selfmend: N locators healed                                      │
│    • test ▸ original ▸ healed ▸ score                             │
└───────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure (Phase-1 subset)
```
src/
├── index.ts                  # public: export `test` (re-extended) + healingFixture + config type + reporter
├── config/
│   ├── schema.ts             # zod schema: { enabled: bool, threshold: number, testIdAttr }
│   └── defaults.ts           # enabled:true, threshold:~0.9
├── matching/
│   ├── types.ts              # Fingerprint + CandidateDescriptor types (shared, pure)
│   ├── scoring.ts            # PURE: (fingerprint, candidate) → score 0..1  ← TDD FIRST
│   └── decision.ts           # PURE: (scored[], floor) → heal | no-heal + reason  ← TDD FIRST
├── store/
│   └── store.ts              # Phase-1 in-process Map keyed by locator identity
├── fingerprint/
│   └── capture.ts            # locator.evaluate(signals) payload → Fingerprint
├── matching/
│   └── candidate-finder.ts   # page.evaluate enumeration → CandidateDescriptor[]
├── rebind/
│   └── rebind.ts             # winning candidate → fresh page.locator(selector) + replay
├── integration/
│   ├── locator-proxy.ts      # Proxy(Locator): capture-on-success / heal-on-TimeoutError / re-wrap chains
│   ├── fixture.ts            # test.extend override of `page`; wires store+config+events
│   └── events.ts             # HealEvent type + testInfo.attach serialization
└── reporter/
    └── reporter.ts           # Reporter: onTestEnd collect, onEnd boxed picocolors summary
```

### Pattern 1: Catch the real TimeoutError (never pre-check)
**What:** Wrap the action, let Playwright auto-wait to its real timeout, catch `errors.TimeoutError`, then heal.
**When to use:** Every wrapped action. This is the HEAL-02 guarantee in code.
```typescript
// Source: synthesized from playwright.dev/docs/actionability + class-timeouterror
import { errors } from '@playwright/test';
async function actionOrHeal(real, key, method, args, ctx) {
  try {
    const result = await real[method](...args);   // real auto-wait runs to timeout
    await captureIfNeeded(real, key, ctx);          // green path
    return result;
  } catch (err) {
    if (!(err instanceof errors.TimeoutError)) throw err;  // not a resolution failure
    const fp = ctx.store.get(key);
    if (!fp) throw err;                              // never healed an unseen locator
    const candidates = await findCandidates(ctx.page, fp);
    const scored = candidates.map(c => ({ c, score: score(fp, c) }));   // PURE
    const decision = decide(scored, ctx.config.threshold);              // PURE
    if (!decision.heal) throw err;                   // no false green
    ctx.testInfo.attach('selfmend-heal', { body: JSON.stringify(decision.event), contentType: 'application/json' });
    return await ctx.page.locator(decision.newSelector)[method](...args); // rebind + replay
  }
}
```

### Pattern 2: Locator Proxy that survives chaining
**What:** Wrap the real Locator; delegate by default; intercept action methods (heal) and chaining methods (re-wrap).
```typescript
// Source: pattern per medium.com/@enesku proxy-logging; corrected vs playwright-selfheal@1.0.9
function wrapLocator(real, key, ctx) {
  const CHAIN = new Set(['first','last','nth','filter','and','or','locator',
    'getByRole','getByText','getByLabel','getByTestId','getByPlaceholder','getByAltText','getByTitle']);
  const ACTION = new Set(['click','fill','type','press','hover','check','uncheck','dblclick','tap','selectOption','setInputFiles','focus','waitFor']);
  return new Proxy(real, {
    get(t, prop, recv) {
      const v = Reflect.get(t, prop, recv);
      if (typeof v !== 'function') return v;
      if (ACTION.has(prop)) return (...a) => actionOrHeal(t, key, prop, a, ctx);
      if (CHAIN.has(prop)) return (...a) => wrapLocator(v.apply(t, a), key, ctx);  // re-wrap
      return v.bind(t);
    },
  });
}
```

### Anti-Patterns to Avoid
- **Proxying an empty `{}` and re-resolving on every call (the `playwright-selfheal@1.0.9` mistake):** loses the real Locator API, breaks lazy/chaining semantics, re-queries needlessly. Wrap the real Locator instead.
- **Pre-checking `count()`/`waitFor` and branching before the action:** heals on transient poll misses (HEAL-02 violation). Catch the real `TimeoutError`.
- **Returning the first `count()===1` candidate with no score gate:** the false-green trap. Gate on the floor.
- **Trying to wrap an `ElementHandle` as a Locator for rebind:** impossible (issue #10571). Produce a fresh selector string.
- **Healing in the Reporter:** post-hoc, no DOM. Reporter is summary-only (D-05).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| DOM introspection / signal extraction | jsdom/cheerio parallel parser | `locator.evaluate` / `page.evaluate` in the live browser | The real DOM is already there; a parser drifts and adds weight |
| Failure detection | Custom polling / monkey-patched `Locator` prototype | Catch `errors.TimeoutError` from the real action | Playwright already does auto-wait correctly; patching breaks across minors |
| Dual ESM/CJS bundling + `.d.ts` | Hand-written rollup config | tsdown | Emits correct extensions, types, both formats |
| Config validation | Hand-rolled type guards | zod | Trust-critical; one schema, good errors |
| Console colors/box | Hand-rolled ANSI | picocolors + a tiny box helper | Tiny, correct, zero-dep |
| Worker→main transport | Custom IPC | `testInfo.attach` | Custom IPC is unavailable (issue #31559); attach is the sanctioned channel |

**Key insight:** the only thing worth hand-rolling here is the **pure scorer** — it is the core IP, must be deterministic and offline, and a ~50-line internal module beats any dep.

## Common Pitfalls

### Pitfall 1: Healing on a transient poll miss (HEAL-02)
**What goes wrong:** A slow-but-present element triggers a heal before it would have resolved.
**Why it happens:** Pre-checking `count()`/`waitFor` instead of letting the action auto-wait. The prior-art does exactly this.
**How to avoid:** Run the real action to its real timeout; only the resulting `TimeoutError` triggers healing.
**Warning signs:** New flakiness after install; heals on elements that are merely slow.

### Pitfall 2: False green — healing the wrong element (the product-killer)
**What goes wrong:** Original element is genuinely gone; the scorer picks the next-most-similar and ships a bug under green.
**Why it happens:** No floor, or floor too low; ambiguous duplicates score high.
**How to avoid:** Conservative floor (~0.9) gated in code (Phase 1); margin gate (Phase 2). No fingerprint for the key → re-throw. No candidate clears floor → re-throw and say so. The decision module is PURE and TDD'd with "removed element fails", "below-floor fails", "duplicate ambiguous fails" tests.
**Warning signs:** Heals on list/repeated structures; top-2 scores within a few points.

### Pitfall 3: Losing the Locator API through a bad Proxy
**What goes wrong:** Chained calls (`.first()`, `.filter()`, `.getByRole()`) return unwrapped or empty Locators; healing silently stops; tests break in surprising ways.
**Why it happens:** Proxying an empty target or not re-wrapping chain results.
**How to avoid:** Wrap the real Locator; re-wrap every Locator-returning method; delegate everything else. Spike-confirm chaining.

### Pitfall 4: ElementHandle → Locator dead end
**What goes wrong:** Rebind tries to reuse a matched handle as a Locator and there is no API for it.
**Why it happens:** Assuming symmetry that does not exist (issue #10571).
**How to avoid:** Candidate enumeration must emit a uniquely-resolving selector string; rebind via `page.locator(selector)`.

## Code Examples

### Capture fingerprint in one round-trip
```typescript
// Source: playwright.dev/docs/api/class-locator (evaluate)
const fingerprint = await locator.evaluate((el) => {
  const attrs: Record<string,string> = {};
  for (const n of el.getAttributeNames()) attrs[n] = el.getAttribute(n) ?? '';
  const parent = el.parentElement;
  return {
    tag: el.tagName.toLowerCase(),
    role: el.getAttribute('role') ?? '',
    text: (el.textContent ?? '').trim().replace(/\s+/g, ' '),
    testId: el.getAttribute('data-testid') ?? '',
    attrs,
    ordinal: parent ? Array.from(parent.children).indexOf(el) : -1,
    parentTag: parent?.tagName.toLowerCase() ?? '',
  };
});
```

### Distinguish TimeoutError at runtime
```typescript
// Source: playwright.dev/docs/api/class-timeouterror
import { errors } from '@playwright/test';
catch (err) {
  if (err instanceof errors.TimeoutError /* or err.name === 'TimeoutError' */) { /* heal path */ }
  else throw err;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Selenium + tree-LCS (Healenium) | Playwright-native, semantic-signal weighted scoring | ongoing | Our lane: Similo-style scoring + Healenium lifecycle, Playwright-native, offline |
| tsup bundler | tsdown (Rolldown) | 2025–2026 | tsup unmaintained; tsdown is forward path |
| Pre-check + heal (prior-art) | Catch real TimeoutError + gated heal | this design | Removes HEAL-02 flakiness and false-green class |

**Deprecated/outdated:**
- `playwright-selfheal@1.0.9`'s pre-check-and-branch + ungated candidate selection — documented anti-pattern, do not reuse.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `qosha1/healing-playwright`, `amrsa1/healwright`, `paulocoliveira/playwright-auto-heal` use fixture+wrapper and their gate/timing behavior | Prior-art table | Low — feasibility already proven via the one source read + Playwright docs; spike will confirm. READMEs were unreachable this session (WebFetch/curl blocked) |
| A2 | Default threshold ~0.9 is the right conservative number | D-09 / config | Medium — calibrated in Phase 2 against the fixture app; Phase 1 ships it as a documented default, not a proven optimum |
| A3 | Intended TypeScript major is 5.9 vs npm `latest` 6.0.3, and Vitest 3 vs `latest` 4.1.7 | Standard Stack | Low — both are valid; planner picks. Pin the choice in package.json |

## Open Questions

1. **Exact timeout-budget split between the real attempt and the heal-replay.**
   - What we know: catch the real `TimeoutError` after normal auto-wait; replay needs its own short budget.
   - What's unclear: whether to pass explicit `{timeout}` on the first attempt or rely on config defaults, and the replay timeout.
   - Recommendation: resolve in the rebind spike against PW 1.60.

2. **Whether the Proxy must intercept the assertion path (`expect(locator)`) in Phase 1.**
   - What we know: v1 is locator-only; never heal assertions.
   - What's unclear: `expect(locator).toBeVisible()` resolves via matchers, not the wrapped action methods — confirm it does NOT accidentally route through the heal path.
   - Recommendation: explicitly scope the action-method set to exclude assertion matchers; verify in the spike. Keep the "never heal assertions" boundary sacred.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Build + runtime | ✓ | 24.12.0 | — |
| npm registry | Install deps | ✓ | — | — |
| `@playwright/test` | Plugin + integration tests | ✗ (not yet installed) | target 1.60 | Install in Phase 1 scaffold task |
| pnpm | Package manager (recommended) | unverified | — | npm works |
| WebFetch / curl outbound | (research only) | ✗ blocked this session | — | WebSearch used instead; prior-art read from npm tarball |

**Missing dependencies with no fallback:** none blocking.
**Missing dependencies with fallback:** `@playwright/test` installed during the scaffold task; pnpm optional (npm fallback).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (pure logic) + `@playwright/test` runner (integration) |
| Config file | none yet — created in Wave 0 (`vitest.config.ts`, `playwright.config.ts`) |
| Quick run command | `pnpm vitest run src/matching` |
| Full suite command | `pnpm vitest run && pnpm playwright test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MATCH-01 | Scorer ranks candidates against a fingerprint | unit (Vitest) | `pnpm vitest run src/matching/scoring.test.ts` | ❌ Wave 0 |
| MATCH-01/D-09 | Decision: below-floor fails, removed-element fails, duplicate ambiguous fails | unit (Vitest) | `pnpm vitest run src/matching/decision.test.ts` | ❌ Wave 0 |
| CFG-01 | Config defaults (enabled:true, ~0.9); disable toggles off | unit (Vitest) | `pnpm vitest run src/config` | ❌ Wave 0 |
| CAP-01 | Fingerprint captured on passing resolution | integration (PW) | `pnpm playwright test tests/capture.spec.ts` | ❌ Wave 0 |
| HEAL-01/02 | Broken selector heals after timeout; transient slow element does NOT heal | integration (PW) | `pnpm playwright test tests/heal.spec.ts` | ❌ Wave 0 |
| HEAL-02 | No heal fires while element is within timeout | integration (PW) | `pnpm playwright test tests/no-premature-heal.spec.ts` | ❌ Wave 0 |
| INST-01/02 | `import { test } from 'selfmend'` works; existing locators unchanged | integration (PW) | `pnpm playwright test tests/install.spec.ts` | ❌ Wave 0 |
| REP-01 | End-of-run boxed summary lists original/healed/score | integration (PW) | `pnpm playwright test tests/report.spec.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm vitest run src/matching` (pure logic, <30s)
- **Per wave merge:** `pnpm vitest run && pnpm playwright test`
- **Phase gate:** full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `vitest.config.ts` + `playwright.config.ts` — framework configs
- [ ] `tests/fixture-app/` — tiny local HTML page with a selector mutated between runs (the integration regression net)
- [ ] `src/matching/scoring.test.ts`, `src/matching/decision.test.ts` — pure-logic suites (TDD first)
- [ ] `tests/heal.spec.ts`, `tests/no-premature-heal.spec.ts`, `tests/capture.spec.ts`, `tests/report.spec.ts`, `tests/install.spec.ts`
- [ ] Framework install: `pnpm add -D @playwright/test vitest && pnpm playwright install chromium`

## Security Domain

> `security_enforcement` not configured to `false`; included.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Plugin handles no auth |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | yes | zod-validate plugin config + (later) store schema; normalize/escape selector strings used in `page.locator()` |
| V6 Cryptography | no | No crypto; offline, no secrets |
| V10/V14 (data protection / config) | yes | Store derived signals only, never raw innerText/full DOM (PII/secret leak). No network calls anywhere in the heal path (hard offline constraint) |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Selector-string injection into `page.locator()` from candidate enumeration | Tampering | Build selectors from controlled signal values; quote/escape attribute values; prefer test-id/`nth` over interpolated text |
| Persisting PII/secrets in fingerprints | Information disclosure | Normalize + store minimal derived signals, not raw DOM; document redaction |
| Accidental network call in heal path | Information disclosure | Zero network deps; CI network-block assertion (Phase 4 PRIV-01) |
| Healing masking a real regression (false green) | Repudiation / integrity | Confidence floor (Phase 1) + margin gate (Phase 2) + loud audit trail |

## Sources

### Primary (HIGH confidence)
- playwright.dev/docs/api/class-locator — evaluate, evaluateAll, elementHandle, all, count, getAttribute, textContent, waitFor
- playwright.dev/docs/actionability — auto-wait checks; action throws TimeoutError when checks don't pass in time
- playwright.dev/docs/api/class-timeouterror — TimeoutError on locator.waitFor()/action timeout
- playwright.dev/docs/test-fixtures — test.extend, overriding the built-in page fixture
- playwright.dev/docs/api/class-testinfo — attach() (worker→main), workerIndex
- playwright.dev/docs/api/class-selectors + playwright.dev/docs/extensibility — selectors.register() query/queryAll, worker-scoped, contentScript, register-before-page
- playwright.dev/docs/aria-snapshots — ariaSnapshot added v1.49
- github.com/microsoft/playwright/issues/10571 — no Locator-from-ElementHandle (open)
- github.com/microsoft/playwright/issues/31559 — custom worker↔main IPC unavailable
- npm registry (verified this session): selfmend (404=available), @playwright/test@1.60.0, tsdown@0.22.1, vitest@4.1.7, zod@4.4.3, picocolors@1.1.1, typescript@6.0.3, publint@0.3.21, @arethetypeswrong/cli@0.18.3
- Prior-art source read this session: `playwright-selfheal@1.0.9` tarball (SelfHealingPage / SelfHealingHelper / HealingStrategies)

### Secondary (MEDIUM confidence)
- medium.com/@enesku/playwright-locators-with-custom-logging-using-proxies — Proxy-over-Locator pattern
- Similo (arxiv.org/pdf/2208.00677) + Healenium (healenium.io) — scoring/lifecycle blueprint (from project research)

### Tertiary (LOW / unverified this session)
- github.com/qosha1/healing-playwright, amrsa1/healwright, paulocoliveira/playwright-auto-heal — READMEs unreachable (WebFetch/curl blocked); read source during the spike

## Metadata

**Confidence breakdown:**
- Live-rebind hook: HIGH — mechanism proven via Playwright docs + prior-art source; spike locks timing only
- Standard stack: HIGH — versions verified on npm this session; major-version drift flagged
- Architecture/patterns: HIGH — verified against official docs and corroborated by prior-art
- Pitfalls: HIGH — false-green/HEAL-02 analysis confirmed against the prior-art's actual failures
- Exact threshold number: MEDIUM — calibrated in Phase 2

**Research date:** 2026-05-31
**Valid until:** ~2026-06-30 (Playwright ships fast; re-verify versions at implementation)
