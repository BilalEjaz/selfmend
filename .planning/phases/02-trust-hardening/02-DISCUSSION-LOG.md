# Phase 2: Trust Hardening - Discussion Log

> **Audit trail only.** Decisions are captured in CONTEXT.md; this log preserves the alternatives considered.

**Date:** 2026-05-31
**Phase:** 2-Trust Hardening
**Areas discussed:** Margin gate semantics, Could-not-heal reporting, Config granularity, User-tunable signal weights

---

## Margin gate semantics

| Option | Description | Selected |
|--------|-------------|----------|
| Absolute gap | top - runnerUp >= margin, same 0..1 units | ✓ |
| Relative ratio | runnerUp/top <= X | |
| Both (gap AND ratio) | most conservative, two knobs | |

**User's choice:** Absolute gap.
**Notes:** Interpretable, easy to document/tune. Solo candidate trivially passes the gate. Default margin value left to research/planning calibration.

---

## Could-not-heal reporting

| Option | Description | Selected |
|--------|-------------|----------|
| Separate 'could not heal' section | end-of-run section: locator, reason, best score | ✓ |
| Inline reason on the failure only | enrich thrown error, no report section | |
| Both | error + report section | |

**User's choice:** Separate could-not-heal section.
**Notes:** Refused attempts flow through the same testInfo.attach transport; test still fails normally (additive observability, not a substitute).

---

## Config granularity

| Option | Description | Selected |
|--------|-------------|----------|
| Global only | floor + margin set once in plugin config | ✓ |
| Global + per-test override | per-test/per-call overrides | |

**User's choice:** Global only.
**Notes:** Keep existing `threshold` key as the floor; add a new global `margin` key. Per-test overrides deferred unless demand appears.

---

## User-tunable signal weights

| Option | Description | Selected |
|--------|-------------|----------|
| Fixed, calibrated by us | internal documented constant | ✓ |
| Exposed in config (advanced) | user-overridable weights | |
| Fixed now, design for later | ship fixed, allow exposing later | (partially — structure for later) |

**User's choice:** Fixed, calibrated by us.
**Notes:** Trustworthy default users cannot footgun; smaller API surface. Keep scorer structured so weights could be exposed later without a rewrite.

---

## Claude's Discretion

- Default `margin` value, floor recalibration, which additional signals to add and their weights, internal refused-heal event representation, exact reporter formatting of the could-not-heal section. Keep matching core pure; build gate/weights test-first.

## Deferred Ideas

- Per-test override of floor/margin (Phase 2 keeps global).
- Exposing signal weights in config (deferred).
- Cross-run persistence + parallel-worker safety (Phase 3).
- Offline proof + npm publish (Phase 4).
