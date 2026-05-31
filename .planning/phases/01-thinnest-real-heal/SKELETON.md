# Walking Skeleton — selfmend (Playwright self-healing locator plugin)

**Phase:** 1
**Generated:** 2026-05-31

> This project is an npm LIBRARY (a Playwright fixture+reporter plugin), not a web app. The generic web "routing + DB + UI + deploy" skeleton does not apply. The Walking Skeleton here is the thinnest possible REAL end-to-end heal, proven by a Playwright integration test running offline against a tiny local static HTML fixture. That integration test IS the skeleton's proof of life.

## Capability Proven End-to-End

A developer can swap `import { test } from '@playwright/test'` for `import { test } from 'selfmend'`, run a passing test (the plugin fingerprints the resolved element), then run the same test against a page whose selector has changed, and the plugin rebinds the broken locator live after the real timeout so the test stays green, printing a boxed console summary of the heal, fully offline.

## Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Language | TypeScript `^6` (npm latest 6.0.3), `strict: true`, `module: nodenext` | Mandated by CLAUDE.md; strict types are the selling point of a locator API. Resolves research version drift (A3). |
| Host framework | `@playwright/test` `>=1.42` peerDependency (tested `^1.60`) | Plugin uses the consumer's Playwright; never bundles its own. Floor 1.42; ariaSnapshot signals gated behind `>=1.49`. |
| Bundler / packaging | tsdown `^0.22`, dual ESM+CJS + `.d.ts`, `exports` map (types first) | Rolldown-powered 2026 successor to unmaintained tsup; emits correct extensions for dual consumers. |
| Runtime deps | `zod ^4` (config validation), `picocolors ^1` (boxed summary) | Minimal, zero-network deps; the offline guarantee is a hard constraint and a security property. |
| Integration seam | `test.extend` override of the `page` fixture → `Proxy(page)` → `Proxy(Locator)` | The only public surface with live in-worker DOM access for capture + live rebind. Monkey-patching playwright-core is rejected (D-05). |
| Failure detection | Catch the real `errors.TimeoutError` after auto-wait; never pre-check `count()` | Guarantees HEAL-02 (heal only after real timeout, never on a transient poll miss) by construction. The prior-art `playwright-selfheal@1.0.9`'s pre-check is the documented anti-pattern. |
| Rebind mechanism | Build a fresh uniquely-resolving selector string → `page.locator(newSelector)` → replay | An `ElementHandle` cannot be turned into a `Locator` (PW issue #10571). Candidate enumeration emits a unique selector. |
| Heal decision core | Pure, Playwright-free `score()` + `decide()` modules, built test-first | The core IP and the false-green guarantee; deterministic, offline, unit-testable in isolation. |
| Baseline store (Phase 1) | In-process `Map` keyed by locator identity, single worker | Phase 1 proves the loop. Cross-run persistence + parallel-worker safety are Phase 3 (CAP-02/CAP-03), deliberately deferred. |
| Worker→main transport | `testInfo.attach('selfmend-heal', …)` | Custom IPC is unavailable (PW issue #31559); attach is the sanctioned channel. |
| Reporting | `@playwright/test/reporter`, summary-only boxed picocolors block | Reporter is post-hoc and has no DOM; it reports, it never heals (D-05/D-06). |
| Directory layout | `src/{config,matching,store,fingerprint,rebind,integration,reporter}` + `tests/` + throwaway `spike/` | Mirrors the research's dependency-ordered build; pure logic isolated from Playwright-touching code. |
| Validation | Vitest (pure logic) + `@playwright/test` runner (integration) against a local HTML fixture | Deterministic logic unit-tested; the live heal proven by real Playwright runs, offline. |

## Stack Touched in Phase 1 (library-adapted)

- [x] Project scaffold — TypeScript + tsdown dual build, Vitest, Playwright runner, lint, `exports` map, peerDependency (plan 01).
- [x] "Routing" equivalent — the public entry `selfmend` re-exports a healing-extended `test` + composable `healingFixture` (plans 04, 05).
- [x] "DB read/write" equivalent — fingerprint CAPTURE (write) on a passing run and candidate-match READ on failure against the in-process baseline store (plan 04).
- [x] "UI interaction" equivalent — a real Playwright integration test exercises capture → broken-selector → live rebind → green, plus the boxed console summary (plans 04, 05).
- [x] "Deployment / full-stack run" equivalent — documented local run: `npx vitest run && npx playwright test` runs the full offline heal loop against the local fixture app (no network, no dev server).

## Out of Scope (Deferred to Later Slices)

- Hardened trust gates: absolute confidence-floor proof + second-best margin gate + no-force-green audit, configurable floor/margin → Phase 2 (MATCH-02/03/04, CFG-02, REP-02). Phase 1 ships a conservative single-floor default (~0.9) only.
- Cross-run persistence to a disk baseline store and parallel-worker corruption safety → Phase 3 (CAP-02, CAP-03). Phase 1 uses an in-process single-worker Map.
- Network-blocked offline verification, dual ESM/CJS publish validation (publint/attw), Playwright version matrix, npm publish → Phase 4 (PRIV-01).
- Multi-signal weighting depth, LLM tiebreaker, assertion-drift diagnosis, smart waits, PR/diff delivery → Phase 2+ / v2 (out of scope per REQUIREMENTS.md).
- `selectors.register()` custom selector engine → optional Phase 4 optimization, not a Phase 1 dependency.

## Subsequent Slice Plan

Each later phase adds one vertical slice on top of this skeleton without altering its architectural decisions (the seam, the pure-core split, the in-worker capture/rebind, the reporter contract):

- **Phase 2 — Trust Hardening:** multi-signal weighted scoring; absolute floor + second-best margin gate enforced in the pure `decide()`; report distinguishes healed vs failed-to-heal with runner-up margin; configurable floor/margin.
- **Phase 3 — Persistence & Parallel-Worker Safety:** swap the in-process store for a disk-persisted, per-worker-sharded baseline merged deterministically; concurrent-write safety; minimal-derived-signals-only persisted format.
- **Phase 4 — Offline Verification & Publish:** network-block proof, publint + attw dual-format validation, Playwright minor matrix, first MIT npm release with README.
