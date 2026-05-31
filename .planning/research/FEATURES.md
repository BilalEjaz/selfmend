# Feature Research

**Domain:** Self-healing locator tooling for E2E test automation (Playwright plugin, locator-only v1)
**Researched:** 2026-05-31
**Confidence:** HIGH on competitor mechanics and signal/scoring practice (Context-grade academic source + vendor docs); MEDIUM on exact threshold numbers (vendor-specific, some inferred from blog summaries).

## How The Field Actually Heals (Grounding For Our Choices)

Before categorizing features, here is the concrete mechanic every credible tool shares, because our v1 must match it to be credible:

**The universal pattern:** capture an element model on a *passing* run -> on failure, scan candidate elements in the live DOM -> score each candidate against the stored model across multiple weighted signals -> pick the highest score -> accept only if it clears a confidence floor.

**Concrete competitor mechanics:**

| Tool | Capture | Signals scored | Scoring method | Threshold model | Apply vs propose | Offline | Reporting |
|------|---------|----------------|----------------|-----------------|------------------|---------|-----------|
| **Healenium** (OSS, Selenium) | Stores full DOM tree path + attributes in Postgres on success | DOM tree path, attributes | Longest Common Subsequence (LCS) over DOM tree -> generates ranked CSS candidates with probability score | `score-cap` (default 0.5 = 50% match probability); below cap = no heal | Heals live to keep run green, then proposes the new selector for review | No (needs Postgres backend service) | Heal report: original locator, healed locator, score; web dashboard |
| **Testim** (closed cloud) | Captures hundreds of DOM attributes per element + parent into a weighted selector tree | text, aria-label, id, class, position, structure, accessibility | ML model scores all attributes simultaneously, confidence per element | Confidence-based; validates new locator before swap | Validates then auto-replaces locator | No (vendor cloud, ML) | Per-element confidence, drift detection over runs |
| **Mabl** (closed cloud) | Captures 35+ attributes for target *and* parent/ancestors + custom test-ids + visual context | attributes (id/class/innerText), DOM position, visual context, ancestors | Best-match against element model incl. partial matches | Confidence-gated; "not confident" triggers auto-heal attempt | Auto-heals, surfaces heals for review/approval | No (vendor cloud) | "Reviewing auto-heals" UI: what healed and why |
| **Katalon** (commercial IDE) | Maintains multiple known locators per object | XPath, CSS, attribute, image (tried top-down); then LLM tier (page source, a11y tree, screenshots) | Try-each fallback ladder; classic first, AI/LLM only if classic fails | First locator that resolves wins | Heals live, then *suggests* replacing the broken locator | Classic tier yes; AI tier no | Self-Healing Insights tab: broken locator, proposed locator, "recovered by" method, **screenshot of matched element for human verify** |
| **testRigor** (closed cloud) | Records human-level "intent" of each locator on first success (e.g. "click Update Message") | semantic plain-English intent, page context | LLM infers intent, re-finds element by intent | AI confidence | Heals + fixes locator | No (LLM) | Intent-based explanation |
| **Functionize** (closed cloud) | Element model | NLP + computer vision; works when DOM changes completely | ML/CV match | AI confidence | Auto-heals | No (cloud + CV) | Visual + structural reasoning |
| **Similo** (academic, the OSS blueprint) | Stores 14 locator parameters from DOM on success | Tag, Class, Name, Id, HRef, Alt, XPath, ID-relative-XPath, Location (x/y), Visible Text, **Neighbor Text** (concatenated text of nearby elements), etc. | Per-parameter similarity (Levenshtein distance, word comparison, Euclidean distance) x weight, summed; highest-scoring candidate wins | Highest score returned as best match | Pure localization research (returns the element) | **Yes, fully offline heuristic** | N/A (research) |

**The single most important takeaway:** Similo (peer-reviewed, ACM TOSEM / ScienceDirect) is the exact offline, no-LLM, multi-signal weighted-scoring blueprint our v1 needs. It proves a heuristic 14-signal weighted approach with Levenshtein/word/Euclidean comparison is competitive *without* a cloud or model. This is the de-risking evidence for our differentiated lane. Healenium proves the OSS capture-on-success + score-cap pattern works in production. We essentially want "Similo's scoring engine + Healenium's lifecycle, but Playwright-native, offline, and propose-not-silently-apply."

**The single most important risk:** every credible source warns that healing can match the *wrong* element (esp. dense UIs / many similar components) and thereby hide a real regression (the classic "redirected to login page, healer matched a different element, test stays green" failure). High confidence != correct. This is why a confidence floor + human-reviewable reporting + never-force-green are table stakes, not nice-to-haves.

## Feature Landscape

### Table Stakes (Users Expect These)

Missing any of these and the tool is not a credible self-healing locator tool.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Capture element fingerprint on passing runs | Every tool (Healenium, Testim, Mabl, Similo) captures on success; you cannot heal without a baseline | MEDIUM | Hook Playwright locator resolution; snapshot signals at the moment a locator resolves green. Persist to a baseline store keyed by locator. |
| Multi-signal element model (not single selector) | Mabl captures 35+, Similo 14, Testim "hundreds". A single attribute is not a fingerprint. Our PROJECT lists text, role, test-id, attributes, neighbours, DOM position | MEDIUM | Minimum viable signal set: visible text, ARIA role, test-id (data-testid/data-test/etc.), key attributes (id, name, type, placeholder, aria-label), tag, neighbour text, DOM position/path. This is the core IP. |
| Candidate scoring against the model | The whole field scores candidates; binary "found/not found" is not healing | HIGH | Per-signal similarity x weight, summed. Use Levenshtein/word-overlap for text, exact/normalized for role/test-id, positional distance for DOM. Highest score wins. (Similo pattern.) |
| Confidence threshold / floor | Healenium `score-cap`, Mabl confidence gate, all gate on confidence. Without a floor you guarantee false matches | LOW | Single tunable float (e.g. default ~0.7). Below floor = no heal, test fails normally. PROJECT mandates this. |
| Never force a green (no heal below floor) | The category's defining trust failure is the falsely-green suite hiding a real bug | LOW | This is a behavioural guarantee, not code volume, but it is non-negotiable and must be tested explicitly. |
| Heal report: original selector, healed target, confidence | Healenium, Katalon (Insights tab), Mabl all report old->new + score. Teams will not trust an invisible swap | LOW | PROJECT scopes v1 to console summary: per-heal line with original locator, matched target description, score. |
| Drops into an existing Playwright project, minimal config | Adoption bar; nobody rewrites their suite to try a plugin | MEDIUM | Fixture + reporter packaging. Must not require teams to change how they write locators. |
| Toggle on/off + tune threshold via config | Every tool exposes enable/disable and sensitivity; teams need an escape hatch | LOW | PROJECT requirement. Simple config object. |

### Differentiators (Competitive Advantage)

These are where we beat the field. They map 1:1 to PROJECT's "differentiated lane."

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Fully offline, no API key, no cloud, no telemetry** | Healenium needs Postgres; Testim/Mabl/testRigor/Functionize/Katalon-AI all send DOM/screenshots to a vendor. Sending DOM off-box is the #1 enterprise adoption blocker. We send nothing. | LOW (it's a constraint, kept by avoiding network code) | Hard requirement. Heuristic scoring (Similo-style) makes this achievable with no model. The biggest single selling point. |
| **Open source, MIT** | Only Healenium is OSS and it's Selenium-only with dated tree-LCS matching. We are OSS + modern signal scoring + Playwright | LOW | Trust + zero-friction wedge. |
| **Playwright-native** | No general OSS self-healer is Playwright-native; existing Playwright "auto-heal" repos are mostly LLM/OpenAI-embedding demos, not offline plugins | MEDIUM | Build on Playwright's own role/text/test-id locators as first-class signals (Playwright already favours semantic locators, so our model aligns with good practice). |
| **Propose, do not silently apply** | Testim/Mabl/Functionize auto-rewrite. Katalon/Healenium at least propose. We heal the *run* live (stays green) but never edit the user's test source. Removes the "silent drift becomes permanent" risk | LOW | Console summary = the proposal. v1 deliberately stops at reporting; no source rewrite, no committed store. |
| **Modern semantic-signal model vs Healenium's tree-LCS** | Healenium leans on DOM tree position (brittle to re-layout). Weighted text+role+test-id+neighbour model survives restructuring far better | HIGH | This is the technical quality bar. Weight semantic/stable signals (text, role, test-id, aria-label) higher than positional signals (DOM path, x/y), because structure churns more than meaning (Testim's own finding). |
| **Transparent "why it healed"** | Beyond old->new, explain *which signals matched* and their contribution to the score | MEDIUM | Differentiator over a bare confidence number. Helps the human judge if it's a real match or a wrong-element heal. Strong fit for v1 console output; can be a per-signal breakdown line. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Silent assertion healing / assertion rewriting** | "Heal everything, keep my suite green" | Directly hides real bugs; an assertion that auto-adjusts to the app's actual output validates nothing. Category's worst failure mode | Out of scope entirely. Locator-only v1. If ever built (v2), must be propose-only and loud. |
| **Forced green / heal-everything (no floor)** | Makes flaky suites "pass" | Guarantees wrong-element matches and false negatives that mask regressions; turns the tool into a liability | Confidence floor; below it the test fails normally. Already a PROJECT hard rule. |
| **Auto-editing test source files** | "Just fix my code for me" | Silent permanent drift; the broken locator quietly becomes the new truth with no review; merge/diff noise; trust erosion | v1 proposes via console only. PR/diff delivery deferred to v2 as an explicit, reviewable change. |
| **LLM-assisted ranking in v1** | "AI makes it smarter / handles total DOM rewrites" | Breaks offline + no-API-key, the core differentiator; sends DOM/screenshots to a vendor; cost; non-determinism | Heuristic weighted scoring (Similo-proven) for v1. LLM as optional low-confidence tiebreaker is v2, opt-in, never default-on. |
| **Smart-wait / flakiness healing** | "Fix all my flaky tests" | Different problem domain; retrying/waiting can also mask real timing regressions; Playwright already auto-waits | v2. Keep v1 sharp: locator rebinding only. |
| **Visual / computer-vision matching** | "Match even when DOM changes completely" (Functionize) | Heavy dependency, screenshots usually imply cloud, brittle to legit visual redesign, large scope | Optional later. v1 stays DOM-signal-based and offline. |
| **Hosted dashboard / accounts / cloud store** | "See heals across the team / history" | Contradicts offline + OSS wedge; recreates the vendor model we're differentiating against | Console summary in v1; JSON/HTML report files in v2; any hosted layer is much-later open-core, never v1. |
| **Persisted committed original->healed selector store in v1** | "Track drift over time in git" | Adds storage/format/merge surface and a committed artifact before we've validated the core; risks turning heals into silent committed changes | v2. v1 surfaces via console only (PROJECT decision). |

## Feature Dependencies

```
Capture element fingerprint on passing runs
    └──requires──> Hook into Playwright locator resolution (fixture)
    └──requires──> Baseline store (in-memory/file, keyed by locator)

Candidate scoring against the model
    └──requires──> Multi-signal element model (the captured fingerprint)
    └──requires──> Candidate enumeration (query live DOM for plausible elements)

Confidence threshold / floor
    └──requires──> Candidate scoring (you can only floor a score)

Live rebind to keep run green
    └──requires──> A candidate clearing the floor
    └──requires──> Playwright locator-override mechanism

Heal report (console summary)
    └──requires──> Live rebind events to report on
    └──enhanced-by──> Transparent "why it healed" (per-signal breakdown)

Fully offline guarantee  ──conflicts──> LLM ranking, visual/CV matching, hosted store
Propose-not-apply        ──conflicts──> Auto-edit source, silent assertion healing, forced green
```

### Dependency Notes

- **Scoring requires the multi-signal model:** the model *is* the input to scoring; design the captured fingerprint and the comparator together (each signal needs a capture format and a similarity operator + weight).
- **Confidence floor requires scoring:** a floor is meaningless without a normalized 0-1 score; normalize the weighted sum so the threshold is interpretable and tunable.
- **Live rebind requires a Playwright override hook:** the riskiest unknown for v1 is *how* to transparently substitute the resolved element/locator inside Playwright without forking it. Flag for technical spike in phase planning.
- **Offline conflicts with LLM/CV/cloud-store:** these are mutually exclusive with the core differentiator; that is precisely why they are v2/anti-features.

## MVP Definition

### Launch With (v1) — Locator Healing Only

- [ ] Plugin installs into an existing Playwright project as an npm package, minimal config — adoption bar
- [ ] Capture multi-signal fingerprint (text, role, test-id, attributes, neighbour text, DOM position) on passing locator resolution, persist to baseline store — no heal possible without it
- [ ] Score candidate elements against the fingerprint with weighted per-signal similarity (semantic signals weighted above positional) — the core engine; this is the credibility bar
- [ ] Confidence floor: accept best candidate only if score >= threshold — defines trust
- [ ] Live rebind on a clearing match so the run stays green — the headline value
- [ ] No heal below floor; test fails normally (no false greens) — the non-negotiable trust guarantee
- [ ] Console summary per heal: original selector, healed target, confidence score — observability table stake
- [ ] Fully offline: no network, no API key, no telemetry — the core differentiator
- [ ] Toggle on/off + tune threshold via config — control / escape hatch

### Add After Validation (v1.x)

- [ ] Transparent per-signal "why it healed" breakdown in the console — trigger: users ask "why did it pick that element?" / report wrong-element heals
- [ ] Matched-element verification aid (e.g. brief DOM-context dump like Katalon's screenshot, but offline/textual) — trigger: false-match reports
- [ ] Tunable per-signal weights — trigger: teams with unusual apps want to bias test-id vs text

### Future Consideration (v2+)

- [ ] JSON / HTML report files + committed original->healed store — defer: storage/format surface, only after console value is proven
- [ ] PR / diff delivery of permanent fixes (propose-only, reviewable) — defer: source-mutation risk; needs the review story right
- [ ] LLM-assisted ranking as opt-in low-confidence tiebreaker — defer: breaks offline default; only as explicit opt-in
- [ ] Assertion-drift diagnosis (propose-only, loud) — defer: highest bug-hiding risk in the category
- [ ] Smart-wait / flakiness healing — defer: different domain, masking risk
- [ ] Other frameworks (Cypress/Selenium) — defer: incompatible locator models; ship Playwright sharp first
- [ ] Visual / CV matching — defer: cloud/dependency weight, conflicts with offline

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Multi-signal fingerprint capture | HIGH | MEDIUM | P1 |
| Weighted candidate scoring engine | HIGH | HIGH | P1 |
| Confidence floor + never-force-green | HIGH | LOW | P1 |
| Live rebind to keep run green | HIGH | MEDIUM (Playwright override unknown) | P1 |
| Console heal summary (old/new/confidence) | HIGH | LOW | P1 |
| Offline / no-key / no-telemetry | HIGH | LOW | P1 |
| Minimal-config install | HIGH | MEDIUM | P1 |
| Toggle + threshold config | MEDIUM | LOW | P1 |
| Per-signal "why it healed" breakdown | MEDIUM | MEDIUM | P2 |
| Tunable per-signal weights | MEDIUM | LOW | P2 |
| JSON/HTML reports + committed store | MEDIUM | MEDIUM | P3 |
| PR/diff delivery | MEDIUM | HIGH | P3 |
| LLM tiebreaker | LOW (v1) | MEDIUM | P3 |

## Competitor Feature Analysis

| Feature | Healenium (OSS/Selenium) | Testim/Mabl (closed cloud) | Katalon | Our Approach (v1) |
|---------|--------------------------|----------------------------|---------|-------------------|
| Capture timing | On success -> Postgres | On record/run -> cloud | Multiple stored locators | On passing resolution -> local baseline store |
| Signals | DOM tree path + attrs | 35-hundreds of attrs, parent, visual | XPath/CSS/attr/image + LLM tier | text, role, test-id, attrs, neighbour text, DOM position |
| Scoring | LCS tree comparison + probability | ML weighted scoring | Try-each fallback ladder | Weighted per-signal similarity (Levenshtein/word/positional), Similo-style |
| Threshold | `score-cap` (default 0.5) | Confidence + validation | First locator that resolves | Tunable floor (~0.7 default), no heal below |
| Apply model | Heal live, propose new | Validate + auto-replace | Heal live, suggest replacement | Heal run live, **propose via console, never edit source** |
| Offline | No (Postgres service) | No (cloud/ML) | Classic yes, AI no | **Yes, fully** |
| Reporting | Old/new/score, dashboard | Confidence + drift UI | Insights tab + screenshot | Console: original, target, confidence (+ why, v1.x) |
| Bug-hiding guardrail | score-cap only | human review UI | screenshot verify | floor + no-force-green + transparent report |

## Sources

- Healenium: https://healenium.io/ ; https://github.com/healenium/healenium-web ; https://www.automatetheplanet.com/healenium-self-healing-tests/ (LCS tree comparison, score-cap default 0.5)
- Testim smart/genius locators: https://www.testim.io/blog/announcing-auto-improving-smart-locators-dare-we-say-genius-locators/ ; https://join.momentic.ai/resources/beyond-smart-locators-the-next-generation-of-self-healing-tests-with-testim (weighted selector tree, semantic > positional)
- Mabl auto-heal: https://help.mabl.com/hc/en-us/articles/19078583792404-How-auto-heal-works ; https://help.mabl.com/docs/auto-heal-faqs (35+ attributes, ancestors, partial-match)
- Katalon self-healing: https://docs.katalon.com/katalon-studio/maintain-tests/self-healing-tests-in-katalon-studio ; https://katalon.com/resources-center/blog/self-healing-object-locator (fallback ladder, Insights tab, screenshot verify)
- testRigor / Functionize: https://testrigor.com/ai-based-self-healing/ ; https://www.functionize.com/automated-testing/ai-testing-tools (intent/NLP+CV, cloud)
- Similo (academic blueprint, offline weighted multi-signal): https://arxiv.org/pdf/2208.00677 ; https://dl.acm.org/doi/10.1145/3571855 ; https://www.sciencedirect.com/science/article/pii/S0164121224003303 (14 weighted parameters, neighbour text, Levenshtein/word/Euclidean)
- Bug-hiding risk / false positives: https://medium.com/qawolf/the-6-types-of-ai-self-healing-in-test-automation-5168e3ae9fdc ; https://getautonoma.com/blog/ai-self-healing-test-automation ; https://bugbug.io/blog/test-automation/self-healing-test-automation/ (heal-everything is deceptive; high confidence != correct; audit trails + <5% false-positive bar)
- Playwright OSS self-healing repos (mostly LLM/CV demos, confirming the offline-heuristic-Playwright-native gap): https://github.com/qosha1/healing-playwright ; https://github.com/headout/autoheal ; https://github.com/paulocoliveira/playwright-auto-heal

---
*Feature research for: self-healing Playwright locator plugin (locator-only v1)*
*Researched: 2026-05-31*
