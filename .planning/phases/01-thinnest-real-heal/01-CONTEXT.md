# Phase 1: Thinnest Real Heal - Context

**Gathered:** 2026-05-31
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver the thinnest possible REAL end-to-end heal on a simple, single-worker case: a developer installs the plugin into an existing Playwright project, runs a passing test (the plugin fingerprints each resolved locator), then a locator breaks on a later run and the plugin matches it against the stored fingerprint, rebinds it live so the test stays green, and prints a boxed console summary of the heal. This phase also de-risks the live locator-rebind hook (the project's riskiest unknown).

In scope: INST-01, INST-02, CAP-01, MATCH-01, HEAL-01, HEAL-02, REP-01, CFG-01.
Not in scope (later phases): the hardened confidence-floor + second-best margin gate + no-force-green proofs (Phase 2), cross-run persistence and parallel-worker safety (Phase 3), offline verification and npm publish (Phase 4).

</domain>

<decisions>
## Implementation Decisions

### Package & Naming
- **D-01:** The package is named `selfmend`, verified available on npm as of 2026-05-31. This supersedes the "Playwright SelfHeal" working name in PROJECT.md. The earlier preference `playwright-selfheal` was rejected because it is already taken on npm (v1.0.9 exists, treat as prior art / competitor to examine).
- **D-02:** Public import path is `selfmend`. Primary usage: `import { test } from 'selfmend'`.

### How developers enable it
- **D-03:** Enablement is via import-swap: the developer changes their import from `@playwright/test` to `selfmend`, which re-exports a `test` extended with the healing fixture. Healing then applies to every test using that `test` object. This is the idiomatic Playwright fixture-sharing pattern and matches the research's recommended `test.extend` + wrapped-locator-factory approach.
- **D-04:** Also provide a composable fixture export so teams that already maintain their own `test.extend` can merge selfmend's healing fixture into their existing fixtures rather than being forced onto the bare re-exported `test`. (Implementation detail for planning, not a separate capability.)
- **D-05:** The Reporter is summary-only (end-of-run output); it does NOT perform healing. Live healing happens in the worker via the fixture. Monkey-patching Playwright internals is rejected.

### Console report
- **D-06:** v1 output is a boxed summary block printed at end of run: a header like `selfmend: N locators healed`, followed by indented rows showing test name, original selector, healed target, and confidence score. Scannable and clearly attributable to the plugin so it reads as a visible audit trail.
- **D-07:** (Phase 2 will extend this to distinguish healed vs failed-to-heal and show the runner-up margin; Phase 1 ships the healed-rows view.)

### Default behavior & threshold posture
- **D-08:** Healing is ON by default once the developer import-swaps; it can be disabled via config (CFG-01). Lowest-friction "it just works", relying on the trust gates (Phase 2) to stay safe.
- **D-09:** Ship a conservative / high-confidence posture (default threshold around 0.9). Heal only when very confident; prefer leaving a locator unhealed over healing to the wrong element. The exact number is for research/planning to calibrate from the literature (Similo, Healenium) and benchmarks, but the posture is "lean safe."
- **D-10:** Healing must trigger only after Playwright's normal auto-wait/timeout, never on a transient poll miss (HEAL-02), to avoid introducing flakiness.

### Claude's Discretion
- Internal architecture of the pure scorer, fingerprint serialization format, candidate enumeration mechanism, baseline store shape for the single-worker case, and config schema details are left to research and planning. Keep the scoring + heal-decision logic pure (Playwright-free) and built test-first per the project's TDD default.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project-level
- `.planning/PROJECT.md` : product definition, core value, constraints, key decisions (note: package name now `selfmend`, see D-01).
- `.planning/REQUIREMENTS.md` : v1 requirements; Phase 1 owns INST-01/02, CAP-01, MATCH-01, HEAL-01/02, REP-01, CFG-01.
- `.planning/ROADMAP.md` : Phase 1 goal and success criteria.

### Research (all in `.planning/research/`)
- `.planning/research/SUMMARY.md` : reconciled integration approach, recommended build order, riskiest-unknown flag.
- `.planning/research/STACK.md` : the `test.extend` fixture + wrapped locator-factory integration seam, Playwright APIs for capture (evaluate/ariaSnapshot), build tooling (tsdown, Vitest), peer-dependency setup.
- `.planning/research/ARCHITECTURE.md` : component boundaries, capture vs heal data flow, worker-to-main via `testInfo.attach`, build order (config -> pure core -> store -> capture/candidate-finder -> rebind -> integration -> reporter -> entry).
- `.planning/research/PITFALLS.md` : false-green trap, heal-after-timeout rule, unstable fingerprint signals to avoid, interception risks.
- `.planning/research/FEATURES.md` : table stakes vs differentiators; Similo/Healenium precedents for scoring and confidence.

### Prior art to examine during research
- npm package `playwright-selfheal` (v1.0.9) : existing tool under our originally-desired name. Research should review its approach, scope, and gaps to sharpen differentiation.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- None yet. Greenfield project; the only files are `.planning/` docs and a generated `CLAUDE.md`. No source code exists.

### Established Patterns
- None established in-repo. The research documents are the authoritative pattern source for this first phase.

### Integration Points
- The plugin integrates with consumer projects through `@playwright/test` (declared as a peer dependency), specifically by extending `test` and wrapping the locator factory. No internal integration points exist yet.

</code_context>

<specifics>
## Specific Ideas

- Boxed console block styled like `selfmend: N locators healed` with indented per-heal rows (test, old selector, healed target, confidence).
- Import ergonomics should feel like a one-line swap: `import { test } from 'selfmend'` replacing `@playwright/test`.

</specifics>

<deferred>
## Deferred Ideas

- Distinguishing healed vs failed-to-heal in the report and showing the second-best margin: Phase 2 (REP-02, MATCH-03).
- Cross-run persistence and parallel-worker-safe baseline store: Phase 3 (CAP-02, CAP-03). Phase 1 may use the simplest in-process/single-worker baseline that proves the loop.
- Configurable floor and margin: Phase 2 (CFG-02). Phase 1 ships the conservative default only.
- LLM tiebreaker, assertion-drift diagnosis, smart waits, PR/diff delivery: v2 (out of scope per REQUIREMENTS.md).

</deferred>

---

*Phase: 1-Thinnest Real Heal*
*Context gathered: 2026-05-31*
