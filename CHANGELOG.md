# Changelog

All notable changes to **selfmend** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Pre-1.0 notice:** While the version is below `1.0.0`, the public contract —
> the configuration schema and the committed baseline store format — may change
> in a breaking way between minor releases (per SemVer, anything is allowed
> pre-1.0). Such changes will always be called out in this changelog.

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
  committed `.selfmend/baseline.json` (derived signals only — no raw DOM, no
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
  heals — healing happens live in the worker fixture.
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

- Locator healing only — assertions, smart waits, and any LLM-based tiebreaker
  are out of scope for v1.
- Playwright-only (`@playwright/test >=1.42`, tested against 1.60).
- The occurrence index counts chained-method invocations, so divergent control
  flow between a capture run and a later heal run degrades to no-heal
  (fail-safe, never a mis-heal). See README "Limitations".
- `selectOption` / `setInputFiles` value-object payloads on the replay path are
  a known latent edge case (currently tolerated). See README "Limitations".

[0.1.0]: https://github.com/u0966572/selfmend/releases/tag/v0.1.0
