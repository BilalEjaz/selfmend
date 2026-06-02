# Playwright SelfHeal

> Working name. Final npm/package name to be decided during phase 1.

## What This Is

An open-source (MIT) Playwright plugin, distributed on npm, that makes end-to-end tests self-healing. On passing runs it fingerprints the elements each locator resolves to. When a locator later breaks, the plugin matches the broken locator to the right element using heuristic signal-matching (text, role, test-id, attributes, neighbours, DOM position), rebinds it live so the test stays green, and prints a clear console summary of every heal. It runs entirely inside the team's own CI, works fully offline, and requires no API key or vendor cloud. It is built for QA and engineering teams who are tired of locator churn breaking their suites, both the author's own team and any other organisation that adopts it.

## Core Value

When a test fails only because a selector changed (not because the app is actually broken), the suite keeps running and tells the team exactly what changed, without any data leaving their CI.

## Current Milestone: v0.2.0 Runner-Agnostic Healing

**Goal:** Let selfmend heal in any framework that drives a real Playwright `Page` (Cucumber, Mocha, Jest, plain scripts), not just `@playwright/test`, through one `wrapPage` call plus standalone baseline persistence and a heal callback. v1 (the `@playwright/test` plugin) shipped as selfmend@0.1.x; this milestone turns the existing engine into a runner-agnostic core with `@playwright/test` as one adapter over it.

**Target features:**
- `wrapPage(page, { store, config?, onHeal?, scope? })` runner-agnostic entry point: one call wraps a raw page, every locator on it heals.
- Dynamic `scope()` identity: two caller-provided ids read live at each locator creation, occurrence index resets per scope, retry-safe.
- `onHeal` callback receiving both healed and could-not-heal events (no Playwright reporter required).
- Standalone `loadBaseline(path)` / `saveBaseline(path, store)`: refresh-and-add only, never auto-prune.
- `mergeBaselines(...)` so parallel-worker runs combine per-worker baselines safely.
- `renderHealSummary(events)` so raw frameworks can print the same boxed report.
- Refactor the `@playwright/test` fixture into one adapter over the shared core, with zero behaviour change for existing users.
- Docs and recipes (Cucumber, Mocha/Jest, plain script).

**Hard constraints carried in:** never-false-green is invariant across every adapter (it lives in the pure core); Page-level only this milestone (BrowserContext-level is a later add); the persisted key stores literal `suite`/`test` strings for reviewable diffs; only frameworks that expose a real Playwright `Page` are in scope (not Cypress or Selenium).

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

<!-- Validated in Phase 1 (Thinnest Real Heal), verified 2026-05-31. -->

- ✓ Plugin installs into an existing Playwright project as an npm package (`selfmend`) with minimal config, via import-swap — Phase 1
- ✓ On passing runs, the plugin captures an element fingerprint (text, role, test-id, attributes, neighbours, DOM position) for each resolved locator — Phase 1 (single-worker, in-process store; cross-run/parallel persistence is Phase 3)
- ✓ When a locator fails to resolve, the plugin scores candidate elements against the stored fingerprint and selects the best match above a conservative (~0.9) confidence threshold — Phase 1
- ✓ On a successful match, the plugin rebinds the locator live so the test continues and passes — Phase 1
- ✓ When no candidate clears the threshold, the plugin does not force a heal and the test fails normally (no false greens) — Phase 1 (verified by control test)
- ✓ At the end of a run, the plugin prints a boxed console summary of each heal (original selector, healed target, confidence) — Phase 1
- ✓ Healing can be toggled on/off via plugin config — Phase 1
- ✓ Hardened trust gates: configurable confidence floor + absolute-gap second-best margin gate (default 0.05); ambiguous look-alikes are refused, not healed — Phase 2
- ✓ No-force-green proven: empty / below-floor / ambiguous all fail normally; refused heals are reported but never suppress the failure — Phase 2
- ✓ Report distinguishes healed from could-not-heal (locator, reason, best score), configurable floor + margin — Phase 2

- ✓ Cross-run persistence: a committed, versioned, deterministically-serialized `.selfmend/baseline.json` (derived signals only) survives across runs; heals on run N+1 from the committed file alone — Phase 3
- ✓ Parallel-worker safety: lock-free per-worker shards (`parallelIndex`) merged in the Reporter at end-of-run with Windows-safe atomic write; no corruption/lost writes under `workers>1` — Phase 3
- ✓ Cross-run-stable identity key (testFile + titlePath + selector + occurrence), replacing the fragile run-order step counter; refresh-on-pass + opt-in (`SELFMEND_PRUNE`) complete-run-only prune — Phase 3

- ✓ Entire healing path proven fully offline by a self-validating network-block test (asserts every patched egress surface trips, then zero egress through a real heal); offline-by-construction (no network/AI/telemetry deps) — Phase 4
- ✓ Publish-ready 0.1.0: dual ESM/CJS validated (publint + attw), matrix CI (node 22/24 x Playwright 1.42/1.60), launch README, `npm publish --dry-run` green — Phase 4 (real publish is the maintainer's manual step per RELEASING.md)

### Active

<!-- Current scope. Building toward these. v1 = locator healing only. -->

(All v1 requirements validated. v1 milestone complete. Remaining: human pushes to GitHub to run the CI matrix, then runs the real `npm publish` per RELEASING.md.)

### Out of Scope

<!-- Explicit boundaries with reasoning. -->

- Cypress, Selenium, and other frameworks (v1 is Playwright-only, to ship a sharp tool before expanding)
- Assertion-drift diagnosis / healing (deferred to v2, high complexity and high risk of hiding real bugs; must be propose-not-apply when built)
- Smart-wait / flakiness healing (deferred to v2)
- LLM-assisted candidate ranking as a low-confidence tiebreaker (deferred to v2, keeps v1 fully offline and key-free)
- PR / diff delivery of permanent fixes (deferred to v2)
- JSON / HTML report files and a committed original-to-healed selector store (deferred to v2; v1 surfaces results via console only)
- Auto-editing test source files (the product proposes, it never silently rewrites tests)
- Any hosted dashboard, account system, or vendor cloud (a paid open-core layer may come much later, never in v1)

## Context

- Self-healing test automation is a crowded space: Healenium (open source, Selenium, locator-only, no modern matching), and closed clouds like Testim, Mabl, Functionize, testRigor. The differentiated lane this project targets is: open-source, transparent, framework-native to Playwright, fully offline, and "propose, do not silently apply" so teams never get a falsely green suite.
- Playwright already reduces locator breakage with role/text locators and auto-waiting, so the plugin must add value on top of good Playwright practice, not paper over bad practice.
- The dangerous failure mode in this category is healing that hides real bugs (silently rewriting assertions or forcing greens). The design deliberately confines v1 to locator rebinding with a confidence floor and full reporting.
- Intended distribution: public GitHub repo, MIT licence, published to npm. Adoption wedge is zero-friction install and no data leaving CI.

## Constraints

- **Tech stack**: TypeScript, packaged as a Playwright plugin / fixture+reporter, published to npm. Playwright is the only supported framework in v1.
- **Privacy**: Must run fully offline in v1. No telemetry, no network calls, no API keys, nothing leaves the user's CI. This is a hard adoption requirement, not a preference.
- **Trust**: Never produce a falsely green test. A heal only happens above an explicit confidence threshold; otherwise the test fails normally.
- **Compatibility**: Must drop into an existing Playwright project without forcing teams to rewrite their tests.
- **Licence**: MIT, open source.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Playwright-only for v1 | Ship a sharp, framework-native tool before spreading across frameworks with incompatible locator models | Pending |
| Live heal at runtime, keep tests green, report afterwards | Saves the run and gives the team the diagnosis, without the "red CI on every drift" cost of post-run-only | Pending |
| Locator healing only in v1 | Locator rebinding is the safe, high-value category; assertion/code healing risks hiding real bugs and is deferred | Pending |
| Heuristic signal-matching first, LLM optional later | Keeps v1 fully offline and free, removes the biggest adoption blocker (sending DOM to a vendor) | Pending |
| Console summary as the only v1 output | Smallest surface that delivers the value; report files, PR delivery, persisted heal store deferred to v2 | Pending |
| Confidence floor with no forced heal | Prevents falsely green suites, which is the trust-killing failure mode of this product category | Pending |
| Open source, MIT, BYO nothing | Differentiates from closed vendor clouds; trust and zero-friction adoption are the wedge | Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? Move to Out of Scope with reason
2. Requirements validated? Move to Validated with phase reference
3. New requirements emerged? Add to Active
4. Decisions to log? Add to Key Decisions
5. "What This Is" still accurate? Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check, still the right priority?
3. Audit Out of Scope, reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-31 after Phase 4 (Offline Verification & Publish) completion — v1 MILESTONE COMPLETE. All 16 v1 requirements validated across 4 phases. selfmend@0.1.0 is publish-ready (npm publish --dry-run green, publint + attw clean, dist-only tarball); 125 unit + 23 integration tests green; 4 code reviews clean. Remaining human steps (tracked in 04-HUMAN-UAT.md): push to GitHub to run the CI matrix (proves the >=1.42 floor), then run the real `npm publish` per RELEASING.md.*
