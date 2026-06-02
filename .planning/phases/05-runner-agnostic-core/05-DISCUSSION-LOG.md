# Phase 5: Runner-Agnostic Core - Discussion Log

> **Audit trail only.** Decisions are captured in CONTEXT.md; this log preserves the alternatives considered.

**Date:** 2026-06-01
**Phase:** 5-Runner-Agnostic Core
**Areas discussed:** scope() shape + no-scope default, Retry / new-attempt handling, onHeal semantics, wrapPage return shape

---

## No-scope default

| Option | Description | Selected |
|--------|-------------|----------|
| Heal with a coarse key | suite="" test="", works out of box, more refusals | ✓ |
| Require scope, refuse without it | safest but breaks zero-config first impression | |
| Single-id scope allowed | flexible but weaker (two keys prevent collisions) | |

**User's choice:** Coarse key default. scope() shape is `() => { suite, test }` read live per locator. Never URL/path. Docs recommend scope() for real suites.

---

## Retry / new-attempt handling (WRAP-03)

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-reset on change + optional explicit reset | zero-config for between-tests; explicit reset for same-scope retries | ✓ |
| Auto-detect only | zero wiring, retries on reused page can drift (fail-safe) | |
| Explicit reset only | always exact, but required wiring | |

**User's choice:** Auto-reset when scope() tuple changes, plus an optional explicit `resetScope(page)` for same-scope retries.

---

## onHeal semantics

| Option | Description | Selected |
|--------|-------------|----------|
| Fire-and-forget, errors swallowed | never slows/breaks a test; best-effort like the reporter attach | ✓ |
| Awaited, errors swallowed | deterministic order, but a slow/hanging onHeal stalls the test | |
| Awaited, errors propagate | rejected: observability must never affect the run | |

**User's choice:** Fire-and-forget, errors swallowed. Receives both healed and could-not-heal events.

---

## wrapPage return shape

| Option | Description | Selected |
|--------|-------------|----------|
| Bare Page + optional reset export | fully drop-in (this.page = wrapPage(...)); resetScope(page) sibling | ✓ |
| Handle { page, resetScope } | more discoverable, but .page destructuring needed | |

**User's choice:** Bare Page return; `resetScope(page)` as a separate export (WeakMap-backed).

---

## Claude's Discretion

- HealContext restructure (drop testInfo/testFile/testTitle, add emit + scope source), WeakMap controller for resetScope, auto-reset detection, config merge, replayTimeoutMs default. Keep pure core untouched; TDD.

## Deferred Ideas

- Standalone load/save/merge + renderHealSummary + onHeal persistence wiring: Phase 6.
- Recipes/docs: Phase 7.
- BrowserContext-level wrapping: out of scope this milestone.
- Single-string scope convenience: rejected for now.
