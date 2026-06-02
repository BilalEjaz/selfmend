---
phase: 05-runner-agnostic-core
verified: 2026-06-02T12:44:31Z
status: passed
score: 5/5
overrides_applied: 0
---

# Phase 5: Runner-Agnostic Core Verification Report

**Phase Goal:** A developer driving a raw Playwright `Page` from any framework can call one `wrapPage(page, opts)` and have every locator on that page self-heal, with identity supplied by a caller `scope()` callback and heal events delivered through a pluggable transport, while the shipped `@playwright/test` fixture becomes one thin adapter over that same core with no behaviour change for existing users.
**Verified:** 2026-06-02T12:44:31Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Gate Results (Mandatory)

| Gate | Command | Result | Status |
| ---- | ------- | ------ | ------ |
| TypeScript compile | `npx tsc --noEmit` | exit 0, no errors | PASS |
| Vitest unit suite | `npx vitest run` | 15 files, **141 passed** (expected >=141) | PASS |
| Playwright e2e suite | `npx playwright test` | **28 passed** (23 pre-existing + 5 new raw-mode; expected 28) | PASS |
| matching/ unchanged | `git diff --stat HEAD~5..HEAD -- src/matching/` | empty diff | PASS |
| testInfo absent from core | `grep -n "testInfo" src/integration/locator-proxy.ts` | exit 1, zero matches | PASS |

---

## Goal Achievement

### Observable Truths (from ROADMAP.md Success Criteria)

| # | Truth | Status | Evidence |
| --- | ------- | ---------- | -------------- |
| 1 | A developer can wrap a raw `Page` with `wrapPage(page, { store, config?, onHeal?, scope? })` and a broken locator self-heals without the `@playwright/test` runner | VERIFIED | `src/integration/wrap-page.ts:wrapPage` — exported public function; `tests/wrap-page.spec.ts:55` test "WRAP-01: a broken-but-present locator heals green through wrapPage on a RAW page" passes; `onHeal` receives `kind:"healed"` event naming the stable testid target; score >= 0.9 |
| 2 | Identity from `scope()` callback read at each locator creation; occurrence resets per (suite,test); retry-safe | VERIFIED | `src/integration/wrap-page.ts:createScopeController` — reads `scope()` live inside `resolve()` per locator creation; auto-resets counter when `(suite,test)` tuple changes; `resetScope(page)` for same-scope retries via WeakMap; `src/integration/scope-lifetime.test.ts` + `src/integration/occurrence.test.ts` prove all three properties |
| 3 | Never-false-green in raw mode: wrong/absent scope produces a missed heal (test fails normally), never a wrong heal or false green, proven by a control test | VERIFIED | `tests/wrap-page.spec.ts:96` — "D-11 control: a deliberately-WRONG scope yields no heal and the action fails normally": scoped capture to "scope-A", heal attempt under "scope-B-deliberately-different" — `expect(async () => { await page.locator(".btn-primary").click(...) }).rejects.toThrow()` passes AND `events.filter(e => e.kind === "healed")` length = 0. `tests/wrap-page.spec.ts:132` adds a second control for genuinely-absent element. Both pass. |
| 4 | `@playwright/test` fixture is refactored onto the same `wrapPage` core — one code path, zero behaviour change, every existing test still passes | VERIFIED | `src/integration/fixture.ts:page` fixture override calls `wrapPage(page, { store, config, onHeal, scope, replayTimeoutMs })` wholesale — no parallel proxy/heal copy, no `wrapLocator` or `createOccurrenceCounter` directly; the pre-existing 23 e2e tests pass unchanged; boxed reporter output byte-identical (3 healed + 1 refused across heal/offline/report/ambiguous-no-heal specs) |
| 5 | Never-false-green invariant unchanged: lives in the pure `decide()` and is not touched by this phase | VERIFIED | `git diff --stat HEAD~5..HEAD -- src/matching/` empty; `src/matching/scoring.ts`, `decision.ts`, `types.ts` byte-untouched; `npx vitest run` 141 passed including all `decision.test.ts` + `scoring.test.ts` |

**Score: 5/5 truths verified**

---

## Per-Requirement Verdict

### WRAP-01 — public `wrapPage` so any framework driving a real Page self-heals

**Verdict: VERIFIED**

- **Symbol:** `src/integration/wrap-page.ts:wrapPage` (lines 203-270), exported from `src/index.ts:71`
- **Signature:** `wrapPage(page: Page, opts: WrapPageOptions): Page` — returns bare wrapped Page (drop-in, D-01)
- **Proving test:** `tests/wrap-page.spec.ts:55` — "WRAP-01: a broken-but-present locator heals green through wrapPage on a RAW page" — launches a plain Chromium browser, wraps raw `page` with `wrapPage`, captures on `index.html`, heals `.btn-primary` → `[data-testid="submit-btn"]` on `broken.html`, `onHeal` delivers `kind:"healed"` event; test passes.
- **Wire depth:** Proxy intercepts `PAGE_LOCATOR_FACTORIES`, builds `HealContext` with live scope + emit, calls `wrapLocator`; heal loop in `locator-proxy.ts:actionOrHeal` unchanged.

### WRAP-02 — `scope()` identity read live per locator creation

**Verdict: VERIFIED**

- **Symbol:** `src/integration/wrap-page.ts:createScopeController` (lines 98-126) — `resolve()` calls `readScope(scope)` at each invocation (inside the Proxy `get` trap, per-factory call)
- **Coarse default:** `COARSE_SCOPE = { suite: "", test: "" }` at line 46 — used when `scope` is absent or throws
- **Auto-reset:** `createScopeController` tracks `lastTuple`; when `current.suite !== lastTuple.suite || current.test !== lastTuple.test` it rebuilds `counter` (D-05)
- **Proving tests:**
  - `src/integration/scope-lifetime.test.ts` — unit-tests all three properties: live read, coarse default, auto-reset on tuple change, explicit reset
  - `tests/wrap-page.spec.ts:194` — "T-05-02: a THROWING scope() does not crash the wrap; falls back to coarse default and heals" — `scope: () => { throw new Error("scope blew up") }` still heals green

### WRAP-03 — occurrence reset per (suite, test) + retry-safe via `resetScope`

**Verdict: VERIFIED**

- **Auto-reset:** `createScopeController.resolve()` rebuilds `counter = createOccurrenceCounter()` on tuple change (covers normal between-tests transitions)
- **Explicit reset:** `resetScope(page)` (lines 281-284 of `wrap-page.ts`) — looks up `CONTROLLERS.get(page)`, calls `controller.reset()`. WeakMap keyed by the returned proxy preserves the bare-Page return (D-06).
- **Proving tests:**
  - `src/integration/scope-lifetime.test.ts` — tests auto-reset AND explicit reset
  - `src/integration/occurrence.test.ts` — migrated to emit+scope shape, asserts deterministic occurrence per content key

### WRAP-04 — fixture refactored onto the same core, zero behaviour change, every existing test passes

**Verdict: VERIFIED**

- **Single code path:** `src/integration/fixture.ts:page` override (lines 137-163) calls `wrapPage(page, { store: selfmendStore, config: selfmendConfig, onHeal: emit, scope: ..., replayTimeoutMs: ... })`. The internal `wrapPage(realPage, nextOccurrence, makeCtx)` proxy that the fixture used to own is deleted.
- **Byte-identical keys (D-09):** `scope: () => ({ suite: testInfo.file, test: testInfo.titlePath.join(" > ") })` — exact mapping of old `testFile`/`testTitle`; `BaselineStore.identify` uses same `testFile + " " + testTitle + " " + selector + " " + occurrence` format
- **Byte-identical attachments (D-08):** `onHeal` dispatches `attachHealEvent(testInfo, event)` / `attachRefusedEvent(testInfo, event)` keyed on `event.kind` — same attach name and body as pre-refactor
- **Regression gate:** 23 pre-existing e2e tests pass unchanged; boxed reporter output: 3 healed at 1.00 (heal/offline/report specs), 1 refused-ambiguous at 1.00 (ambiguous-no-heal spec) — byte-identical to before
- **Proving test:** The entire 23-test pre-existing e2e suite + `npx vitest run` 141 units

### Never-False-Green Hard Rule (cross-cutting)

**Verdict: VERIFIED — enforced in core AND control-tested in raw mode**

- **Where the invariant lives:** `src/matching/decision.ts:decide` — floor gate + second-best margin gate; if neither gate passes, `decide` returns `{ heal: false }` and `actionOrHeal` re-throws the original error
- **Core untouched:** `git diff --stat HEAD~5..HEAD -- src/matching/` empty; no changes to `scoring.ts`, `decision.ts`, `types.ts`
- **Fail-safe on absent key:** `locator-proxy.ts:actionOrHeal` line 382: `if (!fingerprint) throw err` — no fingerprint = no heal path entered
- **Raw-mode control tests (D-11):**
  - `tests/wrap-page.spec.ts:96` — wrong scope: capture under "scope-A", heal attempt with locator created under "scope-B-deliberately-different" — `expect(...).rejects.toThrow()` PASSES; `events.filter(e => e.kind === "healed").length === 0` PASSES — this is a genuine action failure on a wrong key, not just absence of a heal event
  - `tests/wrap-page.spec.ts:132` — absent element: no candidate above the floor — same fail pattern confirmed

---

## Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | ----------- | ------ | ------- |
| `src/integration/wrap-page.ts` | Public `wrapPage`, `resetScope`, `createScopeController`, `WrapPageOptions` | VERIFIED | 285 lines; substantive implementation |
| `src/integration/locator-proxy.ts` | `HealContext` with `emit`+`suite`+`test` (no `testInfo`), `wrapLocator`, `createOccurrenceCounter` | VERIFIED | Confirmed zero `testInfo` matches; `HealContext` has `emit: (event: SelfmendEvent) => void | Promise<void>` + `suite`/`test` strings |
| `src/integration/fixture.ts` | Delegates to `wrapPage`, adapter-only, no parallel proxy | VERIFIED | `page` fixture calls `wrapPage(page, {...})` wholesale; no direct `wrapLocator`/`createOccurrenceCounter` |
| `src/index.ts` | Exports `wrapPage`, `resetScope`, `BaselineStore`, `SelfmendEvent`/`HealedEvent`/`RefusedEvent`, `WrapPageOptions`, `Scope`, `ScopeSource` | VERIFIED | All confirmed present at lines 64-74 |
| `tests/wrap-page.spec.ts` | 5 raw-mode tests: heal-green, wrong-scope, absent-element, throwing onHeal, throwing scope | VERIFIED | All 5 tests exist and pass; test names match exactly |
| `src/integration/scope-lifetime.test.ts` | Scope controller unit coverage | VERIFIED | File exists and contributes to 141-test green suite |
| `src/integration/emit-seam.test.ts` | Emit seam unit coverage | VERIFIED | File exists and contributes to 141-test green suite |

---

## Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| `fixture.ts:page` override | `wrapPage` | `import { wrapPage } from "./wrap-page.js"` | WIRED | Direct call at line 145; no parallel proxy |
| `wrap-page.ts:wrapPage` | `locator-proxy.ts:wrapLocator` | `import { wrapLocator } from "./locator-proxy.js"` | WIRED | Called inside the Proxy get-trap (line 258) |
| `locator-proxy.ts:actionOrHeal` | `ctx.emit` | `await ctx.emit({ kind: "refused", ... })` / `await ctx.emit({ kind: "healed", ... })` | WIRED | Both paths guarded; emit errors swallowed; never suppresses original error |
| `fixture.ts:emit` | `events.ts:attachHealEvent/attachRefusedEvent` | `if (event.kind === "refused") await attachRefusedEvent(testInfo, event)` | WIRED | Line 138-143; byte-identical transport |
| `wrap-page.ts:resetScope` | `CONTROLLERS` WeakMap | `CONTROLLERS.get(page as unknown as object)` | WIRED | Line 282; `wrapPage` sets entry at line 268 |
| `src/index.ts` | `wrap-page.ts` | `export { wrapPage, resetScope, ... } from "./integration/wrap-page.js"` | WIRED | Lines 64-70 |

---

## Data-Flow Trace (Level 4)

The raw-mode heal path (WRAP-01) flows end-to-end in `tests/wrap-page.spec.ts`:

1. `new BaselineStore()` — in-process store, no disk
2. `wrapPage(raw, { store, onHeal, scope })` — proxy wraps page
3. `page.locator(".btn-primary")` — Proxy intercepts, `controller.resolve()` reads scope live, builds `HealContext` with `emit = fire-and-forget wrapper around onHeal`
4. `submit.waitFor()` on `index.html` — CAPTURE_ONLY path; `captureFingerprint` writes to `store`
5. `page.goto(BROKEN_URL)` — same wrapped locator, same key
6. `submit.click({ timeout: 1200 })` — ACTION path; real attempt times out; `store.get(key)` returns fingerprint; `findCandidates` + `score` + `decide`; heals to `[data-testid="submit-btn"]`; `ctx.emit` delivers `kind:"healed"` event to `onHeal`
7. `expect(events[0].kind).toBe("healed")` PASSES — real data flows, not a stub

| Artifact | Data Variable | Source | Produces Real Data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| `wrapPage` | `store` | `new BaselineStore()` → `captureFingerprint` | Yes — live DOM fingerprint | FLOWING |
| `actionOrHeal` | `fingerprint` | `store.get(key)` | Yes — live capture from prior action | FLOWING |
| `onHeal` callback | `events` array | `ctx.emit` → fire-and-forget | Yes — real `SelfmendEvent` | FLOWING |

---

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| `wrapPage` exported from package entry | `grep "wrapPage" src/index.ts` | Lines 65-70: `export { wrapPage, resetScope, type WrapPageOptions, type Scope, type ScopeSource } from "./integration/wrap-page.js"` | PASS |
| Zero `testInfo` in the core | `grep -n "testInfo" src/integration/locator-proxy.ts` | exit 1, no matches | PASS |
| matching/ untouched | `git diff --stat HEAD~5..HEAD -- src/matching/` | empty output | PASS |
| Fixture delegates to `wrapPage` | `grep "wrapPage\|wrapLocator" src/integration/fixture.ts` | Only `import { wrapPage }` and one call; no direct `wrapLocator` | PASS |
| `resetScope` uses WeakMap | `grep "CONTROLLERS" src/integration/wrap-page.ts` | `CONTROLLERS.set` at end of `wrapPage` + `CONTROLLERS.get` in `resetScope` | PASS |

---

## Anti-Patterns Found

None. All phase-modified files (`wrap-page.ts`, `locator-proxy.ts`, `fixture.ts`, `index.ts`, `tests/wrap-page.spec.ts`) contain zero `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` markers.

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ---------- | ----------- | ------ | -------- |
| WRAP-01 | 05-01-PLAN + 05-02-PLAN | Public `wrapPage` for any-framework self-heal | SATISFIED | `wrapPage` exported, 5 raw-mode tests pass |
| WRAP-02 | 05-01-PLAN | `scope()` read live per locator creation | SATISFIED | `createScopeController.resolve()` reads scope inside get-trap; scope-lifetime tests |
| WRAP-03 | 05-01-PLAN | Occurrence reset per (suite,test) + retry-safe | SATISFIED | Auto-reset on tuple change + `resetScope` WeakMap; occurrence tests |
| WRAP-04 | 05-02-PLAN | Fixture onto core, zero behaviour change | SATISFIED | Single `wrapPage` call in fixture; 23 pre-existing e2e unchanged; byte-identical keys/attachments |
| Never-false-green (cross-cutting) | Both plans | Wrong/absent key = missed heal, never false green | SATISFIED | Two control tests in wrap-page.spec.ts: both cause action failures AND zero healed events |

---

## Human Verification Required

None. All requirements are verifiable by static analysis and automated tests.

---

## Gaps Summary

No gaps found. All five must-haves are verified with file+symbol evidence and passing tests.

---

_Verified: 2026-06-02T12:44:31Z_
_Verifier: Claude (gsd-verifier)_
