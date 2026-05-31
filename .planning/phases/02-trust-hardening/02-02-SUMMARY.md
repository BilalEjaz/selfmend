---
phase: 02-trust-hardening
plan: 02
subsystem: refused-heal observability (transport + proxy + reporter + integration proof)
tags: [transport, tagged-union, refused-heal, reporter, no-false-green, match-04, rep-02, playwright]
requires:
  - "decide(scored, { floor, margin }) with bestScore on every no-heal + ambiguous reason (Plan 02-01)"
  - "src/integration/events.ts HEAL_ATTACHMENT_NAME + attachHealEvent (Phase 1)"
  - "src/integration/locator-proxy.ts actionOrHeal decide() call site (Phase 1)"
  - "src/reporter/reporter.ts boxed summary + parseHealEvent + box helpers (Phase 1)"
provides:
  - "SelfmendEvent = HealedEvent | RefusedEvent tagged union on the unchanged selfmend-heal attachment"
  - "attachRefusedEvent(testInfo, RefusedEvent) helper (mirrors attachHealEvent)"
  - "proxy attaches a refused event then unconditionally re-throws the original error (no false green)"
  - "reporter could-not-heal section (locator, reason, best score) beneath the healed box"
  - "parseEvent branching on kind (missing kind -> healed; defensive skip; unknown reason rejected)"
  - "ambiguous-duplicate fixtures + Playwright proof (empirical 0.05 margin calibration)"
affects:
  - "consumers reading selfmend-heal attachments now receive a tagged union (back-compat: missing kind = healed)"
tech-stack:
  added: []
  patterns:
    - "Tagged-union wire contract with implicit-default discriminant for back-compat (missing kind -> healed)"
    - "Attach-then-throw: guard the attach (not the throw) so observability never suppresses a failure"
    - "Two-array reporter (heals / refused) with per-section N=0 guards reusing one box helper set"
key-files:
  created:
    - "tests/fixture-app/ambiguous.html"
    - "tests/fixture-app/ambiguous-broken.html"
    - "tests/ambiguous-no-heal.spec.ts"
    - ".planning/phases/02-trust-hardening/02-02-SUMMARY.md"
  modified:
    - "src/integration/events.ts"
    - "src/integration/locator-proxy.ts"
    - "src/reporter/reporter.ts"
    - "src/reporter/reporter.test.ts"
decisions:
  - "Refused reasons scoped to the 3 post-scoring reasons (no no-fingerprint), per RESEARCH Open Q1/A3"
  - "Missing kind decodes as healed; unknown reason / bad bestScore are skipped, not fatal (Pitfall 4 / T-02-05)"
  - "Both ambiguous survivors share data-testid so the test-id selector is non-unique, forcing per-row #id structural selectors and two identity-equal candidates within the 0.05 margin"
metrics:
  duration: 6 min
  completed: 2026-05-31
  tasks: 4
  files: 8
---

# Phase 02 Plan 02: Refused-Heal Observability Slice Summary

Landed the user-visible payoff of Phase 2 as one vertical: the transport event widened into a `SelfmendEvent` tagged union, the proxy now attaches a refused event then unconditionally re-throws on every post-scoring refusal, the reporter renders a separate could-not-heal section beneath the healed box, and a Playwright integration test proves an ambiguous duplicate FAILS (not heals) while the genuine single-survivor heal still heals — the empirical 0.05-margin calibration.

## What Was Built

- **Task 1 (transport tagged union, events.ts):** Widened the TRANSPORT contract only (pure `types.ts` untouched). `HealEvent` gained an optional `kind: "healed"` discriminant; added `HealedEvent` alias, `RefusedReason` (the 3 post-scoring reasons, no `no-fingerprint`), `RefusedEvent = { kind:"refused"; testName; originalSelector; reason; bestScore: number|null }`, and `SelfmendEvent = HealedEvent | RefusedEvent`. `attachHealEvent` now stamps `kind:"healed"` (explicit tag, old/missing-kind still decode as healed). Added `attachRefusedEvent` mirroring it on the unchanged `selfmend-heal` attachment.
- **Task 2 (proxy attach-then-rethrow, locator-proxy.ts):** On `!decision.heal`, the proxy now builds a `RefusedEvent` from `decision.reason`/`decision.bestScore` and `attachRefusedEvent`s it, THEN unconditionally `throw err`. The attach is wrapped in try/catch so a failed attach can never mask the original failure (D-06, Pitfall 2); the throw is outside that guard. Scoped by an explicit reason check to the three post-scoring reasons (also satisfies the `RefusedReason` type, which excludes `no-fingerprint`). The `no-fingerprint` early re-throw and the replay-failure catch are unchanged (no refused event in either).
- **Task 3 (reporter could-not-heal section, reporter.ts):** Generalized `parseHealEvent` into `parseEvent` branching on `kind` (missing/`"healed"` -> healed arm; `"refused"` -> refused arm with reason-membership + bestScore validation; malformed/unknown-reason -> `null` skip). Two arrays (`heals`, `refused`); `render()` prints the healed box first (unchanged), then — only when `refused.length > 0` — a separate warning-colored "could NOT heal" section listing locator, reason, and best score (null -> dash), reusing the existing box/`visibleLength`/`stripAnsi` helpers. `parseHealEvent` kept as a back-compat alias. Reporter stays summary-only (no page/DOM).
- **Task 4 (ambiguous proof, fixtures + spec):** `ambiguous.html`/`ambiguous-broken.html` carry two `<button>Delete</button>` rows sharing `data-testid="delete-item"`, text, and role, in per-row `#row-a`/`#row-b` `<li>`s. Because the shared test-id is non-unique, the candidate-finder falls to per-row structural selectors and yields two identity-equal candidates within 0.05. The spec captures the first row's volatile `.btn-delete-primary`, breaks it on the broken page, asserts `click()` rejects (no heal), and asserts no healed attachment plus exactly one `refused`/`ambiguous` event with `bestScore >= 0.9`.

## Verification

- `npx tsc --noEmit` — clean across the widened transport, proxy, and reporter.
- `npx vitest run` — 52 passed (6 files), including the new two-section render, missing-kind back-compat, malformed-skip, unknown-reason reject, and zero-refusal guard reporter cases.
- `npx playwright test` — 17 passed. The combined `ambiguous-no-heal.spec.ts` + `heal.spec.ts` run is the load-bearing calibration: the ambiguous duplicate is refused (`ambiguous`, best 1.00) AND the single-survivor heal still heals — 0.05 refuses the look-alike yet permits the real heal. Reporter prints both the healed box and the could-not-heal section over the full run.
- Reporter purity: grep finds no `Page`/`page.`/`evaluate`/`document` in reporter.ts (summary-only, D-05).
- Pure `src/matching/types.ts` confirmed untouched (only the transport `events.ts` widened, Pitfall 3).

## TDD Gate Compliance

MVP+TDD active. Behavior-adding work followed RED -> GREEN:
- Task 3 (reporter behavior): `test(02-02)` RED commit `df9f204` (2 failing: two-section render + malformed-skip surfacing) -> `feat(02-02)` GREEN commit `288be39`. No REFACTOR needed.
- Tasks 1 and 2 are transport/wiring whose runtime behavior is proven by the Task 4 Playwright integration test (the canonical MATCH-04/REP-02 proof) rather than a separate unit RED; Task 4 is itself a `test(02-02)` integration proof committed at `2128751` and passing on first wiring (calibration confirmed empirically, no margin change needed).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] RefusedReason type vs NoHealReason at the proxy attach site**
- **Found during:** Task 2 (tsc)
- **Issue:** `decision.reason` is typed `NoHealReason` (includes `no-fingerprint`), but `RefusedEvent.reason` is the narrower `RefusedReason`; assigning it directly failed `tsc` (TS2322).
- **Fix:** Added an explicit reason-membership check (`no-candidates`/`below-floor`/`ambiguous`) guarding the attach. This both narrows the type and makes the "scope refused reporting to the 3 post-scoring reasons" intent explicit at the call site. `decide()` never returns `no-fingerprint` in this path anyway (it is the earlier `store.get` re-throw), so no behavior changed.
- **Files modified:** src/integration/locator-proxy.ts
- **Commit:** 811ee47

**2. [Rule 3 - Blocking] Ambiguous survivors needed per-row ids to be addressable**
- **Found during:** Task 4 (fixture design)
- **Issue:** With two identity-equal buttons sharing test-id and aria-label, the candidate-finder's test-id and stable-attr selectors are both non-unique, and a bare `li > button:nth-of-type(1)` also matches both rows — leaving zero unique candidates (which would yield `no-candidates`, not `ambiguous`).
- **Fix:** Gave each `<li>` a stable id (`#row-a`/`#row-b`) so the structural fallback `#row-a > button:nth-of-type(1)` resolves uniquely per row, producing exactly two identity-equal candidates within the 0.05 margin -> `ambiguous` as intended.
- **Files modified:** tests/fixture-app/ambiguous.html, tests/fixture-app/ambiguous-broken.html
- **Commit:** 2128751

## Known Stubs

None. All deliverables are wired, rendered, and proven by tests.

## Threat Flags

None. The widened wire carries only derived audit fields (selectors, a reason string, a number); no new network/fs/DOM surface was introduced. The plan's threat register (T-02-04..T-02-07) is satisfied: attach-then-throw (T-02-04), defensive `parseEvent` skip (T-02-05), derived-only payload (T-02-06), missing-kind back-compat (T-02-07).

## Self-Check: PASSED

All created files exist on disk (events.ts widened, locator-proxy.ts wired, reporter.ts + reporter.test.ts updated, three new test/fixture files present) and all five task commits (683455b, 811ee47, df9f204, 288be39, 2128751) are in git history. Full suite green (52 vitest + 17 Playwright).
