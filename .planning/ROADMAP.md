# Roadmap: Playwright SelfHeal

## Overview

This roadmap delivers an offline, MIT-licensed, Playwright-native self-healing locator plugin as a series of working vertical slices. Phase 1 lands the thinnest possible REAL heal: install into a project, capture a fingerprint on a passing run, match a broken locator against it through the trust gates (confidence floor, second-best margin, never-force-green), rebind it live, and print a console summary, all on a single-worker simple case. The live-rebind hook (the riskiest unknown) is de-risked here so the integration design is proven before it is deepened. Later phases widen the signal model and harden the trust gates, make the baseline persist safely under parallel workers, and finish offline verification and the npm publish. Throughout, the scoring and heal-decision logic stays pure (Playwright-free) and is built test-first, because that pure core is where the product's defining false-green guarantee is enforced.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Thinnest Real Heal** - End-to-end single-worker heal: install, capture, pure-scored match through the trust gates, live rebind, console summary
- [x] **Phase 2: Trust Hardening** - Multi-signal weighted scoring with hardened confidence floor, second-best margin gate, no-force-green, and a clear audit trail (completed 2026-05-31)
- [ ] **Phase 3: Persistence & Parallel-Worker Safety** - Baseline survives across runs and is corruption-free under Playwright parallel workers
- [ ] **Phase 4: Offline Verification & Publish** - Network-blocked offline proof, dual ESM/CJS packaging, compatibility matrix, first npm release

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
- [x] 01-01-PLAN.md — Package skeleton (dual ESM/CJS, peer dep), test-first config (CFG-01), framework configs + offline HTML fixture
- [x] 01-02-PLAN.md — Pure Playwright-free scorer + heal-decision with conservative floor (TDD, MATCH-01 core, false-green guard)
- [x] 01-03-PLAN.md — Throwaway rebind spike: catch TimeoutError + replay, chained-Proxy, bounded timeout budget (de-risk)
- [x] 01-04-PLAN.md — Live heal loop: in-process store, fingerprint capture, candidate-finder, locator Proxy + page fixture (CAP-01, HEAL-01/02, INST-02)
- [x] 01-05-PLAN.md — Summary-only boxed reporter (REP-01) + public import-swap entry + install/report proof (INST-01/02)

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
- [x] 02-01-PLAN.md — Pure core + config: margin gate in decide(), bestScore on no-heal, weight ordering invariant, margin config key (TDD; MATCH-02, MATCH-03, CFG-02)
- [x] 02-02-PLAN.md — Refused-heal slice: SelfmendEvent tagged union, proxy attach-then-rethrow, reporter could-not-heal section, ambiguous-duplicate Playwright proof (MATCH-04, REP-02)

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
- [x] 03-01-PLAN.md — Pure store layer (TDD): versioned zod schema, deterministic serializer, merge+refresh+prune; Playwright/fs-free (CAP-02, CAP-03)
- [x] 03-02-PLAN.md — fs persistence adapter (Windows-safe atomic write, parallelIndex shards) + occurrence-based identity key swap across proxy/store/fixture (CAP-02, CAP-03)
- [ ] 03-03-PLAN.md — Worker shard flush + Reporter onBegin/onEnd merge+gated-prune + .gitignore reconcile + CAP-02/CAP-03/D-09 integration specs (CAP-02, CAP-03)

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
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Thinnest Real Heal | 5/5 | Complete | 2026-05-31 |
| 2. Trust Hardening | 2/2 | Complete   | 2026-05-31 |
| 3. Persistence & Parallel-Worker Safety | 2/3 | In Progress|  |
| 4. Offline Verification & Publish | 0/TBD | Not started | - |
