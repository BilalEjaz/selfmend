# Phase 2: Trust Hardening - Context

**Gathered:** 2026-05-31
**Status:** Ready for planning

<domain>
## Phase Boundary

Make the matcher trustworthy. Phase 1 shipped a single floor gate; Phase 2 hardens the heal decision so it never heals to the wrong element among look-alikes, scores on multiple weighted signals, proves the no-force-green guarantees test-first, and reports refused heals as a visible audit trail.

In scope: MATCH-02 (absolute confidence floor, hardened/proven), MATCH-03 (second-best margin gate), MATCH-04 (no-force-green: no-candidate / below-floor / ambiguous all fail normally), REP-02 (distinguish healed vs could-not-heal in the report), CFG-02 (configurable floor and margin).

Not in scope (later phases): cross-run persistence and parallel-worker-safe baseline store (Phase 3); network-blocked offline proof and npm publish (Phase 4); assertion-drift, smart waits, LLM tiebreaker, PR/diff delivery (v2, out of scope per REQUIREMENTS.md).

Builds directly on existing Phase 1 code: `src/matching/decision.ts` (floor gate, already retains `runnerUpScore`), `src/matching/scoring.ts` (weighted scorer), `src/config/schema.ts` (zod config), `src/reporter/reporter.ts` (boxed summary), `src/integration/events.ts` (HealEvent).
</domain>

<decisions>
## Implementation Decisions

### Margin gate (MATCH-03)
- **D-01:** The margin gate uses an ABSOLUTE GAP: heal only if `topScore - runnerUpScore >= margin`, where `margin` is in the same 0..1 units as the score. Chosen for interpretability and easy documentation/tuning over a relative ratio or a combined gap+ratio rule.
- **D-02:** A solo candidate (no runner-up) trivially passes the margin gate and heals if it clears the floor. The margin gate only constrains the multi-candidate / look-alike case.
- **D-03:** Both gates must pass to heal: `topScore >= floor` AND `topScore - runnerUpScore >= margin`. Failing either is a no-heal with a distinct reason (`below-floor` vs `ambiguous`). The exact default margin VALUE is left to research/planning to calibrate (lean-safe posture); the discussion locks only the mechanism.

### Could-not-heal reporting (REP-02)
- **D-04:** After the existing healed box, the reporter prints a SEPARATE "could not heal" section listing each refused attempt: the locator, the reason (`no-candidates` / `below-floor` / `ambiguous`), and the best candidate score seen. Maximal transparency: the team sees that selfmend tried and why it declined, while the test still fails normally.
- **D-05:** Refused-heal events must travel worker -> reporter the same way successful heals do (testInfo.attach, the existing transport), so the reporter can render both sections. This implies the heal-event/attachment contract widens to carry refused attempts with their reason + best score (extend, do not break, the Phase 1 HealEvent shape).
- **D-06:** A refused heal still lets the test fail normally (MATCH-04) — the report section is additive observability, never a substitute for the failure. No false greens.

### Config granularity (CFG-02)
- **D-07:** The floor and the margin are GLOBAL config only (set once in the plugin config object, validated by the zod schema alongside the existing `threshold`/`enabled`/`testIdAttr`). No per-test/per-call override in this phase. Per-test overrides can be added later only if real demand appears.
- **D-08:** Naming: keep the existing `threshold` key as the floor (do not rename and break Phase 1 config); add a new `margin` key. Both validated in `[0, 1]` with readable zod errors, consistent with the Phase 1 input-validation trust boundary.

### Signal weights
- **D-09:** Scoring signal weights (test-id, text, role, neighbour, DOM position, etc.) are FIXED internal constants, calibrated by us against the literature (Similo/Healenium) and benchmarks, and documented. They are NOT exposed in user config. Rationale: a trustworthy default users cannot footgun, and a smaller API/support surface. Keep the scorer structured so weights could be exposed later without a rewrite, but do not build the config surface now.

### Claude's Discretion
- The exact default values for `margin` and any floor recalibration, the specific additional signals to add for "multi-signal" scoring and their relative weights, the internal representation of refused-heal events, and the precise reporter formatting of the could-not-heal section are left to research and planning. Keep `scoring.ts` and `decision.ts` pure (Playwright/fs-free) and build the new gate/weights test-first (TDD).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project-level
- `.planning/PROJECT.md` : core value, never-false-green constraint, validated Phase 1 capabilities.
- `.planning/REQUIREMENTS.md` : Phase 2 owns MATCH-02, MATCH-03, MATCH-04, REP-02, CFG-02.
- `.planning/ROADMAP.md` : Phase 2 goal and success criteria.

### Phase 1 code this phase extends (read before changing)
- `src/matching/decision.ts` : current floor gate; already returns `runnerUpScore` in the heal event for the margin gate to consume. The margin gate layers here.
- `src/matching/scoring.ts` : current weighted scorer (testId/text/role). Multi-signal hardening extends this; keep it pure.
- `src/matching/types.ts` : Decision / ScoredCandidate / HealEvent types. The refused-heal reporting widens the event contract here.
- `src/config/schema.ts` : zod config (`enabled`, `threshold`, `testIdAttr`, `DEFAULT_THRESHOLD`). Add `margin` here (D-08).
- `src/reporter/reporter.ts` : boxed summary; add the could-not-heal section (D-04).
- `src/integration/events.ts` and `src/integration/locator-proxy.ts` : heal-event transport (testInfo.attach); refused attempts must flow through the same path (D-05).
- `.planning/phases/01-thinnest-real-heal/01-SUMMARY.md` ... `05-SUMMARY.md` : what Phase 1 built and the exact contracts.

### Research
- `.planning/research/SUMMARY.md`, `.planning/research/PITFALLS.md` : the false-green trap and the second-best margin gate are called out as the specific guard against duplicate/ambiguous elements; Similo/Healenium precedents for signal weighting and confidence calibration.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `decide(scored, floor)` in `src/matching/decision.ts`: sorts candidates, applies the floor, already retains the runner-up score. Extend its signature/logic for the margin gate (likely `decide(scored, { floor, margin })`).
- `score(fingerprint, candidate)` in `src/matching/scoring.ts`: deterministic weighted sum, pure. Extend with additional signals; keep the `[0,1]` clamp and divide-by-zero guard.
- `configSchema` in `src/config/schema.ts`: zod object with defaults; add `margin` following the existing `thresholdSchema` pattern.
- `SelfmendReporter` in `src/reporter/reporter.ts`: reads heal attachments in `onTestEnd`, renders the boxed block in `onEnd`. Add a second (could-not-heal) section.
- HealEvent transport via `testInfo.attach('selfmend-heal', ...)` (events.ts / locator-proxy.ts): reuse for refused attempts.

### Established Patterns
- Pure matching core (no Playwright/fs imports) verified by `tsc --noEmit` and grep; Phase 2 must preserve this.
- TDD RED -> GREEN -> REFACTOR for logic (config, scorer, decision were all test-first in Phase 1); the margin gate and new signals follow the same discipline.
- Reporter is summary-only and must never heal (D-05 from Phase 1).

### Integration Points
- decision.ts -> locator-proxy.ts (the proxy calls decide() and acts on the result); widening decide()'s input/output ripples to the proxy call site.
- events/attachment contract -> reporter.ts (both sections read from the same attachment stream).

</code_context>

<specifics>
## Specific Ideas

- Margin gate as `topScore - runnerUpScore >= margin` (absolute, 0..1 units).
- Report layout: existing healed box first, then a clearly-labelled "could not heal" section with locator, reason, best score.
- Config gains a single new global `margin` key beside `threshold`.

</specifics>

<deferred>
## Deferred Ideas

- Per-test / per-call override of floor and margin: only if real demand appears (kept global for now, D-07).
- Exposing signal weights in config: deferred; scorer structured to allow it later without a rewrite (D-09).
- Cross-run persistence + parallel-worker-safe store: Phase 3.
- Network-blocked offline proof + npm publish: Phase 4.

</deferred>

---

*Phase: 2-Trust Hardening*
*Context gathered: 2026-05-31*
