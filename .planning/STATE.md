---
gsd_state_version: 1.0
milestone: v0.2
milestone_name: Runner-Agnostic Healing
status: planning
last_updated: "2026-06-02T10:17:21.936Z"
last_activity: 2026-06-02
progress:
  total_phases: 3
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-31)

**Core value:** When a test fails only because a selector changed (not because the app is actually broken), the suite keeps running and tells the team exactly what changed, without any data leaving their CI.
**Current focus:** v0.2.0 Runner-Agnostic Healing — roadmap created (Phases 5-7); next step is `/gsd:plan-phase 5`.

## Current Position

Phase: 5 — Runner-Agnostic Core (not started)
Plan: —
Status: Roadmap created, awaiting phase planning
Last activity: 2026-06-02 — v0.2.0 roadmap created: 3 phases (5 Runner-Agnostic Core, 6 Standalone Persistence & Output, 7 Recipes & Docs), 10 requirements mapped 100%

## Performance Metrics

**Velocity:**

- Total plans completed: 13
- Average duration: - min
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 5 | - | - |
| 02 | 2 | - | - |
| 03 | 3 | - | - |
| 04 | 3 | - | - |

**Recent Trend:**

- Last 5 plans: -
- Trend: -

*Updated after each plan completion*
| Phase 01 P01 | 3 | 2 tasks | 12 files |
| Phase 01 P02 | 4 | 3 tasks | 5 files |
| Phase 01 P03 | 7 | 2 tasks | 3 files |
| Phase 01 P04 | 7 | 3 tasks | 10 files |
| Phase 01 P05 | 3 | 3 tasks | 8 files |
| Phase 02 P01 | 5 | 3 tasks | 8 files |
| Phase 02 P02 | 6 min | 4 tasks | 8 files |
| Phase 03 P01 | 9 | 3 tasks | 6 files |
| Phase 03 P02 | 20 | 2 tasks | 8 files |
| Phase 03 P03 | 33 | 4 tasks | 14 files |
| Phase 04 P01 | 9 | 3 tasks | 4 files |
| Phase 04 P02 | 11 | 3 tasks | 5 files |
| Phase 04 P03 | 41 | 2 tasks | 4 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap v0.2]: Coarse granularity → 3 phases. Build order is core seam → standalone exports → docs, because the shipped fixture already contains an internal `wrapPage` + `wrapLocator` proxy + per-test occurrence counter + `HealContext`; v0.2 generalizes that seam rather than rewriting it.
- [Roadmap v0.2]: WRAP-04 (refactor the @playwright/test fixture onto the shared core) is grouped INTO Phase 5 with the core seam, because the refactor IS the proof the new seam is correct; its success criterion is the existing 125 unit + 23 e2e tests still passing with zero behaviour change.
- [Roadmap v0.2]: The cross-cutting never-false-green-in-raw-mode rule (a wrong/missing identity key is a missed heal, never a wrong heal) is owned by Phase 5 (which owns wrapPage/identity) as an explicit, control-tested success criterion; it lives in the pure core so every adapter inherits it.
- [Roadmap v0.2]: Persistence + output building blocks (loadBaseline/saveBaseline/mergeBaselines, onHeal, renderHealSummary) cluster in Phase 6 — they are the standalone re-exposure of the existing persistence.ts + reporter rendering, decoupled from the Playwright reporter/shard machinery.
- [Roadmap]: MVP vertical-slice mode — Phase 1 ships the thinnest REAL end-to-end heal on a single-worker simple case; later phases deepen signals/gates, add parallel safety, then publish.
- [Roadmap]: Scoring and heal-decision logic stays pure (Playwright-free) and is built test-first; the false-green guarantee (confidence floor + second-best margin + no-force-heal) is enforced in code as explicit success criteria.
- [Phase 4]: blocking phase gate APPROVED by orchestrator 2026-05-31 — independently verified 125 unit + 23 e2e green, publint/attw clean, pack=14 dist-only files, publish --dry-run=selfmend@0.1.0 (nothing published), CI holds no NPM_TOKEN; v1.0 milestone CLOSED

### Pending Todos

None yet.

### Blockers/Concerns

None. The runner-agnostic seam already exists internally (fixture.ts `wrapPage`, locator-proxy.ts `HealContext`/`wrapLocator`/`createOccurrenceCounter`, persistence.ts `loadBaseline`); Phase 5 lifts it to public, so the riskiest item is the WRAP-04 zero-behaviour-change refactor, gated by the existing test suite.

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| Scope | BrowserContext-level wrapping (auto-wrap every page) | Deferred to a later milestone | v0.2 planning |
| Limitation | WR-03 occurrence index can shift on chained-locator calls between runs (fail-safe = missed heal) | Carried, fail-safe | v1 close |
| Limitation | WR-04 withTimeout vs selectOption/setInputFiles value objects | Carried, fail-safe | v1 close |

## Session Continuity

Last session: 2026-06-02T10:17:21.936Z
Stopped at: v0.2.0 roadmap created (Phases 5-7); next step is `/gsd:plan-phase 5`
Resume file: None
