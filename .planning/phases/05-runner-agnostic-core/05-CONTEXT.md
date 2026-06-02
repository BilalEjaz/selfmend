# Phase 5: Runner-Agnostic Core - Context

**Gathered:** 2026-06-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Turn selfmend's existing healing engine into a runner-agnostic core with a public `wrapPage(page, opts)` entry, then refactor the `@playwright/test` fixture to sit on top of that same core with zero behaviour change. Two seams become pluggable: identity (today `testFile`/`testTitle` from `testInfo`) and heal-event transport (today hardcoded to `attachHealEvent(testInfo, ...)`). The healing engine (fingerprint, score, decide, rebind) does NOT change.

In scope: WRAP-01 (public `wrapPage`), WRAP-02 (`scope()` identity read live), WRAP-03 (occurrence reset / retry-safety), WRAP-04 (fixture refactored onto the core, zero behaviour change).

Not in scope (later phases): standalone `loadBaseline`/`saveBaseline`/`mergeBaselines` + `onHeal`-driven persistence wiring + `renderHealSummary` (Phase 6); recipes and docs (Phase 7); BrowserContext-level wrapping (out of scope this milestone).
</domain>

<decisions>
## Implementation Decisions

### Public API shape
- **D-01:** `wrapPage(page: Page, opts): Page` returns the BARE wrapped page (drop-in, honours the adopter's original ask), so `this.page = wrapPage(rawPage, opts)` leaves all existing step/page-object code untouched.
  - `opts`: `{ store: BaselineStore; config?: Partial<SelfmendConfig>; onHeal?: (e: SelfmendEvent) => void; scope?: () => { suite: string; test: string } }`.
- **D-02:** Public exports from Phase 5: `wrapPage`, `BaselineStore` (type), `SelfmendConfig` (type, already exported), `SelfmendEvent`/`HealedEvent`/`RefusedEvent` (types, already exported), and a sibling `resetScope(page: Page): void` (see D-06). The Phase 6 persistence/output exports come later.

### scope() identity (WRAP-02)
- **D-03:** `scope?: () => { suite: string; test: string }` is read LIVE at each locator creation, so one long-lived page (e.g. a per-feature page) tracks the current logical test. The cross-run key stays `suite :: test :: selector :: occurrence` (same format as today, just caller-supplied). NEVER derived from the page URL or path.
- **D-04:** No-scope default is a COARSE key: `suite = ""`, `test = ""`. `wrapPage` works out of the box (captures and heals), but all locators on the page share one scope, so look-alikes collide more and the margin gate refuses more often. This is fail-safe (more missed heals, never a wrong heal). Docs strongly recommend supplying `scope()` for real suites.

### Retry / occurrence reset (WRAP-03)
- **D-05:** AUTO-reset: selfmend resets the occurrence counter whenever `scope()` returns a `(suite, test)` tuple DIFFERENT from the immediately-previous call. The normal between-tests transition needs zero caller wiring. The existing D-04/D-05 per-content occurrence semantics are otherwise unchanged (deterministic creation-order count, identical on green capture and broken heal runs).
- **D-06:** EXPLICIT reset: a sibling export `resetScope(page: Page): void` forces a counter reset for same-scope retries on a reused page (the auto-reset cannot see a retry that re-enters the identical tuple). Implemented by stashing the wrapped page's counter controller in a `WeakMap` keyed by the returned proxy, so the bare-Page return (D-01) is preserved. Callers wire it in a Before hook only if they have same-scope retries; omitting it is fail-safe (a missed heal on retry, never a wrong heal).

### onHeal semantics (carried into Phase 6 for wiring, decided here)
- **D-07:** `onHeal` is FIRE-AND-FORGET with errors swallowed: it is called but not awaited, and a throw or rejected promise is caught and ignored. It can never slow, stall, or break a test. This matches the existing reporter-attach invariant (observability is best-effort and must never affect the run). It receives the full `SelfmendEvent` union (both healed and could-not-heal events).

### Pluggable transport refactor (the core seam)
- **D-08:** Replace the hardcoded `attachHealEvent(ctx.testInfo, ...)` / `attachRefusedEvent(ctx.testInfo, ...)` calls in `locator-proxy.ts` with a pluggable `emit(event: SelfmendEvent)` on `HealContext`. The core never references `testInfo`. The `@playwright/test` adapter builds `emit` as the existing `testInfo.attach` path; `wrapPage` builds `emit` as the fire-and-forget guarded `onHeal` call (D-07). `emit` is itself best-effort (a failing emit never suppresses the original error, the existing guard).
- **D-09:** Replace `HealContext.testFile`/`testTitle` with a scope source feeding the `(suite, test)` key. The `@playwright/test` adapter maps `suite = testFile` and `test = testTitle` (the file-rooted `titlePath`) EXACTLY as today, so existing committed baselines and keys are byte-identical and WRAP-04 holds (zero behaviour change).

### WRAP-04 zero-behaviour-change guard
- **D-10:** After the refactor, the `@playwright/test` fixture must produce identical keys and identical attachments to before, and the full existing suite (125 unit + 23 e2e) must stay green. This is the proof the new seam is correct, and it is a hard acceptance gate, not a nice-to-have.

### Never-false-green in raw mode (the invariant)
- **D-11:** The never-false-green guarantee lives unchanged in the pure `decide()` (floor + second-best margin + fail-safe on a missing key). It is invariant across both adapters. A coarse, missing, or wrong identity key produces a MISSED heal (no candidate matches, or ambiguous, so no heal and the original error re-throws), NEVER a wrong heal or a false green. This must be control-tested in raw mode (a wrapPage test where a deliberately-wrong scope yields no heal and the test fails normally).

### Claude's Discretion
- The internal mechanics: how `HealContext` is restructured (drop `testInfo`/`testFile`/`testTitle`, add `emit` + scope source), the `WeakMap` controller for `resetScope`, the exact auto-reset detection (track last-seen tuple), config merge via the existing zod schema, and `replayTimeoutMs` defaulting in raw mode. Keep the pure matching core untouched and build test-first per the project's TDD default.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project-level
- `.planning/PROJECT.md` : `## Current Milestone: v0.2.0` (goal, features, hard constraints).
- `.planning/REQUIREMENTS.md` : Phase 5 owns WRAP-01, WRAP-02, WRAP-03, WRAP-04; plus the cross-cutting never-false-green rule.
- `.planning/ROADMAP.md` : Phase 5 goal + success criteria.

### Code this phase generalizes (read before changing)
- `src/integration/locator-proxy.ts` : `HealContext` interface (currently has `testInfo`, `testFile`, `testTitle`, `nextOccurrence`); `wrapLocator`; the get-trap that calls `attachHealEvent`/`attachRefusedEvent`. This is where the transport + identity seams are.
- `src/integration/fixture.ts` : the internal `wrapPage(realPage, nextOccurrence, makeCtx)` to lift public; the `@playwright/test` fixture that builds the ctx from `testInfo`; `createOccurrenceCounter`; `buildPageSelector`; `describeArgs` (the LO-02-hardened version).
- `src/integration/events.ts` : `SelfmendEvent = HealedEvent | RefusedEvent`, `attachHealEvent`, `attachRefusedEvent` (the existing transport to generalize behind `emit`).
- `src/index.ts` : the public entry to add `wrapPage` + `resetScope` exports to.
- `src/config/schema.ts` : `SelfmendConfig` + defaults for the config merge.
- `.planning/phases/03-persistence-parallel-worker-safety/03-02-SUMMARY.md` : the occurrence-key + describeArgs history (D-04/D-05/LO-02) this phase preserves.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Internal `wrapPage` (fixture.ts) already proxies the page and wraps the locator factories; the public version is a generalization, not a rewrite.
- `wrapLocator` + the get-trap (including the Phase 1.1 `constructor`-passthrough fix and the LO-02 `describeArgs` hardening) are reused as-is; only the ctx it consumes changes.
- `createOccurrenceCounter` is reused; the lifetime (auto-reset on scope change + explicit `resetScope`) wraps around it.
- `SelfmendEvent` union + the reporter's parse path are reused; only the producer side (emit) becomes pluggable.

### Established Patterns
- Pure matching core (`scoring.ts`, `decision.ts`, `types.ts`) imports nothing from Playwright/fs and must stay that way.
- Observability is best-effort and must never affect the run (the existing attach guard; D-07/D-08 extend this to `emit`/`onHeal`).
- TDD RED -> GREEN for logic; the auto-reset and the scope-keying are prime test-first targets (pure-ish, testable without a browser via the counter/ctx).

### Integration Points
- `wrapPage` <-> `wrapLocator` via the per-locator `HealContext` (now built from `scope()` + `emit` instead of `testInfo`).
- `@playwright/test` fixture becomes one adapter building `emit = testInfo.attach` and `scope = () => ({ suite: testFile, test: testTitle })`.
- `src/index.ts` public surface gains `wrapPage` + `resetScope`.

</code_context>

<specifics>
## Specific Ideas

- `wrapPage(page, { store, config?, onHeal?, scope? }): Page`, bare-Page return.
- `resetScope(page): void` sibling export, WeakMap-backed.
- Adapter mapping for zero-change: `suite = testFile`, `test = testTitle`.
- Coarse default `{ suite: "", test: "" }`, never URL.

</specifics>

<deferred>
## Deferred Ideas

- Standalone `loadBaseline`/`saveBaseline`/`mergeBaselines` + `renderHealSummary` + `onHeal`-driven persistence: Phase 6.
- Recipes + docs (Cucumber, Mocha/Jest, plain script): Phase 7.
- BrowserContext-level wrapping (auto-wrap every page a context opens): out of scope this milestone.
- A single-string scope convenience: rejected for now (two keys are what prevent cross-test collisions).

</deferred>

---

*Phase: 5-Runner-Agnostic Core*
*Context gathered: 2026-06-01*
