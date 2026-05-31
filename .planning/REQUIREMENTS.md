# Requirements: Playwright SelfHeal

**Defined:** 2026-05-31
**Core Value:** When a test fails only because a selector changed (not because the app is actually broken), the suite keeps running and tells the team exactly what changed, without any data leaving their CI.

> "User" below means the developer or QA engineer who adopts the plugin into their Playwright project.

## v1 Requirements

Requirements for the initial release. v1 is locator healing only.

### Installation & Integration

- [ ] **INST-01**: User can add the plugin to an existing Playwright project via npm install plus a single config or fixture import
- [ ] **INST-02**: The plugin works with a project's existing `page` and locator usage without requiring tests to be rewritten

### Capture

- [ ] **CAP-01**: On a passing run, the plugin records an element fingerprint (text, role, test-id, attributes, neighbour context, DOM position) for each successfully resolved locator
- [ ] **CAP-02**: Captured fingerprints persist to a local baseline store that survives across runs
- [ ] **CAP-03**: Baseline capture is safe under Playwright parallel workers, with no store corruption or races

### Matching & Heal Decision

- [ ] **MATCH-01**: When a locator fails to resolve, the plugin enumerates candidate elements and scores each against the stored fingerprint using weighted signals
- [ ] **MATCH-02**: A heal is accepted only when the top candidate's score clears an absolute confidence floor
- [ ] **MATCH-03**: A heal is accepted only when the top candidate beats the second-best candidate by a configurable margin, preventing ambiguous matches
- [ ] **MATCH-04**: When no candidate clears both gates, the plugin does not heal and the locator fails normally (no false greens)

### Live Heal

- [ ] **HEAL-01**: On an accepted match, the plugin rebinds the broken locator to the matched element so the test continues and passes
- [ ] **HEAL-02**: Healing triggers only after Playwright's normal auto-wait and timeout, never on a transient poll miss

### Reporting

- [ ] **REP-01**: At end of run, the plugin prints a console summary of every heal: original selector, healed target, confidence score, and margin
- [ ] **REP-02**: The summary clearly distinguishes healed locators from failed-to-heal ones, giving the team a visible audit trail

### Privacy & Offline

- [ ] **PRIV-01**: The entire healing path runs fully offline, with no network calls, no API key, and no telemetry, verified by a network-blocked test

### Configuration

- [ ] **CFG-01**: User can toggle healing on or off via plugin config
- [ ] **CFG-02**: User can configure the confidence floor and the margin gate

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
| Cypress, Selenium, other frameworks | v1 is Playwright-only, to ship a sharp tool before expanding across incompatible locator models |
| Auto-editing test source files | The product proposes, it never silently rewrites tests |
| Silent assertion rewriting | Destroys a test's reason to exist, the core anti-feature of this category |
| Forcing a test green when confidence is low | Falsely green suites are the trust-killing failure mode |
| Hosted dashboard, accounts, vendor cloud | Conflicts with the offline, no-data-leaves-CI core; an open-core layer is a far-future maybe |
| Visual / computer-vision matching | Heavy dependency, out of the offline semantic-signal lane for v1 |
| Telemetry / analytics phone-home | Hard privacy constraint |

## Traceability

Which phases cover which requirements. Populated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| INST-01 | TBD | Pending |
| INST-02 | TBD | Pending |
| CAP-01 | TBD | Pending |
| CAP-02 | TBD | Pending |
| CAP-03 | TBD | Pending |
| MATCH-01 | TBD | Pending |
| MATCH-02 | TBD | Pending |
| MATCH-03 | TBD | Pending |
| MATCH-04 | TBD | Pending |
| HEAL-01 | TBD | Pending |
| HEAL-02 | TBD | Pending |
| REP-01 | TBD | Pending |
| REP-02 | TBD | Pending |
| PRIV-01 | TBD | Pending |
| CFG-01 | TBD | Pending |
| CFG-02 | TBD | Pending |

**Coverage:**
- v1 requirements: 16 total
- Mapped to phases: 0 (set during roadmap)
- Unmapped: 16 (roadmapper will map all)

---
*Requirements defined: 2026-05-31*
*Last updated: 2026-05-31 after initial definition*
