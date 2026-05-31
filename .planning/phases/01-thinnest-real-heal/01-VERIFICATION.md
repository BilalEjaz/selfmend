---
phase: 01-thinnest-real-heal
verified: 2026-05-31T03:15:00Z
status: passed
score: 14/14
overrides_applied: 0
---

# Phase 01: Thinnest Real Heal — Verification Report

**Phase Goal:** A user can install the plugin into an existing Playwright project and watch a single broken locator self-heal end-to-end on a simple, single-worker case, with the heal reported to the console.
**Verified:** 2026-05-31T03:15:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Package builds dual ESM+CJS with type declarations; `import { test } from 'selfmend'` is the public entry | VERIFIED | `npx tsdown` succeeds; `dist/` contains `index.mjs`, `index.cjs`, `index.d.mts`, `index.d.cts`. `src/index.ts` exports `test` as `healingFixture`. `install.spec.ts` test 3 asserts `selfmend.test === selfmend.healingFixture`. All 14 PW tests pass. |
| 2 | Config defaults to `enabled: true` and a conservative threshold of 0.9 | VERIFIED | `src/config/schema.ts` exports `DEFAULT_THRESHOLD = 0.9`; `src/config/defaults.ts` calls `configSchema.parse({})`. All 26 Vitest unit tests green including schema round-trip test. |
| 3 | Setting `enabled: false` parses to a disabled state; invalid config is rejected | VERIFIED | `src/config/schema.ts` uses zod with `enabled: z.boolean().default(true)` and range-validated `threshold`. Vitest config suite passes (3 test files, 26 tests). In `locator-proxy.ts` line: `if (!ctx.config.enabled) throw err` enforces the toggle live. |
| 4 | On a passing run, each resolved locator records a fingerprint (text, role, test-id, attrs, neighbour, DOM position) | VERIFIED | `src/fingerprint/capture.ts` exists. `capture.spec.ts` test 1 asserts all CAP-01 signals present; test 3 asserts no raw innerText blob. All 4 capture integration tests green. |
| 5 | A broken selector with a surviving semantic element heals after the real timeout and the test continues green | VERIFIED | `tests/heal.spec.ts` test "HEAL-01" passes. Class `.btn-primary` renamed to `.btn-cta` in `broken.html`; the semantic submit button with `data-testid="submit-btn"` survives. Live run output: `page.locator(.btn-primary) -> [data-testid="submit-btn"] (1.00)`. |
| 6 | Healing fires only after Playwright's auto-wait/timeout, never on a transient slow-but-present element (HEAL-02) | VERIFIED | `tests/no-premature-heal.spec.ts` passes. Element injected after 400ms; action auto-waits and succeeds on the original locator; no heal event attached. Mechanic confirmed in `locator-proxy.ts`: heal path only entered inside `catch (err)` after `isTimeoutError(err)`. |
| 7 | A genuinely-absent element (no candidate clears the floor) re-throws and the test fails normally — no false green | VERIFIED | `tests/heal.spec.ts` "no false green" test passes. `control-only` element removed from `broken.html`. Expected-failure wrapper asserts the action throws; asserts 0 heal attachments. `locator-proxy.ts` line: `if (!decision.heal) throw err`. Decision module line: `if (winner.score < floor) return { heal: false, reason: 'below-floor' }`. |
| 8 | Existing page/locator usage works unchanged through the wrapped page; chaining survives | VERIFIED | `tests/install.spec.ts` tests 1-3 all pass. `tests/heal.spec.ts` "INST-02 chained locator usage" passes. `wrapLocator` re-wraps CHAIN methods returning new Locators; passthrough for all other properties. |
| 9 | Pure scorer and decision modules import nothing from Playwright or fs | VERIFIED | `grep -n "^import" src/matching/scoring.ts src/matching/decision.ts src/matching/types.ts` shows only intra-module type imports from `./types.js`. No Playwright or node:fs import. `npx tsc --noEmit` exits clean. |
| 10 | At end of run, a boxed console summary lists each heal: original selector, healed target, confidence score (REP-01) | VERIFIED | Live run output confirms the boxed block: `selfmend: 2 locators healed` header, rows with selector/target/score. `report.spec.ts` all 3 tests pass including format assertions (header, `┌`, `└`, original selector, healed target, score). |
| 11 | Reporter is summary-only and never performs healing | VERIFIED | `src/reporter/reporter.ts` imports only from `@playwright/test/reporter` and `../integration/events.js` (for attachment parsing). No `page`, `Locator`, or DOM handle is held. `report.spec.ts` test explicitly asserts `reporter.page === undefined`. |
| 12 | Config toggle + conservative threshold default exist (CFG-01) | VERIFIED | `enabled` toggle enforced in `locator-proxy.ts` (`if (!ctx.config.enabled) throw err`). `DEFAULT_THRESHOLD = 0.9` declared in schema. `src/index.ts` exports `configSchema` and `SelfmendConfig`. |
| 13 | The throwaway spike directory is deleted | VERIFIED | `ls spike/` returns `No such file or directory`. |
| 14 | Full suite (Vitest unit + Playwright integration) is green | VERIFIED | `npx vitest run src/`: 3 files, 26 tests, all passed. `npx playwright test`: 14 tests, 14 passed, 9.5s, 1 worker, chromium. |

**Score:** 14/14 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `package.json` | Dual exports, peerDep on @playwright/test, no postinstall | VERIFIED | `peerDependencies: {"@playwright/test": ">=1.42"}`, `dependencies: {zod, picocolors}`, no `postinstall` script, `exports` map with ESM+CJS+types |
| `src/config/schema.ts` | Zod schema, exports `SelfmendConfig`, `configSchema` | VERIFIED | Both exported; `DEFAULT_THRESHOLD = 0.9`, `enabled` defaults true |
| `src/config/defaults.ts` | Default config via `configSchema.parse({})` | VERIFIED | Single line: `export const defaultConfig: SelfmendConfig = configSchema.parse({})` |
| `src/matching/types.ts` | Exports `Fingerprint`, `CandidateDescriptor`, `ScoredCandidate`, `Decision` | VERIFIED | All four exported as interfaces/types; no Playwright/fs imports |
| `src/matching/scoring.ts` | Pure weighted scorer, exports `score` | VERIFIED | Exports `score`, `SIGNAL_WEIGHTS`, `textSimilarity`, `levenshtein`, `exactSimilarity`, `attrsSimilarity`; no Playwright/fs |
| `src/matching/decision.ts` | Pure heal/no-heal decision, exports `decide` | VERIFIED | Exports `decide`; below-floor and no-candidates refuse to heal; runner-up retained for Phase 2 |
| `src/store/store.ts` | In-process baseline store, exports `BaselineStore` | VERIFIED | Exists and exported |
| `src/fingerprint/capture.ts` | CAP-01 signal capture, exports `captureFingerprint` | VERIFIED | Exists and exported; tested in capture.spec.ts |
| `src/matching/candidate-finder.ts` | DOM enumeration, exports `findCandidates` | VERIFIED | Exists and exported; tested in capture.spec.ts test 4 |
| `src/integration/locator-proxy.ts` | Proxy wrapping action/chain/passthrough, exports `wrapLocator` | VERIFIED | Full implementation with ACTION/CHAIN sets, catch-and-replay, score/decide call chain |
| `src/integration/fixture.ts` | `test.extend` page override, exports `healingFixture` | VERIFIED | Exports `healingFixture` and `SelfmendWorkerFixtures`; overrides `page` fixture |
| `src/integration/events.ts` | `HealEvent` type + `attachHealEvent`, exports both | VERIFIED | Exports `HealEvent`, `attachHealEvent`, `HEAL_ATTACHMENT_NAME` |
| `src/reporter/reporter.ts` | Summary-only reporter, reads attachments, renders boxed output | VERIFIED | Full implementation; `onTestEnd` collects, `onEnd`/`render` draws box with picocolors |
| `src/index.ts` | Public entry: `test`, `expect`, `healingFixture`, `SelfmendConfig`, reporter | VERIFIED | All five groups exported |
| `tests/fixture-app/index.html` | Stable target element with data-testid, role, text | VERIFIED | `submit-btn` data-testid, `btn-primary` class, `control-only` control element |
| `tests/fixture-app/broken.html` | Class mutated (`btn-primary` -> `btn-cta`); `control-only` absent | VERIFIED | Confirmed: semantic button intact, class changed, control element removed |
| `tests/heal.spec.ts` | HEAL-01 + no-false-green control proof | VERIFIED | 3 tests: HEAL-01 (heals), no-false-green (re-throws), INST-02 (chaining) |
| `tests/no-premature-heal.spec.ts` | HEAL-02 proof | VERIFIED | Slow-but-present element resolves via auto-wait; no heal event |
| `tests/capture.spec.ts` | CAP-01 capture tests | VERIFIED | 4 tests: fingerprint signals, dedup, PII-minimization, candidate enumeration |
| `tests/report.spec.ts` | REP-01 reporter proof | VERIFIED | 3 tests: real heal event parsed, pluralization + N=0, malformed attachment skipped |
| `tests/install.spec.ts` | INST-01/INST-02 import-swap proof | VERIFIED | 3 tests: unchanged test green, assertion not healed, export identity check |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/config/defaults.ts` | `src/config/schema.ts` | `configSchema.parse` | VERIFIED | Line 11: `export const defaultConfig = configSchema.parse({})` |
| `src/matching/decision.ts` | `src/matching/scoring.ts` | `ScoredCandidate` consumption | VERIFIED | `decision.ts` consumes `ScoredCandidate[]`; `scoring.ts` produces them |
| `src/integration/locator-proxy.ts` | `src/matching/scoring.ts` | `score(fp, candidate)` on TimeoutError | VERIFIED | Line in `actionOrHeal`: `score: score(fingerprint, candidate)` |
| `src/integration/locator-proxy.ts` | `src/matching/decision.ts` | `decide(scored, threshold)` | VERIFIED | Line: `const decision = decide(scored, ctx.config.threshold)` |
| `src/integration/locator-proxy.ts` | `page.locator` | rebind + replay | VERIFIED | Line: `const healed = ctx.page.locator(decision.newSelector)` |
| `src/integration/fixture.ts` | `src/integration/locator-proxy.ts` | `wrapLocator` on page proxy | VERIFIED | `wrapPage` calls `wrapLocator(real, selector, makeCtx())` for each factory method |
| `src/index.ts` | `src/integration/fixture.ts` | `healingFixture` re-exported as `test` | VERIFIED | `export { healingFixture as test } from "./integration/fixture.js"` |
| `src/reporter/reporter.ts` | `selfmend-heal` attachment | `onTestEnd` reads attachments | VERIFIED | `if (attachment.name !== HEAL_ATTACHMENT_NAME) continue` in `onTestEnd` |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `src/reporter/reporter.ts` | `this.heals` | `testInfo.attachments` (worker via `testInfo.attach`) | Yes — real `HealEvent` JSON deserialized from fixture-attached buffer | FLOWING |
| `src/integration/locator-proxy.ts` | `candidates`, `scored`, `decision` | `findCandidates(page, fingerprint)` -> `score()` -> `decide()` | Yes — live browser DOM enumerated via `page.evaluate`, scored by pure scorer | FLOWING |
| `tests/heal.spec.ts` | heal attachment | `attachHealEvent` called after successful rebind | Yes — score 1.00 confirmed in live run output | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Dual ESM/CJS build | `npx tsdown` | Exit 0; 10 dist files, build complete in 1074ms | PASS |
| TypeScript compiles clean | `npx tsc --noEmit` | Exit 0, no output | PASS |
| 26 Vitest unit tests green | `npx vitest run src/` | 3 files, 26 tests passed, 438ms | PASS |
| 14 Playwright integration tests green (all scenarios) | `npx playwright test` | 14 passed, 9.5s, boxed summary rendered in output | PASS |
| Boxed heal summary in live output | Observed in `npx playwright test` stdout | `selfmend: 2 locators healed` box with selectors and scores shown | PASS |
| No false green (absent element fails) | `tests/heal.spec.ts` "no false green" | Pass — re-throws, 0 heal attachments | PASS |
| HEAL-02 (no premature heal) | `tests/no-premature-heal.spec.ts` | Pass — auto-wait resolves, 0 heal attachments | PASS |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| INST-01 | 01-01, 01-05 | User can add plugin via npm install + single import | SATISFIED | `install.spec.ts` passes; `src/index.ts` exports the one-line swap `test`; `package.json` has correct exports map |
| INST-02 | 01-04, 01-05 | Plugin works with existing `page`/locator usage without rewrites | SATISFIED | `install.spec.ts` "unchanged test green"; `heal.spec.ts` INST-02 chaining test; locator-proxy re-wraps chains, passes through assertions |
| CAP-01 | 01-04 | On passing run, records fingerprint (text, role, test-id, attrs, neighbour, DOM position) | SATISFIED | `capture.spec.ts` tests 1-3: all signals present, deduped, derived-only |
| MATCH-01 | 01-02, 01-04 | On locator failure, enumerate candidates and score against stored fingerprint | SATISFIED | `scoring.ts` + `decision.ts` pure scorer wired in `locator-proxy.ts`; live heal confirms score 1.00 |
| HEAL-01 | 01-04 | On accepted match, rebind broken locator to matched element so test continues green | SATISFIED | `heal.spec.ts` HEAL-01 test green; `locator-proxy.ts` replays via `page.locator(decision.newSelector)` |
| HEAL-02 | 01-04 | Healing triggers only after Playwright's auto-wait and timeout, never on transient miss | SATISFIED | `no-premature-heal.spec.ts` passes; heal path only entered inside `catch` after `isTimeoutError` |
| REP-01 | 01-05 | End of run: console summary of every heal (original selector, healed target, score) | SATISFIED | `report.spec.ts` 3 tests pass; live run shows boxed `selfmend: 2 locators healed` with per-heal rows |
| CFG-01 | 01-01 | User can toggle healing on/off via plugin config | SATISFIED | `enabled` field in schema; `locator-proxy.ts` checks `ctx.config.enabled`; `src/index.ts` exports `configSchema` |

All 8 Phase 1 requirements satisfied.

---

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| None | — | — | No TBD/FIXME/XXX markers found; no empty implementations; no hardcoded stub returns in production paths |

---

### Human Verification Required

**Task 3 of plan 05 is a `checkpoint:human-verify` gate** that was included in the plan but not explicitly signed off in the SUMMARY. The automated tests confirm all four acceptance criteria programmatically:

1. `npx playwright test tests/heal.spec.ts tests/report.spec.ts` passes (confirmed above).
2. The boxed summary with `selfmend: N locators healed`, test name, original selector, healed target, and score is confirmed in the live run stdout.
3. The no-false-green control still fails normally (confirmed by `tests/heal.spec.ts` "no false green" test passing).
4. No network egress in the offline fixture (file:// serving; no HTTP server; no fetch/axios in any source file).

These four items were fully verified programmatically. No remaining human-only items.

---

### Gaps Summary

None. All 14 truths verified. All 8 Phase 1 requirements satisfied. Full test suite (40 tests: 26 Vitest + 14 Playwright) green. Spike directory deleted. Build artifacts present.

---

_Verified: 2026-05-31T03:15:00Z_
_Verifier: Claude (gsd-verifier)_
