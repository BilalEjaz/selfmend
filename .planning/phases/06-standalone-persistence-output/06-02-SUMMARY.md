---
phase: 06-standalone-persistence-output
plan: 02
subsystem: reporter
tags: [output, render, byte-identical, onHeal, runner-agnostic, refactor]
requires:
  - "Phase 5 wrapPage onHeal + locator-proxy emit seam (both arms wired)"
  - "06-01 standalone persistence (loadBaseline/saveBaseline/mergeBaselines exported; loadCommittedBaseline rename)"
  - "src/reporter/reporter.ts box renderer (instance methods over this.heals / this.refused)"
  - "src/integration/events.ts SelfmendEvent union (HealedEvent | RefusedEvent)"
provides:
  - "Pure shared renderHealSummary(events: SelfmendEvent[]): string (OUT-02), the SINGLE renderer the reporter also calls"
  - "Public renderHealSummary export from src/index.ts (standalone boxed summary from collected events)"
  - "Confirming raw-mode onHeal coverage (OUT-01): healed + the three post-scoring refusals delivered; no-fingerprint silence asserted"
affects:
  - "src/reporter/reporter.ts render() now delegates; box-render private methods removed; stripAnsi re-exported from render.js"
  - "src/index.ts public export surface (renderHealSummary)"
tech-stack:
  added: []
  patterns:
    - "Extract-once-call-twice: one pure render module both the reporter and the public export call, so output is byte-identical by construction, never a copy that drifts (WRAP-04-style)"
    - "Confirming test over the emit seam: drive the real proxy + pure score()/decide() with stubbed page.evaluate to deterministically hit each refusal reason"
key-files:
  created:
    - src/reporter/render.ts
    - src/reporter/render.test.ts
    - src/integration/onheal-confirm.test.ts
  modified:
    - src/reporter/reporter.ts
    - src/index.ts
decisions:
  - "MOVED (not copied) the box logic into src/reporter/render.ts; reporter.render() is the one-line renderHealSummary([...this.heals, ...this.refused]), preserving the historic healed-first then refused ordering"
  - "Re-exported stripAnsi from ./render.js in reporter.ts so reporter.test.ts's import { stripAnsi } from ./reporter.js keeps resolving unchanged"
  - "Byte-identical snapshot uses toBe (full string equality) feeding the SAME events to a real SelfmendReporter and to renderHealSummary; both paths share the same picocolors module so color is identical with no forcing needed"
  - "OUT-01 confirmed with NO production change: the proxy already emits both arms (Phase 5); the test drives the emit seam directly and stubs page.evaluate to reach each post-scoring reason via the real score()/decide()"
metrics:
  tasks: 3
  files: 5
  commits: 3
  completed: 2026-06-02
---

# Phase 6 Plan 02: Standalone Output Slice Summary

The reporter's boxed heal-summary renderer is now a single shared pure `renderHealSummary(events)` that the reporter delegates to (proven byte-identical via a full-string-equality snapshot), publicly exported, with a confirming raw-mode test that `onHeal` already receives every post-scoring heal event and that the no-fingerprint case stays intentionally silent.

## What Was Built

- **OUT-02 (the hard one)**: `src/reporter/render.ts` exports a pure `renderHealSummary(events: SelfmendEvent[]): string`. The box logic (healed box, could-not-heal section, per-row builders, `boxLine`, and the `formatScore` / `visibleLength` / `stripAnsi` helpers, plus the box-drawing chars and `picocolors` calls) was MOVED out of `reporter.ts`, not copied. The reporter's `render()` is now the one line `renderHealSummary([...this.heals, ...this.refused])`, preserving the historic healed-first then refused ordering. The renderer partitions events by `kind` with a missing `kind` decoding as healed (events.ts:34). `stripAnsi` is re-exported from `reporter.ts` (`export { stripAnsi } from "./render.js"`) so `reporter.test.ts`'s import keeps resolving.
- **OUT-01 (confirming only)**: `src/integration/onheal-confirm.test.ts` drives the real `wrapLocator` emit seam directly (the same recording callback `wrapPage` builds from `onHeal`) and asserts a HEALED event plus each of the three post-scoring refusal reasons (`no-candidates`, `below-floor`, `ambiguous`) reaches `onHeal`, and that an uncaptured locator (no stored fingerprint) is re-thrown before scoring and delivers NOTHING, the intentional noise-suppression that makes raw mode identical to fixture mode (events.ts:50-56). No production change was needed: both emit arms were already wired in Phase 5.
- **Public export**: `renderHealSummary` is exported from `src/index.ts`, documented as the output counterpart to `onHeal`.

## How It Works

Byte-identity is guaranteed by construction, not by comparison: the reporter and the public export call the SAME function, so they cannot drift. The snapshot test (`render.test.ts`) still proves it with `toBe` (full string equality, not `toContain`) by feeding the SAME `SelfmendEvent[]` to a real `SelfmendReporter` (through its `onTestEnd` attachment parse path) and to `renderHealSummary`, across mixed, healed-only, refused-only, N=0, singular-header, null-bestScore-dash, and missing-kind cases. Both paths share the one `picocolors` module, so color is identical with no force/no-color flag needed (A4). The confirming test reaches each refusal reason deterministically by stubbing `page.evaluate` (which `findCandidates` delegates to) with controlled candidate descriptors and letting the REAL `score()` + `decide()` classify them: empty -> no-candidates, a maximally-dissimilar candidate -> below-floor, two identical perfect matches (gap 0 inside the 0.05 margin) -> ambiguous, one perfect match -> healed.

## Verification

- `npx tsc --noEmit`: exit 0.
- `npx vitest run`: 163 passed (the prior 151 plus 7 byte-identical render tests and 5 onHeal confirming tests).
- `npx playwright test`: 29 passed, including `tests/report.spec.ts` (reporter output byte-unchanged) and the standalone specs; the live run printed the healed box and the could-NOT-heal box exactly as before the extraction.
- `grep -c "renderHealedBox" src/reporter/reporter.ts`: 0 (the box-render private methods were extracted, not copied).
- `grep -n "renderHealSummary" src/reporter/reporter.ts`: the delegation call is present (line 180); `grep -n "renderHealSummary" src/index.ts`: the public export is present.
- `src/matching/` untouched (0 files changed); no new runtime dependency; `renderHealSummary` is pure and offline (only `picocolors`, no `fs`, no Playwright import).
- TDD gates: `test(06-02)` RED commit (12276c8) then `feat(06-02)` GREEN commit (5435e99).

## Deviations from Plan

None functional. Task 3 (the full regression gate) required no code change: the existing `reporter.test.ts` already exercises the delegated `render()` path (the WR-02 color-alignment test, the two-section test, and the N=0 guard all call `reporter.render()` after `onTestEnd`), with no assertion weakened, so the optional thin assertion the plan allowed for was unnecessary. The gate (163 unit + 29 e2e green, reporter output byte-unchanged) is the WRAP-04-style proof of zero behaviour change, and it passed with the extraction alone.

## TDD Gate Compliance

- RED: `test(06-02): add failing byte-identical renderHealSummary snapshot` (12276c8), confirmed failing on `Cannot find module './render.js'`.
- GREEN: `feat(06-02): extract shared pure renderHealSummary; reporter delegates (zero output change)` (5435e99).

## Self-Check: PASSED

- FOUND: src/reporter/render.ts (renderHealSummary, stripAnsi)
- FOUND: src/reporter/render.test.ts (toBe byte-identical snapshot)
- FOUND: src/integration/onheal-confirm.test.ts (onHeal healed + three refusals + no-fingerprint silence)
- FOUND: src/reporter/reporter.ts render() delegates; renderHealedBox count 0
- FOUND: src/index.ts renderHealSummary export
- FOUND commit 12276c8 (RED), 5435e99 (GREEN Task 1), 368b636 (Task 2)
