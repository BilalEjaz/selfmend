# Phase 4: Offline Verification & Publish - Context

**Gathered:** 2026-05-31
**Status:** Ready for planning

<domain>
## Phase Boundary

The final phase: prove the healing path is genuinely offline (PRIV-01), lock the dual ESM/CJS + Playwright-version compatibility matrix, write the launch docs, wire CI, and prepare the first npm release of `selfmend` to a publish-ready, dry-run-verified state. The actual `npm publish` is performed by the human (irreversible, needs their npm auth) — this phase stops just short of it.

In scope: PRIV-01 (entire healing path runs fully offline, verified by a network-blocked test). Plus the roadmap's publish goal: dual ESM/CJS packaging validated, Playwright-version compatibility matrix, README/docs for launch, CI, version 0.1.0 + CHANGELOG, and the prerequisite package-lock regeneration. `npm publish --dry-run` (+ publint + attw + npm pack) is the terminal proof; the real publish is a documented human step.

Not in scope: the actual irreversible `npm publish`; a docs site; automated/CI-driven publishing (manual release for v1); any v2 feature (assertion healing, smart waits, LLM tiebreaker, PR delivery, etc., all out of scope per REQUIREMENTS.md).
</domain>

<decisions>
## Implementation Decisions

### Publish posture & version
- **D-01:** Prepare-and-stop, do NOT run the real `npm publish`. Build the package to a fully publish-ready state and verify with `npm publish --dry-run` + `npm pack` + publint + attw. The final `npm publish` is a documented manual step the human runs with their own npm account/auth (it is irreversible).
- **D-02:** First version is `0.1.0` (pre-1.0, signals early/iterating; breaking changes allowed pre-1.0 per semver). Set in package.json (currently 0.0.0); add a CHANGELOG entry for 0.1.0.

### Offline proof (PRIV-01)
- **D-03:** PRIV-01 is proven by an in-process RUNTIME network-block test: override Node's `net`/`http`/`https`/`dns` (and global `fetch`) to THROW on any use, then run a full capture + heal + merge cycle and assert it completes with ZERO attempted connections. Portable (runs on the author's Windows machine and any CI), deterministic, no special infra. This is the canonical PRIV-01 proof.
- **D-04:** No network-disabled CI container is required for v1 (the runtime block test is the guarantee). Offline-by-construction already holds: zero network/AI/telemetry runtime dependencies (only zod + picocolors).

### CI / release automation
- **D-05:** Full CI via GitHub Actions on every push/PR: lint + unit (vitest) + integration (playwright) + the offline network-block test + `npm pack` + publint + attw, across a Playwright-version MATRIX (the declared floor `>=1.42` and latest `1.60`). This is the regression net + the compatibility proof.
- **D-06:** Release stays MANUAL for v1 (human runs `npm publish`). No Changesets-driven auto-publish, no NPM_TOKEN in CI yet — do not hand CI publish rights at this stage. (Changesets/auto-release is a later-maybe, not v1.)

### Docs (launch README)
- **D-07:** The shipped README covers: install + import-swap quickstart; a config reference (`enabled`, `threshold`, `margin`, `testIdAttr`, and the `SELFMEND_PRUNE` env opt-in); a short "how healing works + the never-false-green trust model" section; the committed-baseline workflow (what `.selfmend/baseline.json` is, that it is committed, that shards are ignored); and an honest Limitations section (locator-only, Playwright-only v1; accepted limitations WR-03 occurrence-index-on-chained-calls and WR-04 selectOption/setInputFiles replay). No docs site for v1.

### Prerequisite (required task, not a gray area)
- **D-08:** Regenerate `package-lock.json` via a clean `npm install` BEFORE the pack/publish prep. In Phase 3, `npm install` crashed with an internal resolver bug and `@types/node@24.10.1` was hand-installed (SHA-verified against the registry) without updating the lockfile. The lockfile must be materialized and committed so the published package and CI install cleanly and reproducibly. If the resolver bug recurs, diagnose it (it is a blocker for a clean publish), do not paper over it.

### Claude's Discretion
- Exact network-block test implementation (which modules to stub, how to assert zero-egress), the GitHub Actions workflow YAML shape and matrix syntax, CHANGELOG format (keep-a-changelog vs simple), the precise README structure/wording, and whether to add a `.gitattributes` / pre-commit guard against NUL bytes (recommended given two stray-NUL incidents in Phase 3). Keep the package lean (files:[dist]); do not add runtime deps.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project-level
- `.planning/PROJECT.md` : offline hard constraint, MIT, never-false-green, validated capabilities (Phases 1-3 all done).
- `.planning/REQUIREMENTS.md` : Phase 4 owns PRIV-01 (the last open v1 requirement). All others Complete.
- `.planning/ROADMAP.md` : Phase 4 goal (network-blocked offline proof, dual ESM/CJS, compatibility matrix, first npm release).

### The publish surface (read before changing)
- `package.json` : name `selfmend`, MIT, not private, `type:module`, dual `exports` (`.` + `./reporter`), `files:[dist]`, `engines.node>=22`, peer `@playwright/test>=1.42`, deps zod+picocolors, version 0.0.0 -> 0.1.0. Scripts: build/test/test:e2e/typecheck/lint:pack/lint:types.
- `README.md` : the Phase 1 quickstart README to expand per D-07.
- `tsdown.config.ts`, `tsconfig.json`, `playwright.config.ts`, `playwright.parallel.config.ts` : build + test config.

### Research
- `.planning/research/STACK.md` : "Publishing, Versioning, Configuration" + Development Tools (publint, attw, Knip, Changesets, GitHub Actions matrix) — the basis for D-05; dual ESM/CJS via `exports` types-first; treat store-format + config as the public semver contract.
- `.planning/research/PITFALLS.md` : distribution/ESM-CJS/peer-dep/semver pitfalls.

### Carry-forward from Phase 3
- `.planning/phases/03-persistence-parallel-worker-safety/03-02-SUMMARY.md` : the @types/node hand-install + stale package-lock follow-up (D-08).
- `.planning/phases/03-persistence-parallel-worker-safety/03-REVIEW.md` : accepted limitations WR-03/WR-04 to document in the README (D-07).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- package.json `exports` + `files:[dist]` + tsdown build already produce dual ESM/CJS with types-first conditions (publint/attw were green in Phase 1). Phase 4 validates them across the PW-version matrix and at pack time, and bumps the version.
- Existing local scripts: `lint:pack` (publint), `lint:types` (attw), `test`, `test:e2e`, `typecheck`, `build` — CI composes these.
- README.md exists (Phase 1) — expand, do not rewrite from scratch.

### Established Patterns
- TDD for logic (the offline network-block test is a real test, written test-first where it asserts behavior).
- No new runtime deps (offline guarantee). CI/dev tooling deps are fine.
- Pure matching core stays untouched; this phase is packaging/docs/CI/proof, not feature work.

### Integration Points
- The offline test exercises the real capture -> score -> decide -> rebind -> merge path with network stubbed (touches the integration + store layers, not new code).
- CI runs the existing vitest + playwright suites + pack/publint/attw across the matrix.

</code_context>

<specifics>
## Specific Ideas

- Terminal proof = `npm publish --dry-run` green (+ pack/publint/attw), NOT a real publish.
- Version 0.1.0; CHANGELOG entry.
- Runtime offline test: stub net/http/https/dns/fetch to throw, run capture+heal+merge, assert zero egress.
- CI matrix: @playwright/test floor (>=1.42) and 1.60.
- README: quickstart + config ref + trust model + committed-baseline workflow + honest limitations.
- Consider a `.gitattributes`/pre-commit NUL-byte guard (two stray-NUL incidents in Phase 3).

</specifics>

<deferred>
## Deferred Ideas

- The actual `npm publish` (human runs it after this phase; documented step).
- Changesets / automated CI publish with NPM_TOKEN (later-maybe, not v1).
- Network-disabled CI container (the runtime block test suffices for v1).
- Docs site / extended guides / contributing guide.
- Dedicated fixes for WR-03 (occurrence-index on chained calls) and WR-04 (selectOption/setInputFiles replay) — documented as limitations now; fix if they bite in real use.

</deferred>

---

*Phase: 4-Offline Verification & Publish*
*Context gathered: 2026-05-31*
