# Roadmap: Playwright SelfHeal

## Overview

This roadmap delivers an offline, MIT-licensed, Playwright-native self-healing locator plugin as a series of working vertical slices. Phase 1 lands the thinnest possible REAL heal: install into a project, capture a fingerprint on a passing run, match a broken locator against it through the trust gates (confidence floor, second-best margin, never-force-green), rebind it live, and print a console summary, all on a single-worker simple case. The live-rebind hook (the riskiest unknown) is de-risked here so the integration design is proven before it is deepened. Later phases widen the signal model and harden the trust gates, make the baseline persist safely under parallel workers, and finish offline verification and the npm publish. Throughout, the scoring and heal-decision logic stays pure (Playwright-free) and is built test-first, because that pure core is where the product's defining false-green guarantee is enforced.

**Milestone v0.2.0 (Runner-Agnostic Healing)** opens the shipped v1 engine to any framework that drives a real Playwright `Page` (Cucumber, Mocha, Jest, plain scripts), not just `@playwright/test`. The shipped fixture already contains everything the runner-agnostic seam needs, an internal `wrapPage`, the `wrapLocator` proxy, a per-test occurrence counter, and a `HealContext` carrying identity, store, and config, so this milestone is a *generalization*, not a rewrite. Phase 5 lifts the internal `wrapPage` into a public runner-agnostic core: identity becomes a caller-supplied `scope()` callback (read live per locator creation, occurrence reset per scope, retry-safe), event transport becomes pluggable (a callback in place of the Playwright `testInfo.attach` channel), and the existing `@playwright/test` fixture is refactored to be one adapter over that core with zero behaviour change (proven by the existing 125 unit + 23 e2e tests still passing). Phase 6 exposes the persistence and output building blocks raw frameworks need as standalone functions (`loadBaseline`/`saveBaseline` refresh-and-add-only, `mergeBaselines` for parallel runs, `onHeal` callback, `renderHealSummary`). Phase 7 documents `wrapPage` with real Cucumber / Mocha-Jest / plain-script recipes and the honest never-false-green guarantee. The cross-cutting hard rule, never-false-green holds in raw mode exactly as in fixture mode; a wrong or missing identity key is a *missed* heal, never a wrong heal or a false green, is enforced in the pure core and asserted as an explicit success criterion in Phase 5.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

**Milestone v1 (shipped 2026-06-01 as selfmend@0.1.x):**

- [x] **Phase 1: Thinnest Real Heal** - End-to-end single-worker heal: install, capture, pure-scored match through the trust gates, live rebind, console summary
- [x] **Phase 2: Trust Hardening** - Multi-signal weighted scoring with hardened confidence floor, second-best margin gate, no-force-green, and a clear audit trail (completed 2026-05-31)
- [x] **Phase 3: Persistence & Parallel-Worker Safety** - Baseline survives across runs and is corruption-free under Playwright parallel workers (completed 2026-05-31)
- [x] **Phase 4: Offline Verification & Publish** - Network-blocked offline proof, dual ESM/CJS packaging, compatibility matrix, first npm release (completed 2026-05-31)

**Milestone v0.2.0 (Runner-Agnostic Healing):**

- [x] **Phase 5: Runner-Agnostic Core** - Lift the internal `wrapPage` into a public `wrapPage(page, opts)` with caller-supplied `scope()` identity and pluggable event transport, then refactor the `@playwright/test` fixture onto it with zero behaviour change (completed 2026-06-02)
- [ ] **Phase 6: Standalone Persistence & Output** - Expose `loadBaseline`/`saveBaseline`/`mergeBaselines` and the `onHeal` callback + `renderHealSummary` so raw frameworks persist baselines and print the boxed report with no Playwright reporter
- [ ] **Phase 7: Recipes & Docs** - Document `wrapPage` with working Cucumber, Mocha/Jest, and plain-script recipes plus the honest limits and never-false-green guarantee

## Phase Details

### Phase 1: Thinnest Real Heal
**Goal**: A user can install the plugin into an existing Playwright project and watch a single broken locator self-heal end-to-end on a simple, single-worker case, with the heal reported to the console.
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: INST-01, INST-02, CAP-01, MATCH-01, HEAL-01, HEAL-02, REP-01, CFG-01
**Success Criteria** (what must be TRUE):
  1. User adds the plugin via npm install plus a single fixture import and their existing `page`/locator tests run unchanged
  2. On a passing run, the plugin records an element fingerprint for each resolved locator and a later broken locator is scored against that fingerprint by a pure, test-first scorer
  3. When the top candidate clears the threshold, the broken locator is rebound live and the test continues green; the heal fires only after Playwright's normal auto-wait/timeout, never on a transient poll miss
  4. At end of run the console summary lists the heal with original selector, healed target, and confidence score
  5. User can toggle healing on or off via plugin config
**Plans**: 5 plans
- [x] 01-01-PLAN.md, Package skeleton (dual ESM/CJS, peer dep), test-first config (CFG-01), framework configs + offline HTML fixture
- [x] 01-02-PLAN.md, Pure Playwright-free scorer + heal-decision with conservative floor (TDD, MATCH-01 core, false-green guard)
- [x] 01-03-PLAN.md, Throwaway rebind spike: catch TimeoutError + replay, chained-Proxy, bounded timeout budget (de-risk)
- [x] 01-04-PLAN.md, Live heal loop: in-process store, fingerprint capture, candidate-finder, locator Proxy + page fixture (CAP-01, HEAL-01/02, INST-02)
- [x] 01-05-PLAN.md, Summary-only boxed reporter (REP-01) + public import-swap entry + install/report proof (INST-01/02)

### Phase 2: Trust Hardening
**Goal**: The matcher becomes trustworthy: multi-signal weighted scoring, both trust gates enforced in the pure core, and a console audit trail that cannot produce a false green.
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: MATCH-02, MATCH-03, MATCH-04, REP-02, CFG-02
**Success Criteria** (what must be TRUE):
  1. A heal is accepted only when the top candidate's score clears an absolute confidence floor (test-first proof that a below-floor best candidate fails the test normally)
  2. A heal is accepted only when the top candidate beats the second-best candidate by a configurable margin (test-first proof that an ambiguous top-two pair fails rather than heals)
  3. When neither gate is cleared (no candidate, below floor, or ambiguous), the plugin does not heal and the locator fails normally with a loud "could not heal" message (no false greens)
  4. The console summary clearly distinguishes healed locators from failed-to-heal ones, showing confidence and runner-up margin per heal
  5. User can configure the confidence floor and the margin gate via plugin config
**Plans**: 2 plans
- [x] 02-01-PLAN.md, Pure core + config: margin gate in decide(), bestScore on no-heal, weight ordering invariant, margin config key (TDD; MATCH-02, MATCH-03, CFG-02)
- [x] 02-02-PLAN.md, Refused-heal slice: SelfmendEvent tagged union, proxy attach-then-rethrow, reporter could-not-heal section, ambiguous-duplicate Playwright proof (MATCH-04, REP-02)

### Phase 3: Persistence & Parallel-Worker Safety
**Goal**: The baseline store survives across runs and stays corruption-free when Playwright runs tests across parallel workers.
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: CAP-02, CAP-03
**Success Criteria** (what must be TRUE):
  1. Captured fingerprints persist to a local baseline store that survives across separate runs (a heal works on run N using a baseline captured on run N-1)
  2. A fully parallel multi-worker run produces no store corruption or lost writes (per-worker shards merged deterministically, verified by a concurrent-write test)
  3. The persisted store holds only minimal derived signals, not raw DOM content, and is human-inspectable
**Plans**: 3 plans
- [x] 03-01-PLAN.md, Pure store layer (TDD): versioned zod schema, deterministic serializer, merge+refresh+prune; Playwright/fs-free (CAP-02, CAP-03)
- [x] 03-02-PLAN.md, fs persistence adapter (Windows-safe atomic write, parallelIndex shards) + occurrence-based identity key swap across proxy/store/fixture (CAP-02, CAP-03)
- [x] 03-03-PLAN.md, Worker shard flush + Reporter onBegin/onEnd merge+gated-prune + .gitignore reconcile + CAP-02/CAP-03/D-09 integration specs (CAP-02, CAP-03)

### Phase 4: Offline Verification & Publish
**Goal**: The offline guarantee is proven mechanically and the package installs cleanly from npm in real ESM and CJS projects across the supported Playwright range.
**Mode:** mvp
**Depends on**: Phase 3
**Requirements**: PRIV-01
**Success Criteria** (what must be TRUE):
  1. A network-blocked CI run completes a full capture-and-heal cycle with zero outbound connections, no API key, and no telemetry
  2. The package installs and imports correctly in both a real ESM project and a real CJS project, validated by publint and attw
  3. A Playwright-version matrix (lowest and highest declared supported minors) passes the heal integration tests
  4. The package is published to npm under MIT with a README documenting zero-friction install
**Plans**: 3 plans
- [x] 04-01-PLAN.md, Commit lockfile (D-08) + self-validating PRIV-01 offline network-block heal-cycle test (D-03) + NUL-byte/no-network-import guard
- [x] 04-02-PLAN.md, Publish prep: version 0.1.0 + CHANGELOG + prepublishOnly + no source maps + D-07 README (config ref, trust model, committed-baseline, limitations)
- [x] 04-03-PLAN.md, Matrix CI (node 22/24 x PW 1.42/1.60, manual release) + green npm publish --dry-run terminal proof + RELEASING checklist

### Phase 5: Runner-Agnostic Core
**Goal**: A developer driving a raw Playwright `Page` from any framework can call one `wrapPage(page, opts)` and have every locator on that page self-heal, with identity supplied by a caller `scope()` callback and heal events delivered through a pluggable transport, while the shipped `@playwright/test` fixture becomes one thin adapter over that same core with no behaviour change for existing users.
**Mode:** mvp
**Depends on**: Phase 4
**Requirements**: WRAP-01, WRAP-02, WRAP-03, WRAP-04
**Success Criteria** (what must be TRUE):
  1. A developer can wrap a raw Playwright `Page` with `wrapPage(page, { store, config?, onHeal?, scope? })` and an existing `page`/locator script self-heals a broken locator with no test rewrites and without the `@playwright/test` runner
  2. Identity comes from a `scope()` callback returning two stable ids (suite, test) read at each locator creation, so a single long-lived page heals correctly as it moves between logical tests; the occurrence index resets per (suite, test) scope and re-running the same scope does not drift the index (retry-safe)
  3. Never-false-green holds in raw mode exactly as in fixture mode: a wrong or missing identity key produces a *missed* heal (the locator fails normally), never a wrong heal and never a false green, proven by a control test that supplies a bad/absent scope
  4. The `@playwright/test` fixture is refactored to delegate to the shared `wrapPage` core, and the existing 125 unit + 23 e2e tests all still pass with zero behaviour change for existing fixture users
**Plans**: 2 plans
- [x] 05-01-PLAN.md, Core seam refactor (HealContext pluggable emit + scope source, no testInfo) + public wrapPage/resetScope; TDD scope-lifetime (auto-reset + resetScope) + config merge (WRAP-01/02/03)
- [x] 05-02-PLAN.md, Refactor the @playwright/test fixture onto the shared core (zero-behaviour-change HARD gate, 125 unit + 23 e2e byte-identical) + raw-mode wrap-page integration proof (heal-green + never-false-green controls + throwing onHeal/scope fail-safe) (WRAP-04/WRAP-01)

### Phase 6: Standalone Persistence & Output
**Goal**: A raw-framework user has every persistence and output building block the fixture+reporter gave `@playwright/test` users, exposed as standalone functions: load and save a baseline file directly, merge per-worker baselines safely for parallel runs, receive every heal event through an `onHeal` callback, and render the same boxed summary from collected events without any Playwright reporter.
**Mode:** mvp
**Depends on**: Phase 5
**Requirements**: OUT-01, OUT-02, STORE-01, STORE-02, STORE-03
**Success Criteria** (what must be TRUE):
  1. A developer can load a baseline standalone via `loadBaseline(path)` and persist it via `saveBaseline(path, store)`, decoupled from the reporter and shard machinery, and a heal works on a later run from the saved file alone
  2. `saveBaseline` refreshes-and-adds only and never auto-prunes: an entry present before a save that captured nothing for that key is still present after the save
  3. A developer can combine per-worker baselines via `mergeBaselines(...)` so a parallel run loses no entries and produces no corruption (verified by a merge test over overlapping and disjoint per-worker baselines)
  4. A developer can pass an `onHeal` callback to `wrapPage` that receives every heal event (both healed and could-not-heal), so heals are loggable without a Playwright reporter
  5. A developer can render the standard boxed heal summary from collected events via `renderHealSummary(events)`, byte-identical to the reporter's output for the same events
**Plans**: 2 plans
- [x] 06-01-PLAN.md, Standalone persistence slice: loadBaseline(path)/saveBaseline(path,store) refresh-only + mergeBaselines(...) deterministic fold + internal loadCommittedBaseline rename (TDD; STORE-01/02/03)
- [ ] 06-02-PLAN.md, Output slice: extract shared pure renderHealSummary(events) byte-identical + reporter delegates (zero output change) + raw-mode onHeal confirming test (TDD; OUT-01/OUT-02)

### Phase 7: Recipes & Docs
**Goal**: A developer evaluating selfmend for a non-`@playwright/test` framework can follow the README to wire `wrapPage` into Cucumber, Mocha/Jest, or a plain script, and understands exactly what selfmend will and will not do, including the never-false-green guarantee and the honest limits.
**Mode:** mvp
**Depends on**: Phase 6
**Requirements**: DOC-01
**Success Criteria** (what must be TRUE):
  1. The README documents `wrapPage` with a working recipe for each of Cucumber, Mocha/Jest, and a plain script, each showing the `scope()` wiring, baseline load/save, and heal output
  2. The docs state the never-false-green guarantee for raw mode and the honest limits (Page-level only this milestone; a wrong/missing key is a missed heal, never a wrong heal) so an adopter is not surprised
  3. Each recipe is runnable as written (the code blocks compile against the published API surface, validated by a docs/example smoke check)
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Thinnest Real Heal | 5/5 | Complete | 2026-05-31 |
| 2. Trust Hardening | 2/2 | Complete   | 2026-05-31 |
| 3. Persistence & Parallel-Worker Safety | 3/3 | Complete   | 2026-05-31 |
| 4. Offline Verification & Publish | 3/3 | Complete | 2026-05-31 |
| 5. Runner-Agnostic Core | 2/2 | Complete   | 2026-06-02 |
| 6. Standalone Persistence & Output | 1/2 | In Progress|  |
| 7. Recipes & Docs | 0/? | Not started | - |
