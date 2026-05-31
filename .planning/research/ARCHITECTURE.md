# Architecture Research

**Domain:** Offline, locator-only self-healing plugin for Playwright (TypeScript / npm)
**Researched:** 2026-05-31
**Confidence:** HIGH (Playwright integration surfaces verified against official docs; scoring approach corroborated by Healenium prior art)

## Standard Architecture

The plugin lives in two Playwright execution contexts that **cannot share memory**: tests run inside **worker processes**, while reporters run in the **main process**. The only sanctioned worker -> main channel is `testInfo.attach()` (custom IPC for reporters is an open Playwright feature request, not available — GitHub microsoft/playwright#31559). This single constraint dictates the whole design: all DOM-level work happens in the worker via a wrapped `page` fixture, and the reporter aggregates only what workers serialise out.

### System Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│  MAIN PROCESS  (one per run)                                           │
│  ┌────────────────────────┐        ┌──────────────────────────────┐   │
│  │ Console Reporter        │◀───────│ Heal events (testInfo.attach)│   │
│  │ (Reporter API)          │        └──────────────────────────────┘   │
│  │  onTestEnd: collect     │                                            │
│  │  onEnd:     summarise    │        ┌──────────────────────────────┐   │
│  └────────────────────────┘         │ globalSetup / globalTeardown │   │
│                                      │  store lifecycle (compact)   │   │
│                                      └──────────────────────────────┘   │
├──────────────────────────────────────────────────────────────────────┤
│  WORKER PROCESS  (N in parallel)                                       │
│  ┌──────────────────────────────────────────────────────────────┐     │
│  │  Healing Fixture  (test.extend, overrides `page`)             │     │
│  │   ┌────────────┐   ┌──────────────┐   ┌──────────────────┐    │     │
│  │   │ Integration│──▶│ Fingerprint  │   │ Candidate Finder │    │     │
│  │   │ (wrap page │   │ Capture      │   │ + Scoring Engine │    │     │
│  │   │  /locator) │   └──────┬───────┘   └────────┬─────────┘    │     │
│  │   └─────┬──────┘          │                    │              │     │
│  │         │            ┌────▼────────┐    ┌──────▼──────┐       │     │
│  │         └───────────▶│ Heal        │◀───│ Live        │       │     │
│  │                      │ Decision    │───▶│ Rebinding   │       │     │
│  │                      │ (threshold) │    └─────────────┘       │     │
│  │                      └─────────────┘                          │     │
│  └────────────────────────────┬─────────────────────────────────┘     │
├───────────────────────────────┼────────────────────────────────────────┤
│  DISK  (shared across all workers)                                     │
│  ┌──────────────────────────────────────────────────────────────┐     │
│  │ Fingerprint Store  (.selfheal/baseline.json or sharded dir)   │     │
│  │  read: hot path during heal   │   write: append-only per worker│     │
│  └──────────────────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Playwright Surface Used |
|-----------|----------------|-------------------------|
| **Config** | Load + validate options (enabled, threshold, store path, capture mode); single source of truth, injected into all other units | A `PlaywrightTestConfig` option block, surfaced as a worker-scoped fixture via `test.extend({ selfheal: [...] })` |
| **Integration layer** | Wrap the `page` fixture so every `page.locator()` / `getBy*` returns a healing-aware proxy; catch resolution failures and trigger the heal path | `test.extend` overriding the built-in `page` fixture; a `Proxy`/wrapper around the `Locator` object |
| **Fingerprint capture** | On a *successful* resolve, read the element's signals (tag, role, accessible name/text, test-id, stable attrs, neighbour fingerprints, DOM path/index) | `page.evaluate` / `locator.evaluate` against the resolved `ElementHandle` |
| **Fingerprint store** | Persist baselines keyed by a stable locator identity; read on heal, write on green; concurrency-safe across workers | Plain `fs` on disk; lifecycle bookends via `globalSetup`/`globalTeardown` |
| **Candidate finder** | On failure, enumerate plausible DOM elements (by role, by neighbourhood, by tag) to score | `page.evaluate` returning lightweight DOM candidate descriptors |
| **Scoring engine** | Pure function: `(fingerprint, candidate) -> score 0..1` using weighted signal matching (LCS on DOM path, attribute overlap, text/role match) | None — pure TS, no Playwright dependency (most testable unit) |
| **Heal decision** | Pure function: pick top candidate, compare to threshold, return `heal | no-heal` with reason | None — pure TS |
| **Live rebinding** | Convert the winning candidate into a fresh `Locator` and return it so the original call resumes | `page.locator()` with a generated selector or nth-index from the candidate descriptor |
| **Console reporter** | Aggregate heal events emitted by workers; print end-of-run summary (original selector, healed target, confidence) | Reporter API: collect in `onTestEnd`, render in `onEnd` |

**Boundary rule:** the scoring engine and heal decision are **pure and Playwright-free**. Everything that touches the DOM or the run lifecycle is a thin adapter around those pure cores. This is the seam that makes TDD cheap — the hard logic (scoring, thresholding) is unit-tested with plain fixtures, no browser.

## Recommended Project Structure

```
src/
├── index.ts                  # public entry: exports `test`, reporter, config type
├── config/
│   ├── schema.ts             # options type + zod/manual validation
│   └── defaults.ts           # default threshold, store path, capture toggle
├── integration/
│   ├── fixture.ts            # test.extend — overrides `page`, wires the loop
│   ├── locator-proxy.ts      # wraps Locator; intercepts resolve + catches failure
│   └── events.ts             # HealEvent type + testInfo.attach serialisation
├── fingerprint/
│   ├── capture.ts            # ElementHandle -> Fingerprint (page.evaluate payload)
│   ├── signals.ts            # in-browser signal extractor (string-injected fn)
│   └── types.ts              # Fingerprint shape (shared with scoring)
├── store/
│   ├── store.ts              # read/write API over the baseline
│   ├── persistence.ts        # fs layer: sharded per-worker writes + merge
│   └── keying.ts             # stable locator identity (test id + call site)
├── matching/
│   ├── candidate-finder.ts   # DOM enumeration (page.evaluate payload)
│   ├── scoring.ts            # PURE: fingerprint x candidate -> score
│   └── decision.ts           # PURE: candidates + threshold -> heal | fail
├── rebind/
│   └── rebind.ts             # winning candidate -> fresh Locator
└── reporter/
    └── reporter.ts           # Reporter API impl, onTestEnd + onEnd summary
```

### Structure Rationale

- **`matching/` holds the pure brains.** `scoring.ts` and `decision.ts` import nothing from Playwright or `fs`; they are tested in isolation first (TDD-friendly). Everything else is an adapter.
- **`integration/` is the only place that knows about fixtures and proxies.** Isolating the wrapping logic keeps the Playwright-version coupling in one file, so future Playwright API churn is contained.
- **`fingerprint/signals.ts` and `matching/candidate-finder.ts` are "in-browser" code** (functions serialised into `page.evaluate`). Keeping them as separate files makes the worker/browser boundary explicit and the payloads testable against a DOM fixture (jsdom or a real page in a slower suite).
- **`store/` separates the logical API from the fs concurrency mechanism**, so the parallel-write strategy can change (single file -> sharded dir) without touching callers.

## Architectural Patterns

### Pattern 1: Fixture-wrapped page (the integration seam)

**What:** Override Playwright's built-in `page` fixture with `test.extend`. The override resolves the real `page`, then returns a `Proxy` (or a thin wrapper) whose `locator`/`getBy*` methods return *healing locators* instead of raw ones.
**When to use:** This is the only runtime surface that gives live DOM control inside a test. The Reporter API gives lifecycle but no DOM, so all healing must originate here.
**Trade-offs:** Wrapping `page` is invasive but transparent to user tests (they keep calling `page.getByRole(...)`). Risk: must faithfully proxy the full Locator surface; missed methods silently lose healing. Mitigate by proxying at the `Locator` level generically.

```typescript
export const test = base.extend<{ page: Page }>({
  page: async ({ page, selfheal }, use, testInfo) => {
    if (!selfheal.enabled) return use(page);
    await use(wrapPage(page, { store, config: selfheal, testInfo }));
  },
});
```

### Pattern 2: Resolve-then-capture / fail-then-heal (the dual data path)

**What:** Each healing locator intercepts the *first action that forces resolution*. On success it captures a fingerprint; on a "not found" timeout it runs the heal loop before re-throwing.
**When to use:** Always, per locator action. Capture is opportunistic (cheap, on green); heal is the recovery branch.
**Trade-offs:** Capturing on every resolve has overhead; gate it (sample once per locator key per run, skip if a fresh fingerprint exists). The heal branch only fires on the failure path, so it costs nothing on green runs.

```typescript
async function resolveOrHeal(real: Locator, key: LocatorKey) {
  try {
    const handle = await real.elementHandle({ timeout });   // forces resolution
    await captureIfNeeded(handle, key);                      // green path
    return real;
  } catch (notFound) {
    const fp = await store.get(key);
    if (!fp) throw notFound;                                  // never seen -> no heal
    const candidates = await findCandidates(page, fp);
    const decision = decide(score(fp, candidates), threshold);// PURE
    if (!decision.heal) throw notFound;                       // no false green
    emitHealEvent(testInfo, decision);                        // -> reporter
    return rebind(page, decision.winner);                     // live rebind
  }
}
```

### Pattern 3: Worker-emits / reporter-aggregates (cross-process state)

**What:** Workers cannot call the reporter directly. Each heal is serialised with `testInfo.attach('selfheal-heal', { body: JSON, contentType: 'application/json' })`. The reporter reads `result.attachments` in `onTestEnd`, accumulates them in an in-memory array, and renders the summary in `onEnd`.
**When to use:** For any data that must survive the worker->main boundary. This is the documented, version-stable channel (avoids the unavailable custom-IPC path).
**Trade-offs:** Heal events become part of the test result payload (slightly bloats reports), and ordering is per-test, not global, until `onEnd` sorts. Acceptable for a console summary.

## Data Flow

### Green run (capture)

```
test calls page.getByRole(...) → action forces resolution → ElementHandle resolved
        ↓
Fingerprint Capture runs page.evaluate(signals) → Fingerprint{tag,role,name,testid,attrs,neighbours,path}
        ↓
keying.ts derives stable key (specFile + test title + locator call-site / selector text)
        ↓
Store.write(key, fingerprint)   ──►  baseline on disk (per-worker shard, merged at teardown)
```

### Broken-locator run (heal)

```
test calls page.getByRole(...) → resolution times out ("not found") → caught in locator-proxy
        ↓
Store.read(key) → fingerprint   (if MISSING → re-throw, never heal an unknown locator)
        ↓
Candidate Finder: page.evaluate enumerates DOM (by role, by neighbourhood, by tag) → CandidateDescriptor[]
        ↓
Scoring Engine (PURE): score each candidate vs fingerprint → [{candidate, score}]
        ↓
Heal Decision (PURE): top score ≥ threshold ?
        ├─ NO  → re-throw original error → test FAILS NORMALLY (trust guarantee)
        └─ YES → Live Rebinding: build fresh Locator from winner → return it → action resumes (GREEN)
                       ↓
                 testInfo.attach('selfheal-heal', {originalSelector, healedTarget, score})
                       ↓ (worker → main, via TestResult)
                 Reporter.onTestEnd collects → Reporter.onEnd prints summary table
```

### State management (the parallel-worker concern)

The fingerprint store is the **one piece of shared mutable state**, and Playwright runs N workers as separate OS processes against the same disk. Healenium sidesteps this with a central PostgreSQL server — explicitly out of scope here (offline, zero-infra). Options, with the recommendation:

| Strategy | Read | Write | Verdict |
|----------|------|-------|---------|
| Single `baseline.json`, naive write | fast | **race: last-writer-wins, lost fingerprints** | Reject |
| Single file + advisory file lock (`proper-lockfile`) | fast | serialised, correct, but lock contention under high parallelism | Acceptable for small suites |
| **Per-worker shard files written during the run, merged once in `globalTeardown`** | fast (read merged baseline from previous run) | **lock-free: each worker owns `baseline.<workerIndex>.jsonl`** | **Recommended** |

**Recommended model — read-mostly baseline, append-only deltas:**

1. `globalSetup` loads the committed/previous `baseline.json` into the canonical read path (read-only during the run — never written by workers).
2. During the run, captures append to a **worker-private** `.selfheal/shards/<workerIndex>.jsonl`. No two workers touch the same file, so no lock is needed (`workerIndex` is unique and stable per Playwright docs).
3. `globalTeardown` merges all shards into the canonical `baseline.json` (newest-wins per key) and deletes shards.
4. Heals **read** from the in-memory baseline loaded at worker start; they never need to read another worker's fresh captures within the same run.

This makes the hot path lock-free, keeps writes embarrassingly parallel, and confines the one tricky merge to a single-threaded teardown step. It also matches the "v1 surfaces via console, no committed heal store" constraint — the merged baseline is the only persisted artifact, and committing it is the user's choice.

## Build Order (driven by dependencies)

```
1. config/            (no deps; everything reads it)
2. fingerprint/types  + matching/scoring (PURE)  + matching/decision (PURE)
       └─ TDD core: scoring + thresholding against hand-built fixtures, no browser
3. store/             (read/write API + sharded persistence; testable with tmp dirs)
4. fingerprint/capture + matching/candidate-finder  (page.evaluate adapters)
5. rebind/            (candidate → Locator)
6. integration/       (locator-proxy + fixture: wires 2–5 into the live loop)
7. reporter/          (consumes events emitted by step 6 via testInfo.attach)
8. index.ts           (public surface: test + reporter + config)
```

Rationale: the pure scoring/decision core (step 2) has zero dependencies and the highest logic risk, so it is built and TDD-driven first. The store (step 3) is independently testable against temp directories. The Playwright-coupled adapters (4–7) layer on top and are integration-tested last because they need a real browser/page.

## Anti-Patterns

### Anti-Pattern 1: Healing inside the Reporter

**What people do:** Try to detect failures in `onTestEnd` and re-run/fix them from the reporter.
**Why it's wrong:** Reporters run in the main process with no `page`/DOM access and after the test has already finished. You cannot rebind a locator there.
**Do this instead:** Do all DOM work in the worker via the wrapped `page` fixture; use the reporter only to aggregate and print events the worker emitted.

### Anti-Pattern 2: Shared single-file store written by every worker

**What people do:** Append to one `baseline.json` from every worker on every capture.
**Why it's wrong:** Concurrent writes across processes race and silently drop fingerprints.
**Do this instead:** Per-worker shard files (lock-free) merged in `globalTeardown`, or an advisory file lock for small suites.

### Anti-Pattern 3: Healing locators the plugin has never fingerprinted

**What people do:** On any failure, scan the DOM and bind the best-looking element.
**Why it's wrong:** With no baseline there's nothing to score against — this is guessing, and produces false greens, the category's cardinal sin.
**Do this instead:** No fingerprint for the key → re-throw the original error. Heal only above an explicit confidence floor.

### Anti-Pattern 4: Over-capturing on every resolution

**What people do:** Run the full signal-extraction `page.evaluate` on every locator action.
**Why it's wrong:** Adds latency to every green action and bloats the store with duplicates.
**Do this instead:** Capture once per locator key per run (skip if a current fingerprint exists), gated by config.

## Integration Points

### Playwright surfaces (external)

| Surface | Integration Pattern | Notes |
|---------|---------------------|-------|
| `test.extend` (page fixture) | Override `page`, return wrapped object | Only runtime DOM-control seam |
| `Locator` | `Proxy`/wrapper intercepting resolve + catch | Proxy generically so no method loses healing |
| `page.evaluate` | Inject signal-extractor + candidate-finder fns | Browser-side code; keep serialisable + dependency-free |
| Reporter API (`onTestEnd`/`onEnd`) | Collect attachments, render summary | No DOM, no worker memory — aggregation only |
| `testInfo.attach` | Worker→main heal-event channel | The only stable cross-process path (custom IPC unavailable) |
| `globalSetup`/`globalTeardown` | Load baseline / merge shards | Bookends the run, single-threaded |

### Internal boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| integration ↔ matching | direct call into PURE scoring/decision | matching imports nothing from PW — keep it that way |
| integration ↔ store | read on heal, append on capture | store hides the sharding strategy |
| worker ↔ reporter | `testInfo.attach` (serialised JSON events) | one-way, async, per-test |
| config → all | injected via worker-scoped fixture | single source of truth |

## Sources

- [Playwright Fixtures — test.extend / overriding page](https://playwright.dev/docs/test-fixtures) — HIGH
- [Playwright Locator class — resolution semantics, elementHandle](https://playwright.dev/docs/api/class-locator) — HIGH
- [Playwright Reporter API — onTestEnd / onEnd / onExit lifecycle](https://playwright.dev/docs/api/class-reporter) — HIGH
- [Playwright TestInfo — attach() and attachments, workerIndex](https://playwright.dev/docs/api/class-testinfo) — HIGH
- [Playwright Global setup and teardown — shared state via disk](https://playwright.dev/docs/test-global-setup-teardown) — HIGH
- [microsoft/playwright#31559 — custom worker↔main IPC for reporters (unavailable)](https://github.com/microsoft/playwright/issues/31559) — MEDIUM (open feature request confirms the constraint)
- [Healenium architecture — fingerprint signals, weighted scoring, LCS path distance](https://deepwiki.com/healenium/healenium-web/1-introduction-to-healenium) — MEDIUM (prior-art for scoring; their central-DB model is explicitly out of scope here)

---
*Architecture research for: offline locator-only self-healing Playwright plugin*
*Researched: 2026-05-31*
