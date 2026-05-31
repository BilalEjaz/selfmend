---
phase: 02-trust-hardening
reviewed: 2026-05-31T00:00:00Z
depth: deep
files_reviewed: 6
files_reviewed_list:
  - src/matching/decision.ts
  - src/matching/types.ts
  - src/config/schema.ts
  - src/integration/events.ts
  - src/integration/locator-proxy.ts
  - src/reporter/reporter.ts
findings:
  blocker: 0
  high: 0
  medium: 1
  low: 2
  total: 3
status: clean
resolution:
  MD-01: fixed (explicit \x1b escape + comment removed + reporter test)
  LO-02: fixed (distinguishing token for non-serializable chain args + test)
  LO-01: deferred (cosmetic doc-comment placement; intentionally not fixed)
---

# Phase 2 (Trust Hardening): Code Review Report

**Reviewed:** 2026-05-31
**Depth:** deep (cross-file: locator-proxy -> decision/events -> reporter; purity audit; boundary-math execution)
**Files Reviewed:** 6
**Status:** issues_found (no BLOCKER/HIGH; trust core is sound)

## Summary

The Phase 2 trust-hardening changes are correct on every high-priority axis. I attacked
the false-green surface, the margin boundary math, the tagged-union back-compat, and the
reporter, and confirmed (by reading + executing) that the trust guarantees hold:

- **False-green integrity: clean.** Floor gate is checked before the margin gate (so two
  below-floor look-alikes report `below-floor`, not `ambiguous`), and no path heals below
  floor or inside the margin. The refused-event flow attaches inside a `try/catch` and then
  re-throws the ORIGINAL error UNCONDITIONALLY outside the guard (locator-proxy.ts:329-346):
  a throwing `attachRefusedEvent` is swallowed by the inner catch and can never replace or
  suppress `err`, so the test still fails. The replay-failure path (lines 357-368) also
  re-throws the original error and does NOT attach a heal event, so a found-but-broken
  replay cannot over-report a heal or false-green.
- **Margin boundary math: correct.** I executed the comparison. The gate is
  `gap < margin - GAP_EPSILON` => refuse, `gap >= margin - GAP_EPSILON` => heal. Direction
  is right (a near-ambiguous pair below the margin refuses), the documented exact-gap case
  heals through IEEE drift (`0.95 - 0.90 = 0.04999...` heals at margin 0.05), and the only
  "hole" is a pair within 1e-9 of the margin healing instead of refusing — negligible and
  intentional given `[0,1]` score granularity.
- **Tagged-union back-compat: correct.** `parseEvent` routes `kind:"refused"` to the
  refused validator; missing OR unknown `kind` routes to the healed validator (back-compat).
  A refused-shaped body cannot be misclassified as healed: a refused payload always carries
  `kind:"refused"` (the attach stamps it), and a malformed/unknown-kind body that lacks
  `healedTarget`/`score` fails healed validation and returns `null` (skipped, never thrown).
  `parseRefused` rejects unknown reasons via the `REFUSED_REASONS` set and accepts only a
  finite-number or explicit-null `bestScore`. No over-reporting of heals.
- **decide() contract: correct + pure.** `bestScore` is `null` only on `no-candidates`
  and the winner's score otherwise; the `NoHealReason` union is exhaustive; the `winner ===
  undefined` branch keeps it total. Purity verified: `decision.ts`, `types.ts`, and
  `scoring.ts` import nothing from Playwright / `node:*` / network (only `candidate-finder.ts`,
  out of scope, imports `Page`, which it legitimately needs).
- **Reporter: summary-only, correct separation, no crash at zero.** No `page`/DOM handle;
  healed vs refused arrays are partitioned correctly in `onTestEnd`; `renderRefusedSection`
  returns `null` at zero refusals (no empty box); `null` `bestScore` renders as `—`, never
  the literal "null". All 52 unit tests pass.

Findings below are robustness/quality only; none threaten the trust posture.

## Medium

### MD-01: `stripAnsi` regex omits the ESC byte — alignment relies on an unstated invariant

**File:** `src/reporter/reporter.ts:288` (`const ANSI = /\[[0-9;]*m/g;`)
**Issue:** The width/padding stripper matches `[NN;NNm` but NOT the leading `\x1b` (ESC)
byte, even though the adjacent comment claims "ANSI defined above with an explicit ESC byte"
(line 294) — the comment is false. The box stays aligned today ONLY because `stripAnsi` is
applied identically to both the width computation (`visibleLength`) and the per-line `plain`
argument of `boxLine`, so the over-strip cancels. I verified empirically (real reporter,
color forced on, multi-row): every framed line renders to a uniform true-visible width, and
the WR-02 regression test passes. So this is NOT a live misalignment.

The defect is latent and two-fold:
1. The regex leaves the 1-byte ESC in the string (`"\x1b[31mx\x1b[39m"` -> `"\x1bx\x1b"`),
   so `visibleLength` over-counts by the ESC count. Alignment survives only because the
   over-count is symmetric; any future change that strips one side with a correct regex and
   the other with this one (or measures true width on output) would drift the right border.
2. False positives: it also eats plain selector substrings shaped like `[<digits>m`
   (e.g. an attribute selector `[1m]`). Harmless today for the same symmetry reason, but it
   means a printed selector could be silently miscounted.

The WR-02 test (`reporter.test.ts:56`) uses the CORRECT stripper (`/\x1b\[[0-9;]*m/g`) for
its assertions, so it cannot catch a regression in the reporter's own buggy regex — the two
will only ever disagree once symmetry breaks.
**Fix:** Include the ESC byte so the reporter's stripper matches the test's reference and
the symmetry assumption is removed:
```ts
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g;
```
Then delete the now-correct-but-misleading comment on line 294.

## Low

### LO-01: Stale/misplaced doc comment block in locator-proxy

**File:** `src/integration/locator-proxy.ts:237-244`
**Issue:** Two JSDoc blocks sit back-to-back: a one-line summary for `actionOrHeal`
(237-240) immediately followed by the `captureOnSuccess` doc (241-244). The first block
documents `actionOrHeal` but is detached from it (the `captureOnSuccess` block and function
intervene), so tooling attaches the `actionOrHeal` summary to `captureOnSuccess`. Cosmetic,
but it misleads readers/IDE hovers in the most trust-critical file.
**Fix:** Move the `actionOrHeal` summary (lines 237-240) down to directly precede the
`async function actionOrHeal` declaration on line 280, or merge it into that function's doc.

### LO-02: `describeArgs` swallows all serialization errors into an empty string

**File:** `src/integration/locator-proxy.ts:227-235`
**Issue:** `describeArgs` builds the chained-locator store key from
`JSON.stringify(a) ?? ""`. For a circular/non-serializable chain arg, `JSON.stringify`
throws, the `catch` returns `""`, and the chained selector collapses to
`"<sel> >> filter()"`. Two genuinely different chained refinements with non-serializable
args would then collapse to the SAME store key, the same risk class as the Phase-1 CR-01
step-collision fix. Phase 1/2 chain args are realistically plain (strings, `{ hasText }`),
so this is latent, not live — but it is a key-collision footgun in the disambiguation logic
the per-test step counter was added to protect.
**Fix:** On serialization failure, fold a disambiguator into the key (e.g. the arg's
positional `String(typeof a)` plus the `nextStep()` already available in `ctx`) instead of
collapsing to `""`, or document that non-serializable chain args are unsupported.

---

_Reviewed: 2026-05-31_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
