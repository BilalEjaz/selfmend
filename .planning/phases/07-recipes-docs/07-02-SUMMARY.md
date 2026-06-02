---
phase: 07-recipes-docs
plan: 02
subsystem: docs
tags: [readme, recipes, changelog, byte-sync, never-false-green, honest-limits, runner-agnostic]
requires:
  - "07-01: examples/{plain-script,cucumber,mocha-jest}.ts compilable recipes (the byte-for-byte source of truth) + check:examples"
  - "Phase 5 wrapPage(page, { store, config?, onHeal?, scope? }) + resetScope + the raw-mode never-false-green control proof"
  - "Phase 6 loadBaseline/saveBaseline/mergeBaselines + renderHealSummary public exports"
provides:
  - "README runner-agnostic recipe section (Plain script, Cucumber, Mocha / Jest) embedding examples/*.ts byte-for-byte"
  - "README raw-mode never-false-green guarantee (3 named claims) + Honest limits section"
  - "scripts/check-readme-examples.mjs: a byte-sync gate binding each README recipe block to its examples/ source, wired into verify after check:examples"
  - "CHANGELOG public [0.2.0] - 2026-06-02 entry (version bump left to the maintainer)"
  - "DOC-01 closed; the v0.2.0 milestone documentation work is complete"
affects:
  - "package.json scripts block (check:readme added; verify chain extended)"
  - "README.md (Roadmap placeholder removed, replaced by the shipped recipes)"
  - "CHANGELOG.md ([Unreleased] converted to [0.2.0])"
tech-stack:
  added: []
  patterns:
    - "Docs-as-spec last mile: README recipe blocks are byte-checked against the compilable examples/ files, so documented code cannot drift from machine-checked source"
    - "Empty [Unreleased] placeholder kept above the cut [0.2.0] entry, Keep a Changelog convention preserved"
key-files:
  created:
    - scripts/check-readme-examples.mjs
  modified:
    - README.md
    - CHANGELOG.md
    - package.json
decisions:
  - "package.json version is intentionally NOT bumped (still 0.1.2). The CHANGELOG now describes a public 0.2.0, but the maintainer bumps the version and tags the release manually per RELEASING.md; this plan ships docs only."
  - "Removed the old forward-looking '## Roadmap' README block entirely, since the runner-agnostic future it described is now the shipped 'Using selfmend without @playwright/test' section. The Roadmap was a placeholder for exactly this work."
  - "The check:readme parser keys off the exact recipe heading then the next ```ts fence, and compares after trimming a single trailing newline (the example file ends with one, the fenced block does not). Node builtins only (node:fs, node:path, node:url), no new dependency."
  - "Honest limits sourced verbatim-in-spirit from REQUIREMENTS Out-of-Scope (Cypress/Selenium incompatible locator models; BrowserContext-level is a later add) plus the two carried v1 caveats by reference, no new limits invented."
metrics:
  tasks: 3
  files: 4
  commits: 4
  completed: 2026-06-02
---

# Phase 7 Plan 02: README Recipes + Trust Docs Summary

The README now documents `wrapPage` with three named, runner-agnostic recipes (Plain script, Cucumber, Mocha / Jest) embedded byte-for-byte from the compilable `examples/*.ts` files, plus a raw-mode never-false-green guarantee and an honest-limits section, all bound to the example source by a new `check:readme` byte-sync gate in the verify chain, with a public CHANGELOG `0.2.0` entry; this closes DOC-01 and completes the v0.2.0 documentation milestone. Shipped runtime `src/` is untouched and `package.json` stays at `0.1.2` (the maintainer bumps and tags at release).

## What Was Built

- **Task 1 (README recipes + trust/limits)**: Added a top-level `## Using selfmend without @playwright/test` section after "Composing with your own fixtures", with an opening that explains `wrapPage` returns a drop-in wrapped page, identity comes from a live `scope()` callback, the adopter loads/saves the baseline, and heals are collected via `onHeal` then printed with `renderHealSummary` (no reporter). Three subsections with exact headings `### Plain script`, `### Cucumber`, `### Mocha / Jest`, each a single `ts` fenced block byte-identical to the corresponding `examples/` file, each followed by a sentence naming the three pieces (scope wiring, baseline load/save, heal output). Then `### The never-false-green guarantee in raw mode` (the three named claims: floor AND margin in the pure `decide()` core identical across modes; a wrong/missing `scope()` key is a missed heal never a wrong heal, control-tested; a throwing/absent `scope()`/`onHeal` fails safe) and `### Honest limits` (Page-level only / popups need own wrap; Playwright Pages only / Cypress and Selenium out of scope; parallel via `mergeBaselines`; the v1 occurrence-index and `selectOption`/`setInputFiles` caveats by reference linking to the existing Limitations section). The old forward-looking `## Roadmap` block was removed (now shipped). All v1 sections (Install, import swap, reporter, Configuration, How healing works, baseline workflow, Privacy & trust, Limitations, License) are intact.
- **Task 2 (byte-sync gate)**: Created `scripts/check-readme-examples.mjs` (Node builtins only) that, for each recipe heading, extracts the next `ts` fenced block and asserts byte-equality with its `examples/` source (after trimming one trailing newline), printing the recipe and first differing index on drift and exiting 1. Wired `"check:readme"` into `package.json` scripts and into the `verify` chain immediately after `check:examples`. No new dependency.
- **Task 3 (CHANGELOG 0.2.0)**: Converted the `## [Unreleased]` block into a real `## [0.2.0] - 2026-06-02` Keep-a-Changelog entry. `### Added` names `wrapPage`, the `scope()` callback, `resetScope`, standalone `loadBaseline`/`saveBaseline` (refresh-and-add only), `mergeBaselines`, `onHeal`, `renderHealSummary`, and the README recipes. `### Changed` records the fixture-onto-core refactor with zero behaviour change. A "Scope and guarantees" subsection states the honest scope (Playwright Pages only, Page-level only, never-false-green unchanged). Added the `[0.2.0]` link reference and left an empty `[Unreleased]` placeholder above it.

## Version NOT Bumped (intentional, per plan)

`package.json` `"version"` is still `0.1.2`. The CHANGELOG now describes a public `0.2.0`, but per `RELEASING.md` the maintainer bumps the version and tags the release manually at publish time. This plan is docs-only and does not touch the version field. This is the one thing to remember at release: bump to `0.2.0` and tag `v0.2.0`.

## How It Works

The three example files are the single source of truth (07-01 type-checks them against the published API via `check:examples`). The README embeds them verbatim, and `check:readme` proves byte-equality between each fenced block and its file, so a docs edit that diverges from the runnable code fails the gate locally and in CI. The two gates run back-to-back in `verify` (`... && check:examples && check:readme && test`), so the documented recipes are both provably compilable (07-01) and provably what the README shows (07-02).

## Deviations from Plan

None. The plan executed exactly as written. REQUIREMENTS.md already had DOC-01 marked Complete from the roadmap mapping pass, so the requirements update was a no-op (the checkbox and traceability row were already in the completed state); no regression was introduced.

## Verification

- Task 1 verify (README headings + symbols present, no U+2014): exit 0.
- Task 2 verify (`npm run check:readme`): exit 0; tamper test (one-char drift in a block) makes the gate exit 1 with a first-difference message, then reverted, sync is actually enforced.
- Task 3 verify (`[0.2.0]` entry present, mentions `wrapPage`, no U+2014): exit 0; `package.json` version confirmed still `0.1.2`.
- `npm run verify`: exit 0 (build + lint:pack + lint:types + typecheck + check:examples + check:readme + 163 unit tests, all green). The `MIXED_EXPORTS` build line is a pre-existing informational warning, not a failure.
- `npx playwright test`: 29 passed (e2e green, boxed reporter output unchanged).
- `git diff --stat HEAD~3 HEAD -- src/`: empty (runtime `src/` untouched). Changed files across the three task commits: `README.md`, `CHANGELOG.md`, `package.json`, `scripts/check-readme-examples.mjs`.
- No new entry in `dependencies` or `devDependencies`.
- Em-dash gate: README, CHANGELOG, and the new script all free of U+2014.

## Task Commits

1. **Task 1: README recipes + raw-mode trust/limits**, `0149317` (docs)
2. **Task 2: check:readme byte-sync gate**, `650d6c0` (chore)
3. **Task 3: CHANGELOG 0.2.0 entry**, `122e841` (docs)

## Product Gap Flagged by the Limits Wording

None new. Writing the honest limits surfaced no undocumented gap: every limit traces to the REQUIREMENTS Out-of-Scope table (Cypress/Selenium incompatible locator models, BrowserContext-level deferred) or to a carried v1 caveat. The one already-tracked deferral worth keeping visible is BrowserContext-level (whole-context auto-wrap), which remains a clean later-milestone add and is stated as such in both the README and the CHANGELOG.

## Self-Check: PASSED

- FOUND: scripts/check-readme-examples.mjs
- FOUND: README.md (Using selfmend without @playwright/test + the three recipes + never-false-green + Honest limits)
- FOUND: CHANGELOG.md ([0.2.0] - 2026-06-02 entry + [0.2.0] link reference)
- FOUND: package.json (check:readme script + verify chain; version still 0.1.2)
- FOUND commit 0149317 (Task 1), 650d6c0 (Task 2), 122e841 (Task 3)
