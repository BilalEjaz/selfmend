# Project Research Summary

**Project:** Playwright SelfHeal (working name)
**Domain:** Open-source TypeScript Playwright plugin, offline, locator-only self-healing (npm, MIT)
**Researched:** 2026-05-31
**Confidence:** HIGH

## Executive Summary

This is a Playwright-native, fully-offline self-healing locator plugin distributed on npm under MIT. The way credible tools in this space work is well established and consistent across the field: on a passing run, capture a multi-signal fingerprint of the element each locator resolves to; on a later resolution failure, enumerate candidate elements in the live DOM, score each against the stored fingerprint with weighted per-signal similarity, and rebind to the best match only if it clears a confidence floor. The peer-reviewed Similo work (ACM TOSEM) proves a 14-signal weighted heuristic is competitive without any LLM or cloud, and Healenium proves the capture-on-success plus score-cap lifecycle works in production. Our differentiated lane is precisely "Similo scoring plus Healenium lifecycle, but Playwright-native and propose-not-silently-apply." The research is decisive and convergent enough to move straight to roadmapping.

The recommended build is a TypeScript plugin (strict mode, dual ESM/CJS via a conditional exports map, the Playwright test package as a peerDependency), built with tsdown, unit-tested with Vitest and integration-tested with Playwright's own runner. The integration seam, the single most load-bearing decision, is a test.extend fixture that OVERRIDES the built-in page fixture and returns a thin wrapper/Proxy around the locator factory (page.locator, getByRole, getByTestId, and so on). That wrapper is the only place that can both capture on success and intercept-then-rebind on failure, because it runs in-process inside the worker where the live DOM is reachable. A Reporter is added for the end-of-run console summary only; it runs post-hoc in the main process and cannot rebind anything. The pure scoring and decision logic is kept Playwright-free so it can be TDD'd against plain fixtures with no browser. The baseline persists as a human-inspectable JSON store with per-worker shards merged in globalTeardown to stay lock-free under parallel workers.

The dominant risk, the one that would make the product worse than no tool, is the FALSE-GREEN TRAP: the original element is genuinely gone (a real regression), the healer matches the next-most-similar element, scores it high in absolute terms, and ships a bug under a green suite. Mitigation is non-negotiable and must be enforced in code, not docs: an absolute confidence floor (default high, around 0.90, never auto-relaxed), a SEPARATE second-best margin gate (top must beat runner-up by a delta, or it is ambiguity, so fail), a sacred locator-only / never-touch-assertions boundary, and a no-candidate / below-floor path that fails the test normally and says so loudly. The riskiest unknown is mechanical, not conceptual: exactly how to transparently substitute the resolved element inside Playwright on the failure path without monkey-patching internals and without firing during legitimate auto-wait retries. That live locator-rebind hook needs a dedicated technical spike before the integration phase is committed.

## Key Findings

### Recommended Stack

A lean, offline-by-construction stack. The Playwright test package is a peerDependency (range >=1.42 <2, tested against the latest stable 1.60) so the plugin always uses the user's Playwright and never bundles its own. TypeScript 5.9 strict, Node 22 floor / 24 primary, dual ESM+CJS publish with the types condition listed first in exports. No HTTP client, no AI SDK, no telemetry library; the offline plus no-API-key promise forbids them and any accidental dependency that opens a socket breaks the core value. Fingerprinting uses Playwright's own locator.evaluate / page.evaluate to serialize signals inside the browser in one round-trip; no jsdom/cheerio. The similarity scorer is hand-rolled (Levenshtein / word-overlap / positional) because it is the core IP and must be deterministic and dependency-free.

**Core technologies:**
- **TypeScript 5.9 (strict, nodenext)** — plugin language; strict types are the selling point of a locator API
- **Playwright test package >=1.42 <2 (peerDependency)** — host framework and the only extension surface (test.extend, Locator, Reporter); never bundled
- **Node 22 (floor) + 24 (primary)** — runtime targets; engines.node >=22; enables node:sqlite later with no native build
- **tsdown (Rolldown)** — library bundler emitting ESM + CJS + d.ts; the 2026 successor to the now-unmaintained tsup
- **Vitest 3 + Playwright runner** — Vitest for pure logic (scoring, fingerprint serialization), Playwright runner for integration against a fixture app with mutated selectors
- **JSON file baseline store** — zero-dep, human-inspectable, gitignorable, fully offline; atomic write plus per-worker shards
- **zod (config/store validation), picocolors (console summary)** — minimal, zero-network supporting deps
- **publint + attw + Knip + Changesets + GitHub Actions** — publish-safety and release tooling

### Expected Features

The field's universal mechanic (capture-on-pass, score candidates on fail, accept above a floor) defines the table stakes; our offline plus OSS plus propose-not-apply posture defines the differentiators.

**Must have (table stakes):**
- Multi-signal fingerprint capture on passing resolution (text, role, test-id, attributes, neighbour text, DOM position) — no heal is possible without a baseline
- Weighted candidate scoring against the fingerprint (semantic signals weighted above positional) — the core engine and credibility bar
- Confidence floor — accept best candidate only if score >= threshold
- **Never force a green** — below floor, the test fails normally; the category's defining trust guarantee
- Live rebind on a clearing match so the run stays green — the headline value
- Console heal summary (original selector, healed target, confidence) — the v1 trust contract
- Fully offline: no network, no API key, no telemetry
- Drops into an existing Playwright project with minimal config; toggle plus threshold tunable

**Should have (competitive):**
- Fully offline / no-cloud / no-telemetry — the #1 enterprise adoption unblocker (every closed competitor ships DOM off-box)
- MIT open source plus Playwright-native — the only OSS self-healer is Selenium-only with dated tree-LCS matching
- Propose, do not silently apply — heal the run live but never edit test source or auto-commit the store; removes silent permanent drift
- Modern semantic-signal model (weighted text/role/test-id) over Healenium's brittle tree-LCS
- Transparent "why it healed" per-signal breakdown — helps a human judge a wrong-element heal (v1.x)

**Defer (v2+):**
- JSON/HTML report files plus committed original-to-healed store
- PR/diff delivery of permanent fixes (propose-only, reviewable)
- LLM-assisted ranking as an opt-in low-confidence tiebreaker
- Assertion-drift healing, smart-wait/flakiness healing (highest bug-hiding risk)
- Visual/CV matching, other frameworks (Cypress/Selenium), any hosted dashboard

### Architecture Approach

The plugin spans two Playwright contexts that cannot share memory: tests run in WORKER processes, reporters run in the MAIN process, and the only sanctioned worker-to-main channel is testInfo.attach() (custom IPC is an unavailable open feature request). This dictates the whole design: all DOM work happens in the worker via the wrapped page fixture; the reporter aggregates only what workers serialize out. The decisive seam is the fixture-overridden page returning healing-aware locators; the pure scoring/decision core imports nothing from Playwright and is TDD'd in isolation; the baseline is read-only during a run with per-worker append-only shards merged once in globalTeardown.

**Major components:**
1. **Integration layer (fixture + locator proxy)** — overrides page, wraps the locator factory, captures on success and triggers heal on failure; the only file coupled to the Playwright version
2. **Fingerprint capture** — batched page.evaluate extracting all signals in one round-trip on successful resolution
3. **Scoring engine + heal decision (PURE)** — (fingerprint, candidate) to score 0..1 and (scores, floor, margin) to heal or fail; no Playwright, most-testable units
4. **Candidate finder** — page.evaluate enumerating plausible DOM elements on failure
5. **Live rebinding** — winning candidate to a fresh Locator, action resumes
6. **Fingerprint store** — JSON baseline, per-worker shards, merged in globalTeardown
7. **Console reporter** — collects heal events from testInfo.attach in onTestEnd, renders the summary in onEnd

### Reconciled Integration Approach (resolving the cross-file tension)

The four research files proposed three candidate integration surfaces. They are not equivalent, and the recommendation is decisive:

| Candidate | Verdict | Why |
|-----------|---------|-----|
| **Fixture-overridden page + wrapped locator factory** (STACK, ARCHITECTURE) | **RECOMMENDED, primary seam** | The only surface that runs in-process in the worker with live DOM access, so it can both capture on success and intercept-then-rebind on failure. Transparent to user tests (they keep writing page.getByRole). |
| **selectors.register()** (PITFALLS, as the supported-API alternative to monkey-patching) | Secondary / evaluate during the spike | A documented extension point for a custom query engine, but it defines how a selector finds elements, not a clean post-timeout "resolution failed, rebind and replay the action" hook. May help with candidate enumeration, but it is not the live-rebind mechanism on its own. |
| **Reporter-only** | REJECTED for healing | Runs post-hoc in the main process after the test already failed; no page, no DOM, cannot rebind. Use it for the console summary only. |
| **Monkey-patching playwright-core internals** | REJECTED | Breaks across Playwright minors and fights the auto-wait engine; erodes the trust the product sells. |

**Resolution:** build on the fixture-overridden page plus wrapped locator factory as the live healing seam, with the Reporter strictly for the end-of-run summary. Treat selectors.register() as a supported-API tool to consider inside the rebind spike (for example for candidate querying), explicitly preferred over any prototype patch if the wrapper alone proves insufficient. All four files agree on the two hard exclusions (no Reporter-healing, no monkey-patching), so the only open question is the precise wrapper/rebind mechanics, which is the flagged spike below.

### Critical Pitfalls

1. **False-green trap (healing masks a real regression)** — the product-killing failure. Enforce an absolute confidence floor (default around 0.90, never auto-relaxed) AND a separate second-best margin gate (ambiguous top-2 fails, does not heal). Heal only the resolution, never the assertion. No candidate clears the floor means fail normally and say "could not heal" loudly. These are acceptance criteria for the scoring phase, not enhancements.
2. **Unstable fingerprint signals poison the baseline** — weight signals by intrinsic stability (test-id/role/accessible-name dominant; generated classes/hashed ids/dynamic text as weak tiebreakers at most), detect and down-rank high-entropy/framework-generated values, normalize text, and document that baselines are locale-specific.
3. **Monkey-patching internals / healing during auto-wait** — use supported surfaces only (fixture plus locator wrapper plus Reporter; selectors.register() if needed), heal only after the locator's real timeout has exhausted (never on a first poll miss), and run a Playwright-version CI matrix.
4. **Parallel workers corrupt the shared baseline** — read-only baseline during the run, per-worker append-only shards, single deterministic merge in globalTeardown. Architect this from the first store design even though v1 is console-only.
5. **Silent healing / no audit trail** — every heal is loud by default: original selector, re-derivable healed target description, confidence, AND runner-up score/margin. The console summary is the v1 trust contract, a phase-1 deliverable. Performance (batched single-evaluate capture, sampled once per locator-key per run, under a 5-10% overhead CI gate) and distribution (validated ESM+CJS install matrix plus tested peer-dep range, strict semver on the public surface) round out the must-prevent list.

## Implications for Roadmap

Based on combined research, the dependency chain and the false-green risk drive a clear order: build and harden the PURE scoring/decision core first (highest logic risk, zero dependencies, fully TDD-able), then the store, then the Playwright-coupled adapters, with reporting landing inside v1 because it is the trust contract, not polish. The one decision that gates everything else, the live rebind mechanism, gets a spike up front.

### Phase 1: Foundations + Live-Rebind Spike
**Rationale:** Packaging shape (dual ESM/CJS, peer-dep, exports) and the live-rebind mechanism are decisions that shape every later phase; the rebind hook is the riskiest unknown and must be de-risked before integration is committed.
**Delivers:** Repo scaffold (tsdown, Vitest, Playwright runner, strict TS), package.json with peerDependencies Playwright >=1.42 <2 and correct exports/types, config schema (zod) with defaults (enabled, floor around 0.90, margin delta, store path), AND a throwaway spike proving the fixture-overridden page plus wrapped locator factory can intercept a real post-timeout resolution failure and replay the action against a substituted element, without monkey-patching and without firing during auto-wait.
**Addresses:** Minimal-config install; toggle plus threshold config.
**Avoids:** Pitfall 3 (monkey-patching / auto-wait races), Pitfall 8 (distribution).
**FLAGGED, needs --research-phase:** the live locator-rebind hook is the single riskiest unknown. Validate against the lowest and highest supported Playwright minors and read the prior-art repos (qosha1/healing-playwright, amrsa1/healwright, paulocoliveira/playwright-auto-heal) during the spike.

### Phase 2: Scoring & Heal-Decision Core (PURE)
**Rationale:** Highest logic risk, zero external dependencies, fully unit-testable with hand-built fixtures, TDD this before anything touches a browser. This is where the false-green guarantee is actually enforced.
**Delivers:** Fingerprint type, weighted per-signal scorer (semantic over positional), normalized 0..1 score, and the heal decision with the floor gate plus second-best margin gate plus no-force-heal path.
**Addresses:** Weighted candidate scoring; confidence floor; never-force-green; transparent per-signal contribution data.
**Avoids:** Pitfall 1 (false-green trap). Acceptance tests: duplicate elements fail, removed element fails, below-floor fails, all without healing.
**Standard patterns, skip research:** pure TS heuristics with a clear blueprint (Similo).

### Phase 3: Baseline Store (parallel-safe)
**Rationale:** Independently testable against temp dirs; the parallel-write strategy must be chosen now so v2's persisted store needs no rewrite.
**Delivers:** Read/write API, stable locator keying (spec file plus test title plus call-site/selector), per-worker append-only shards, deterministic merge in globalTeardown, atomic writes, store-schema validation. Persist minimal derived signals, not raw DOM (security).
**Avoids:** Pitfall 4 (parallel corruption), security (no PII/secrets in baseline).

### Phase 4: Capture + Candidate Finder + Live Rebind (Playwright adapters)
**Rationale:** These wrap the pure core into the live loop and need a real browser, so they layer on top of phases 2-3 and use the rebind mechanism proven in phase 1.
**Delivers:** Batched single-evaluate fingerprint capture (sampled once per locator-key per run, stability-weighted, entropy down-ranked, text normalized), page.evaluate candidate enumeration, winning-candidate to fresh Locator rebind, wired through the fixture plus locator proxy. CI overhead benchmark (off vs on, under 5-10%).
**Addresses:** Fingerprint capture; live rebind to keep run green.
**Avoids:** Pitfall 2 (unstable signals), Pitfall 5 (capture overhead), Pitfall 3 (heal only after real timeout).
**FLAGGED, may need --research-phase:** depends on spike outcome; candidate-enumeration strategy (by role / neighbourhood / tag) and whether selectors.register() assists may warrant a focused look.

### Phase 5: Reporting (v1 trust contract)
**Rationale:** Reporting is the audit trail that makes the tool trustworthy; it is v1 scope, not v2 polish. Lands once heal events exist to report.
**Delivers:** Reporter collecting testInfo.attach heal events in onTestEnd, rendering an onEnd summary: per heal, original selector, re-derivable healed target, confidence, runner-up margin; loud "could not heal, N failures" line; heal-recurrence escalation ("healed N runs in a row, update it"). Log derived descriptions/scores only, never raw element content.
**Addresses:** Console heal summary; transparent "why it healed" (v1.x stretch).
**Avoids:** Pitfall 6 (silent healing), Pitfall 7 (drift), security (no secrets in logs).
**Standard patterns, skip research:** documented Reporter API.

### Phase 6: Packaging, Compatibility Matrix & First Publish
**Rationale:** Install/import correctness and version compatibility are gates before any user sees the package.
**Delivers:** npm pack plus publint plus attw in CI, fresh-project install matrix (real ESM project AND real CJS project), Playwright-version matrix (lowest plus highest declared minors), network-blocked CI run asserting zero outbound connections, Changesets release, MIT/README/docs.
**Addresses:** Offline guarantee verification; minimal-config install.
**Avoids:** Pitfall 8 (distribution), security (offline assertion).
**Standard patterns, skip research:** well-documented OSS publish path.

### Phase Ordering Rationale
- **Dependency-driven:** config, then pure scoring/decision, then store, then Playwright adapters, then reporter, then publish is the literal dependency chain from ARCHITECTURE's build order. The pure core has zero deps and the highest logic risk, so it is built and TDD'd first.
- **Risk-front-loaded:** the live-rebind unknown is spiked in phase 1 because it can invalidate the integration design; everything downstream assumes it resolves to the fixture-wrapper path.
- **Trust-as-scope:** the false-green guards (phase 2) and the audit trail (phase 5) are treated as acceptance criteria inside v1, not deferred; they are what differentiates the product from a liability.

### Research Flags
Phases likely needing /gsd:plan-phase --research-phase:
- **Phase 1:** the live locator-rebind hook, the riskiest unknown; how to intercept a genuine post-timeout resolution failure and replay against a substituted element via the public fixture/wrapper surface, validated across Playwright minors.
- **Phase 4 (conditional):** candidate-enumeration strategy and any selectors.register() assist, pending the phase-1 spike outcome.

Phases with standard patterns (skip research):
- **Phase 2:** pure TS heuristic scoring with a clear academic blueprint (Similo).
- **Phase 5:** documented Reporter API.
- **Phase 6:** standard 2026 OSS npm publish-safety path (publint/attw/matrix).

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Playwright APIs, dual-publish tooling, and Node LTS verified against official docs; only exact patch versions are MEDIUM (verify at implementation). |
| Features | HIGH | Competitor mechanics and the universal capture-score-floor pattern corroborated by a peer-reviewed source (Similo) plus multiple vendor docs; exact threshold numbers are vendor-specific (MEDIUM). |
| Architecture | HIGH | Worker/main split, testInfo.attach channel, fixture override, and parallel-store strategy verified against official Playwright docs; scoring approach corroborated by Healenium prior art. |
| Pitfalls | HIGH | False-green/matching analysis and the Playwright API surface verified against docs and Healenium's threshold model; distribution specifics MEDIUM. |

**Overall confidence:** HIGH

### Gaps to Address
- **Live locator-rebind mechanics (highest):** the exact public-API path to intercept a real resolution failure and replay the action against a substituted element is confirmed in shape but not in detail. Resolve via the phase-1 spike; read the three prior-art repos and test against min/max Playwright minors before committing the integration design.
- **Exact peer-dependency floor:** wrapper pattern works well before 1.42; ariaSnapshot signals need >=1.49. Pin the tested floor in phase 1 against the real minimum supported version.
- **Default threshold/margin values:** around 0.90 floor and the margin delta are starting points (Healenium-informed); calibrate empirically against the fixture app in phases 2/4.
- **Capture overhead budget:** the under 5-10% target needs a real benchmark on an element-heavy suite (phase 4 CI gate).
- **Parallel-store at scale / CI sharding:** per-worker shard plus teardown merge is sound for v1; revisit node:sqlite only if contention appears.

## Sources

### Primary (HIGH confidence)
- https://playwright.dev/docs/test-fixtures — test.extend, overriding the built-in page fixture (the integration seam)
- https://playwright.dev/docs/api/class-locator — evaluate, evaluateAll, elementHandle, all, count, resolution semantics
- https://playwright.dev/docs/api/class-reporter — onTestEnd/onEnd are post-hoc (no DOM, aggregation only)
- https://playwright.dev/docs/api/class-testinfo — attach() and workerIndex (the only stable worker-to-main channel)
- https://playwright.dev/docs/test-global-setup-teardown — shared baseline lifecycle / shard merge
- https://playwright.dev/docs/api/class-selectors + https://playwright.dev/docs/extensibility — selectors.register() custom selector engines
- https://playwright.dev/docs/aria-snapshots + 1.59/1.60 release notes — ariaSnapshot added 1.49
- https://endoflife.date/nodejs + https://github.com/nodejs/Release — Node 24 Active LTS, 22 Maintenance LTS
- https://publint.dev/rules + https://www.npmjs.com/package/@arethetypeswrong/cli — exports/publish validation
- https://github.com/microsoft/playwright/issues/23662 + /36252 — Playwright CJS/ESM module friction
- Similo (offline weighted multi-signal blueprint): https://arxiv.org/pdf/2208.00677 ; https://dl.acm.org/doi/10.1145/3571855

### Secondary (MEDIUM confidence)
- Healenium (OSS capture-on-success plus score-cap lifecycle, tree-LCS, false-green risk): https://healenium.io/ ; https://www.automatetheplanet.com/healenium-self-healing-tests/ ; https://github.com/healenium/healenium-web
- Testim / Mabl / Katalon self-healing mechanics (semantic over positional, confidence gates, review UIs): testim.io, help.mabl.com, docs.katalon.com
- False-positive / regression-masking analysis: https://medium.com/qawolf/the-6-types-of-ai-self-healing-in-test-automation-5168e3ae9fdc ; https://getautonoma.com/blog/ai-self-healing-test-automation ; https://crosscheck.cloud/blogs/self-healing-tests-ai/
- tsdown vs tsup (2026 bundler successor): https://tsdown.dev ; https://www.pkgpulse.com/guides/tsup-vs-tsdown-vs-unbuild-typescript-library-bundling-2026
- Dual ESM/CJS publishing guidance: https://lirantal.com/blog/typescript-in-2025-with-esm-and-cjs-npm-publishing ; https://snyk.io/blog/building-npm-package-compatible-with-esm-and-cjs-2024/
- microsoft/playwright#31559 — custom worker-to-main IPC unavailable (confirms the constraint)

### Tertiary (LOW confidence, validate in phase 1)
- Prior-art Playwright self-heal repos (confirm fixture+wrapper pattern; read source during the rebind spike): https://github.com/qosha1/healing-playwright ; https://github.com/amrsa1/healwright ; https://github.com/paulocoliveira/playwright-auto-heal ; https://github.com/headout/autoheal

---
*Research completed: 2026-05-31*
*Ready for roadmap: yes*
