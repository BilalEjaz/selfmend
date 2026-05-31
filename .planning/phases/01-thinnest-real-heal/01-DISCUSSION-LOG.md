# Phase 1: Thinnest Real Heal - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md, this log preserves the alternatives considered.

**Date:** 2026-05-31
**Phase:** 1-Thinnest Real Heal
**Areas discussed:** Package & import name, How devs enable it, Console report format, Default-on vs opt-in + threshold

---

## Package & import name

| Option | Description | Selected |
|--------|-------------|----------|
| playwright-selfheal | Descriptive, matches working name | (rejected: taken on npm, v1.0.9) |
| mendwright | Brandable mend + Playwright portmanteau | |
| Scoped name | e.g. @scope/playwright-selfheal | |
| selfheal-playwright | Available, distinctive word first | (chosen then reconsidered) |
| staygreen | Evokes keeping the suite green | |
| antidrift | Names the selector-drift problem | |
| **selfmend** | Clear self + mend, brandable, npm-available | ✓ |

**User's choice:** `selfmend` (after rejecting the taken `playwright-selfheal` and asking for a name that is both good and available).
**Notes:** npm availability checked live. `playwright-selfheal` is taken (v1.0.9, prior art). `selfmend` verified available. Name supersedes the "Playwright SelfHeal" working name.

---

## How devs enable it

| Option | Description | Selected |
|--------|-------------|----------|
| Import-swap test | Change import to selfmend; healing automatic | ✓ |
| Config plugin only | Add config entry, no test changes (harder, no PW plugin hook) | |
| Explicit fixture import | Compose a healing fixture into own test.extend | |

**User's choice:** Import-swap `test`.
**Notes:** Matches research's `test.extend` + wrapped-locator-factory approach. Agreed to also expose a composable fixture for teams with existing custom fixtures (implementation detail, not a separate path).

---

## Console report format

| Option | Description | Selected |
|--------|-------------|----------|
| Boxed summary block | End-of-run grouped block, header + indented rows | ✓ |
| Terse one-liner per heal | Single coloured line per heal, no rollup | |
| Both: inline + rollup | Terse line at heal time plus boxed rollup | |

**User's choice:** Boxed summary block.
**Notes:** Header `selfmend: N locators healed` then rows of test name, old selector to healed target, confidence. Phase 2 extends it with healed-vs-failed and margin.

---

## Default-on vs opt-in + threshold

| Option | Description | Selected |
|--------|-------------|----------|
| On by default | Healing active on import-swap, disable via config | ✓ |
| Off by default (opt-in) | Enable explicitly in config | |

**User's choice:** On by default.

| Option | Description | Selected |
|--------|-------------|----------|
| Conservative / high bar (~0.9) | Heal only when very confident | ✓ |
| Balanced (~0.7-0.8) | Heal more cases, margin gate backstops | |
| Let research calibrate | No fixed number, posture lean-safe | |

**User's choice:** Conservative / high bar.
**Notes:** Exact threshold to be calibrated by research/planning from Similo/Healenium and benchmarks; posture is "lean safe, never false-green."

---

## Claude's Discretion

- Pure scorer internals, fingerprint serialization, candidate enumeration, single-worker baseline shape, config schema details. Keep scoring/heal-decision pure and test-first (TDD).

## Deferred Ideas

- Healed-vs-failed distinction and margin display: Phase 2.
- Cross-run + parallel-worker-safe baseline store: Phase 3.
- Configurable floor and margin: Phase 2.
- LLM tiebreaker, assertion-drift, smart waits, PR/diff delivery: v2 (out of scope).
