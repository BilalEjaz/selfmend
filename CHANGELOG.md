# Changelog

All notable changes to **selfmend** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Pre-1.0 notice:** While the version is below `1.0.0`, the public contract
> (the configuration schema and the committed baseline store format) may change
> in a breaking way between minor releases (per SemVer, anything is allowed
> pre-1.0). Such changes will always be called out in this changelog.

## [Unreleased]

Nothing yet.

## [0.2.3] - 2026-06-03

### Added

- A simple landing page (docs/index.html, served via GitHub Pages) that explains
  what selfmend does, how to add it, and what to expect. The npm package homepage
  now points to it instead of the GitHub readme.

### Fixed

- In the end-of-run "could not heal" summary, a refusal with no scored candidate
  showed its missing best-score as an em dash. It now shows "n/a", so the report
  output contains no em dash. Output only, no behaviour change.

## [0.2.2] - 2026-06-02

### Fixed

- **`wrapPage`: a locator action that triggers a client-side navigation no longer
  hangs.** The success-path fingerprint capture used to run inline and unbounded,
  so after a navigating action (for example a link or submit `click`) the capture
  waited the full default timeout on the now-detached element before giving up,
  which stalled the caller's `await`. Capture is now fire-and-forget and bounded:
  a wrapped action resolves as soon as the real Playwright action resolves, and a
  detached or navigating element is skipped fast (a missed fingerprint is
  fail-safe, never a wrong heal). Baselines stay reliable because in-flight
  captures are flushed before `saveBaseline`, before the per-worker shard write,
  and before the heal path reads a fingerprint. Reported by an adopter using the
  raw `wrapPage` adapter; the `@playwright/test` fixture path shared the same
  latent issue. Covered by a new raw-mode navigating-action regression test.

## [0.2.1] - 2026-06-02

Metadata and CI only. No code or API changes: 0.2.1 is identical to 0.2.0 at
runtime.

### Changed

- npm package description and keywords now reflect that selfmend heals outside
  `@playwright/test` (Cucumber, Mocha, Jest, plain scripts), so the registry page
  matches what 0.2.0 actually shipped. The 0.2.0 metadata still described the
  v0.1.x `@playwright/test`-only scope.

### Fixed

- CI matrix no longer hangs. The `node 24` plus old-Playwright (`1.42` / `1.49`)
  cells were excluded as redundant (the `node 22` row already proves all three
  Playwright versions and `node 24 x 1.60` proves node 24), and a 20 minute
  per-job timeout was added so a stuck browser install fails fast instead of
  sitting until GitHub's 6 hour ceiling.

## [0.2.0] - 2026-06-02

selfmend now heals outside the `@playwright/test` runner. If your framework gives
you a real Playwright `Page`, you can wrap it and every locator on it heals, with
no test rewrites and no Playwright reporter.

### Added

- **`wrapPage(page, { store, config?, onHeal?, scope? })`** so any framework that
  drives a real Playwright `Page` can heal: Cucumber, Mocha, Jest, or a plain
  script. One call when you create the page, then every locator on it heals. Your
  step definitions and page objects do not change.
- **`scope()` identity callback** returning two stable ids `(suite, test)`, read
  live each time a locator is created, so a long-lived page heals correctly as it
  moves between logical tests. Identity comes from your runner, never from the
  page URL.
- **`resetScope(page)`** to restart occurrence counting for a same-scope retry, so
  a re-run of the same scope does not drift the occurrence index. It is a safe
  no-op on a page selfmend did not wrap.
- **Standalone `loadBaseline(path)` and `saveBaseline(path, store)`** so you keep
  the baseline yourself when there is no reporter. `saveBaseline` is
  refresh-and-add only; it never auto-prunes.
- **`mergeBaselines(...stores)`** to combine per-worker baselines deterministically
  for parallel runs, so two workers never lose or corrupt each other's entries.
  The result is order-independent.
- **`onHeal` callback** that receives every heal event, both healed and
  could-not-heal, so heals are loggable without a Playwright reporter, plus
  **`renderHealSummary(events)`** to print the same boxed summary the reporter
  prints from the events you collected.
- **Runner-agnostic recipes in the README** (plain script, Cucumber, Mocha/Jest),
  each backed by a real file under `examples/` that is type-checked against the
  published API. A `check:readme` gate keeps the documented code byte-identical to
  those files.

### Changed

- The `@playwright/test` fixture is refactored onto the same `wrapPage` core, a
  single code path, with no behaviour change. The existing tests still pass
  unchanged, so the import-swap install and the boxed reporter output are
  byte-identical to 0.1.x.

### Scope and guarantees

- **Playwright Pages only.** Frameworks that drive a real Playwright `Page` are
  supported; Cypress and Selenium use incompatible locator models and are out of
  scope.
- **Page-level only this milestone.** `wrapPage` heals one `Page`; popups and new
  tabs each need their own `wrapPage`. Whole-`BrowserContext` wrapping is a later
  add.
- **Never-false-green is unchanged.** The same confidence floor and second-best
  margin gates run in the pure core, so raw mode inherits the guarantee exactly.
  A wrong or missing `scope()` key is a missed heal, never a wrong heal and never
  a false green.

## [0.1.2] - 2026-06-01

### Changed

- Added `repository`, `homepage`, and `bugs` fields to `package.json` so the npm
  page links to the now-public GitHub repo (github.com/BilalEjaz/selfmend).
- Stripped em dashes from the repo docs (`CHANGELOG.md`, `RELEASING.md`). No code
  or runtime change; this release is metadata and docs only.

## [0.1.1] - 2026-06-01

### Fixed

- Restored `@playwright/test` compatibility down to the declared `>=1.42` floor.
  The wrapped-locator Proxy now passes `constructor` through unbound, so
  `expect()` on Playwright `<= 1.59` (which detects a Locator via
  `receiver.constructor.name === "Locator"`, where 1.60 switched to
  `receiver._apiName`) accepts a wrapped locator. Previously
  `expect(page.locator(...))` threw `"X can be only used with Locator object"`
  on those versions. Proven by the CI matrix across 1.42, 1.49, and 1.60.

### Changed

- README: removed em dashes and added a plain-English explanation of the
  `threshold` (confidence floor) and `margin` (runner-up gap) settings, with
  worked examples.
- npm metadata: added discoverability keywords and cleaned the package
  description.

## [0.1.0] - 2026-05-31

First public release. `selfmend` heals broken Playwright locators fully offline,
inside your own CI, with a hard never-false-green guarantee.

### Added

- **One-line import-swap install** (INST-01, INST-02). Change
  `import { test, expect } from "@playwright/test"` to
  `... from "selfmend"`; every test becomes healing-aware with no test
  rewrites. `expect` is re-exported unchanged. A `healingFixture` is also
  exported for projects that compose their own `test.extend`.
- **Fingerprint capture on passing runs** (CAP-01). When a locator resolves and
  its action succeeds, `selfmend` records a derived-signal fingerprint (text,
  role, test-id, key attributes, neighbours, DOM position) for that locator.
- **Persistent, reviewable baseline** (CAP-02). Fingerprints persist to a
  committed `.selfmend/baseline.json` (derived signals only, no raw DOM, no
  PII), written in a deterministic, byte-stable order so diffs stay reviewable
  with zero churn.
- **Parallel-worker-safe persistence** (CAP-03). Each worker writes a lock-free
  per-`parallelIndex` shard; the reporter merges all shards atomically (Windows-
  safe temp-file + rename) in `onEnd`. The merge is order-independent, so no
  write is ever lost across concurrent workers.
- **Weighted multi-signal scoring with a confidence floor and a second-best
  margin gate** (MATCH-01, MATCH-02, MATCH-03). Candidates are scored against
  the captured fingerprint; a heal is accepted only when the top candidate
  clears the absolute confidence floor (`threshold`, default `0.9`) **and**
  beats the runner-up by at least the absolute `margin` (default `0.05`).
  Look-alike candidates within the margin are refused as ambiguous rather than
  guessed at.
- **Never-false-green refusal** (MATCH-04). Below either gate, the original
  error is re-thrown and the test fails normally. Assertions (`expect(...)`) are
  never routed through the heal path.
- **Live locator rebind and replay** (HEAL-01, HEAL-02). On a real
  `TimeoutError`, `selfmend` scores the live candidates, rebinds to the matched
  element via a fresh `page.locator(...)`, and replays the action within a
  bounded replay budget so the run stays green.
- **Boxed end-of-run report** (REP-01, REP-02). A summary-only reporter
  (`selfmend/reporter`) prints every heal (test, original selector, healed
  target, confidence) and a separate could-not-heal section. The reporter never
  heals, healing happens live in the worker fixture.
- **Fully-offline guarantee, verified** (PRIV-01). The entire capture + heal +
  merge path makes zero network calls, uses no API key, and emits no telemetry.
  Proven by an in-process network-block test that throws on any
  `net`/`http`/`https`/`dns`/`tls`/`fetch` use and asserts a complete green heal
  cycle with zero egress attempts. The only runtime dependencies are `zod` and
  `picocolors`.
- **Configurable healing** (CFG-01, CFG-02). `enabled` (default `true`),
  `threshold` (default `0.9`), `margin` (default `0.05`), and `testIdAttr`
  (default `"data-testid"`) are validated via a zod schema. An opt-in
  `SELFMEND_PRUNE` env flag prunes orphaned baselines, but only on a complete,
  fully-passed run.

### Known limitations

- Locator healing only, assertions, smart waits, and any LLM-based tiebreaker
  are out of scope for v1.
- Playwright-only (`@playwright/test >=1.42`, tested against 1.60).
- The occurrence index counts chained-method invocations, so divergent control
  flow between a capture run and a later heal run degrades to no-heal
  (fail-safe, never a mis-heal). See README "Limitations".
- `selectOption` / `setInputFiles` value-object payloads on the replay path are
  a known latent edge case (currently tolerated). See README "Limitations".

[0.2.3]: https://github.com/BilalEjaz/selfmend/releases/tag/v0.2.3
[0.2.2]: https://github.com/BilalEjaz/selfmend/releases/tag/v0.2.2
[0.2.1]: https://github.com/BilalEjaz/selfmend/releases/tag/v0.2.1
[0.2.0]: https://github.com/BilalEjaz/selfmend/releases/tag/v0.2.0
[0.1.1]: https://github.com/BilalEjaz/selfmend/releases/tag/v0.1.1
[0.1.0]: https://github.com/BilalEjaz/selfmend/releases/tag/v0.1.0
