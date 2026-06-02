# Requirements: Playwright SelfHeal

**Defined:** 2026-05-31
**Core Value:** When a test fails only because a selector changed (not because the app is actually broken), the suite keeps running and tells the team exactly what changed, without any data leaving their CI.

> "User" below means the developer or QA engineer who adopts the plugin into their Playwright project.

## v1 Requirements

Requirements for the initial release. v1 is locator healing only.

### Installation & Integration

- [x] **INST-01**: User can add the plugin to an existing Playwright project via npm install plus a single config or fixture import
- [x] **INST-02**: The plugin works with a project's existing `page` and locator usage without requiring tests to be rewritten

### Capture

- [x] **CAP-01**: On a passing run, the plugin records an element fingerprint (text, role, test-id, attributes, neighbour context, DOM position) for each successfully resolved locator
- [x] **CAP-02**: Captured fingerprints persist to a local baseline store that survives across runs
- [x] **CAP-03**: Baseline capture is safe under Playwright parallel workers, with no store corruption or races

### Matching & Heal Decision

- [x] **MATCH-01**: When a locator fails to resolve, the plugin enumerates candidate elements and scores each against the stored fingerprint using weighted signals
- [x] **MATCH-02**: A heal is accepted only when the top candidate's score clears an absolute confidence floor
- [x] **MATCH-03**: A heal is accepted only when the top candidate beats the second-best candidate by a configurable margin, preventing ambiguous matches
- [x] **MATCH-04**: When no candidate clears both gates, the plugin does not heal and the locator fails normally (no false greens)

### Live Heal

- [x] **HEAL-01**: On an accepted match, the plugin rebinds the broken locator to the matched element so the test continues and passes
- [x] **HEAL-02**: Healing triggers only after Playwright's normal auto-wait and timeout, never on a transient poll miss

### Reporting

- [x] **REP-01**: At end of run, the plugin prints a console summary of every heal: original selector, healed target, confidence score, and margin
- [x] **REP-02**: The summary clearly distinguishes healed locators from failed-to-heal ones, giving the team a visible audit trail

### Privacy & Offline

- [x] **PRIV-01**: The entire healing path runs fully offline, with no network calls, no API key, and no telemetry, verified by a network-blocked test

### Configuration

- [x] **CFG-01**: User can toggle healing on or off via plugin config
- [x] **CFG-02**: User can configure the confidence floor and the margin gate

## v0.2.0 Requirements (Runner-Agnostic Healing)

Current milestone. Open the engine to any framework that drives a real Playwright `Page`.

### Runner-Agnostic API

- [x] **WRAP-01**: A developer can wrap a raw Playwright `Page` with `wrapPage(page, opts)` so every locator on it self-heals, with no test rewrites and without the `@playwright/test` runner
- [x] **WRAP-02**: Healing identity is supplied via a `scope()` callback returning two stable ids (suite, test), read at each locator creation, so a long-lived page heals correctly as it moves between logical tests
- [x] **WRAP-03**: The occurrence index resets per (suite, test) scope automatically and is retry-safe (re-running the same scope does not drift the index)
- [x] **WRAP-04**: The `@playwright/test` integration is refactored onto the same core/`wrapPage` with zero behaviour change (every existing test still passes)

### Output

- [ ] **OUT-01**: A developer can pass an `onHeal` callback that receives every heal event (healed and could-not-heal), so heals are loggable without a Playwright reporter
- [ ] **OUT-02**: A developer can render the standard boxed heal summary from collected events via `renderHealSummary(events)`

### Persistence

- [ ] **STORE-01**: A developer can load a baseline standalone via `loadBaseline(path)` and save it via `saveBaseline(path, store)`, decoupled from the reporter/shards
- [ ] **STORE-02**: `saveBaseline` refreshes-and-adds only and never auto-prunes
- [ ] **STORE-03**: A developer can merge per-worker baselines via `mergeBaselines(...)` so parallel runs do not corrupt or lose entries

### Docs

- [ ] **DOC-01**: README and recipes document `wrapPage` for Cucumber, Mocha/Jest, and a plain script, with the honest limits and the never-false-green guarantee

> **Cross-cutting hard rule (every WRAP/STORE requirement inherits this):** never-false-green holds in raw mode exactly as in fixture mode. A wrong or missing identity key must produce a missed heal, never a wrong heal or a false green.

## v2 Requirements

Deferred to a future release. Tracked but not in the current roadmap.

### Healing capabilities

- **V2-01**: Smart-wait / flakiness healing (auto-retry with better waits before declaring failure)
- **V2-02**: Assertion-drift diagnosis (classify real-bug vs legitimate UI drift, propose never auto-apply)
- **V2-03**: LLM-assisted candidate ranking as a low-confidence tiebreaker (opt-in, BYO key)

### Delivery & output

- **V2-04**: Package proposed permanent fixes as a reviewable git diff or draft PR
- **V2-05**: Write JSON and HTML report files for CI archiving
- **V2-06**: Maintain a committed original-to-healed selector store for stable, reviewable heals across runs
- **V2-07**: Output paste-ready suggested permanent selector replacements

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Cypress, Selenium, other frameworks | v0.2 supports only frameworks that drive a real Playwright `Page`; Cypress/Selenium use incompatible locator models |
| BrowserContext-level wrapping | v0.2 is Page-level only; context-level (auto-wrap every page) is a later add |
| Auto-editing test source files | The product proposes, it never silently rewrites tests |
| Silent assertion rewriting | Destroys a test's reason to exist, the core anti-feature of this category |
| Forcing a test green when confidence is low | Falsely green suites are the trust-killing failure mode |
| Hosted dashboard, accounts, vendor cloud | Conflicts with the offline, no-data-leaves-CI core; an open-core layer is a far-future maybe |
| Visual / computer-vision matching | Heavy dependency, out of the offline semantic-signal lane |
| Telemetry / analytics phone-home | Hard privacy constraint |

## Traceability

Which phases cover which requirements. Populated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| INST-01 | Phase 1 | Complete |
| INST-02 | Phase 1 | Complete |
| CAP-01 | Phase 1 | Complete |
| CAP-02 | Phase 3 | Complete |
| CAP-03 | Phase 3 | Complete |
| MATCH-01 | Phase 1 | Complete |
| MATCH-02 | Phase 2 | Complete |
| MATCH-03 | Phase 2 | Complete |
| MATCH-04 | Phase 2 | Complete |
| HEAL-01 | Phase 1 | Complete |
| HEAL-02 | Phase 1 | Complete |
| REP-01 | Phase 1 | Complete |
| REP-02 | Phase 2 | Complete |
| PRIV-01 | Phase 4 | Complete |
| CFG-01 | Phase 1 | Complete |
| CFG-02 | Phase 2 | Complete |
| WRAP-01 | Phase 5 | Complete |
| WRAP-02 | Phase 5 | Complete |
| WRAP-03 | Phase 5 | Complete |
| WRAP-04 | Phase 5 | Complete |
| OUT-01 | Phase 6 | Pending |
| OUT-02 | Phase 6 | Pending |
| STORE-01 | Phase 6 | Pending |
| STORE-02 | Phase 6 | Pending |
| STORE-03 | Phase 6 | Pending |
| DOC-01 | Phase 7 | Pending |

**Coverage:**
- v1 requirements: 16 total, mapped 16, unmapped 0
- v0.2.0 requirements: 10 total, mapped 10, unmapped 0

---
*Requirements defined: 2026-05-31*
*Last updated: 2026-06-02, v0.2.0 roadmap created; 10 runner-agnostic requirements mapped to Phases 5-7 (WRAP-01..04 → Phase 5, OUT/STORE → Phase 6, DOC-01 → Phase 7)*
