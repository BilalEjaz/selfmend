# Stack Research

**Domain:** Open-source TypeScript Playwright plugin (self-healing locators), npm-distributed, fully offline
**Researched:** 2026-05-31
**Confidence:** HIGH on integration surface and Playwright APIs; HIGH on build/publish tooling; MEDIUM on exact patch versions (verify at implementation time)

---

## TL;DR — The Decisive Answers

1. **Integration surface:** Use a **custom `test.extend` fixture that overrides the built-in `page` fixture** and injects a thin **wrapper around the locator factory** (`page.locator`, `getByRole`, `getByTestId`, etc.). The wrapper is where live capture (on success) and live interception + rebind (on failure) both happen. **Add a Reporter ONLY for the end-of-run console summary** — the Reporter API is post-hoc and cannot rebind a live locator. Do NOT monkey-patch Playwright internals.
2. **Why not Reporter for healing:** `Reporter.onTestEnd(test, result)` fires *after* the test has already failed. There is no public API to intercept locator resolution from a Reporter. Healing must happen in-process, inside the action, which only the fixture/wrapper path provides.
3. **Why not `addLocatorHandler`:** That API (added 1.42) is for auto-dismissing overlays when a locator *becomes visible*; it does not fire on resolution failure and is the wrong tool.
4. **Build:** `tsdown` (Rolldown-powered). **Test:** Playwright's own runner for E2E/integration + Vitest for unit logic (scoring, fingerprint serialization). **Package manager:** pnpm. **Targets:** Node 22 + 24, dual ESM/CJS publish via `exports`.

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| TypeScript | 5.9.x (latest 5.x) | Plugin language | Mandated by PROJECT.md; strict types are the selling point of a locator API. Use `strict: true`, `module: nodenext`. |
| `@playwright/test` | `^1.60` (peerDependency, range from `>=1.42`) | Host framework + extension surface (`test.extend`, `Reporter`, `Locator`) | Latest stable is 1.60 (1.61 alpha in flight, May 2026). Declare as `peerDependency` so the plugin uses the user's Playwright, never bundles its own. Floor at 1.42 (when `addLocatorHandler`/modern fixture overrides stabilized) but the wrapper pattern works far earlier — pin floor during phase 1 against your minimum supported user. |
| Node.js | 22 LTS (floor) + 24 Active LTS (primary) | Runtime target | Node 24 is Active LTS through Apr 2028; Node 22 is Maintenance LTS through Apr 2027. Set `engines.node: ">=22"`. Skip 20 (EOL trajectory); 26 is not LTS until Oct 2026. |
| tsdown | `^0.x` (latest) | Library bundler (ESM+CJS+`.d.ts`) | The 2026 successor to tsup; Rolldown-powered, ESM-first, emits correct file extensions, ~2x faster builds and up to 8x faster `.d.ts`. tsup is now effectively unmaintained. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none for fingerprinting) | — | DOM/element introspection | Use Playwright's own `locator.evaluate()` / `page.evaluate()` to serialize the fingerprint *inside the browser* in one round-trip. Do NOT add a DOM library (jsdom/cheerio) — the live DOM is already in the real browser. |
| `zod` | `^4.x` | Validate plugin config + (de)serialize the baseline store schema | When loading user config and reading the on-disk baseline JSON (guards against corrupt/old-format stores). Optional but recommended for a trust-critical tool. |
| `picocolors` | `^1.x` | Colorized console summary output | For the end-of-run heal report. Tiny, zero-dep, the de-facto 2026 choice over `chalk`. |
| `string-similarity` style scorer | hand-rolled | Text/attribute similarity scoring | Implement scoring in-house (Levenshtein/Jaccard/token overlap) rather than pulling a dep — it is the core IP and must be deterministic and offline. A ~50-line internal module beats an abandoned dep. |

> No HTTP client, no AI SDK, no telemetry library. The offline + no-API-key constraint forbids them, and adding one risks accidental network calls that break the core promise.

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| Vitest `^3.x` | Unit tests for pure logic (scoring, fingerprint diff, config parsing) | Fast, ESM-native. Keep browser-dependent tests in Playwright's runner; keep deterministic logic in Vitest. |
| `@playwright/test` runner | Integration/E2E tests of the plugin against a fixture app | Spin a tiny local HTML fixture, mutate selectors between runs, assert heals occur. This is your real regression net. |
| publint | Lint `package.json`/`exports` shape before publish | `npx publint` in CI. |
| `@arethetypeswrong/cli` (attw) | Verify TS consumers resolve types under both `import` and `require` | `npx @arethetypeswrong/cli --pack` in CI. Catches "masquerading as CJS". |
| Knip | Dead-code / unused-dependency detection | Keeps the published bundle lean (matters for a trust-first OSS tool). |
| ESLint 9 (flat config) + Prettier / or Biome | Lint + format | Biome is a faster single-binary option in 2026; either is fine. |
| Changesets | Versioning + changelog + npm publish automation | Standard for OSS npm libraries; generates SemVer bumps and release notes from PRs. |
| GitHub Actions | CI: lint, unit, integration, `npm pack` + publint + attw | The standard 3-line publish-safety gate in 2026. |

## Installation

```bash
# Package manager
corepack enable && corepack prepare pnpm@latest --activate

# Peer (NOT bundled — user provides it)
pnpm add -D @playwright/test

# Dev dependencies
pnpm add -D typescript tsdown vitest @arethetypeswrong/cli publint knip @changesets/cli

# Runtime deps (kept minimal for offline guarantee)
pnpm add zod picocolors
```

`package.json` essentials:

```jsonc
{
  "type": "module",
  "engines": { "node": ">=22" },
  "peerDependencies": { "@playwright/test": ">=1.42" },
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",   // types FIRST
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    },
    "./reporter": {
      "types": "./dist/reporter.d.ts",
      "import": "./dist/reporter.js",
      "require": "./dist/reporter.cjs"
    }
  },
  "files": ["dist"]
}
```

---

## Integration Surface — Concrete Design (the load-bearing part)

### What each Playwright API can and cannot do

| Capability needed | API | Verdict |
|---|---|---|
| (a) Intercept a *failed* locator resolution at runtime and rebind live | **Custom fixture (`test.extend`) overriding `page`, returning a wrapped locator factory** that try/catches the action and, on failure, runs scoring + retries with a healed locator | ✅ Only viable live path |
| (b) Capture element metadata on *successful* resolution | Same wrapper: after a successful action/resolve, call `locator.evaluate(...)` / `locator.ariaSnapshot()` to fingerprint | ✅ |
| End-of-run summary of heals | **Reporter** (`@playwright/test/reporter`) reading attachments/annotations the fixture wrote, OR a process-level singleton flushed in fixture teardown | ✅ for reporting only |
| Auto-dismiss overlays | `page.addLocatorHandler()` (1.42+) | ❌ wrong tool for healing |
| Patch resolution globally | Monkey-patching `playwright-core` internals | ❌ brittle, breaks on minor upgrades — reject |

### The fixture + wrapper pattern (recommended)

```ts
import { test as base } from '@playwright/test';

export const test = base.extend<{ /* no new fixtures needed externally */ }>({
  page: async ({ page }, use, testInfo) => {
    wrapLocatorFactory(page, testInfo); // override page.locator / getBy* to return healing locators
    await use(page);
  },
});
```

- **Capture (success path):** when a wrapped locator resolves and an action succeeds, serialize a fingerprint via `locator.evaluate(el => ({...}))` (text, role via `el.getAttribute('role')` / computed role, `data-testid`, tag, key attributes, sibling/neighbour signatures, and a DOM path) and write/update the baseline store keyed by a stable locator identity (e.g. selector string + test file + step).
- **Heal (failure path):** wrap each action (`click`, `fill`, etc.) or the resolution itself in try/catch with a short timeout. On `TimeoutError`/zero matches, run `page.$$`/`locator('*')` candidate enumeration, score each candidate's live fingerprint against the stored baseline, and if `bestScore >= threshold`, rebind to the matched element (build a new locator from a uniquely-identifying attribute or use the matched `ElementHandle`) and replay the action. Below threshold → rethrow the original error so the test fails normally (no false green).
- **Report:** push each heal `{ originalSelector, healedTarget, score }` into a per-process collector; flush to console in the Reporter's `onEnd()` (or fixture teardown for worker-local summaries). Use `testInfo.attach()` to pass structured heal data from worker to reporter cleanly.

> Reference implementations confirming this shape: `qosha1/healing-playwright`, `amrsa1/healwright`, `paulocoliveira/playwright-auto-heal` — all override the locator factory via a fixture rather than patching internals. (Confidence: MEDIUM — pattern confirmed via project descriptions; read their source during phase 1 to validate edge cases.)

### Locator inspection APIs for fingerprinting (all stable, public)

| API | Use | Version |
|---|---|---|
| `locator.evaluate(fn)` / `locator.evaluateAll(fn)` | Serialize one element / all candidates' fingerprints inside the browser in one round-trip | stable, long-standing |
| `locator.elementHandle()` / `locator.all()` | Get the resolved handle(s) for rebinding/replay | stable |
| `locator.getAttribute()`, `.textContent()`, `.innerText()` | Individual signals (slower than one `evaluate`) | stable |
| `locator.ariaSnapshot()` | YAML role/name tree of an element — excellent role+name fingerprint signal | added **v1.49**; `mode:'ai'` and `boxes` in 1.59–1.60 |
| `page.evaluate(fn)` | Bulk candidate enumeration + scoring data in one call | stable |
| `locator.count()` | Detect zero-match (the heal trigger) | stable |

**Recommended fingerprint fields:** tag, computed/explicit role, accessible name/text, `data-testid` (and configurable test-id attr), id, stable class tokens, key data-* attributes, ordinal among siblings, parent chain (short DOM path), and an `ariaSnapshot` slice. Serialize all of it in a single `locator.evaluate`/`page.evaluate` to minimize CDP round-trips.

---

## Local Persistence (offline baseline store)

| Option | Verdict |
|---|---|
| **JSON file on disk** (`.selfheal/baseline.json` or under `node_modules/.cache`) | ✅ **Recommended for v1.** Zero deps, human-inspectable (trust!), trivially gitignorable, fully offline. Use atomic write (temp file + rename) to avoid corruption on interrupted runs. |
| SQLite (`node:sqlite`, stable in Node 22.5+) | Consider only if baseline grows huge or concurrent worker writes contend. Overkill for v1; revisit if JSON contention appears with parallel workers. |
| LevelDB / lmdb / better-sqlite3 (native) | ❌ Native build pain, hurts zero-friction install. Avoid. |
| In-memory only | ❌ Baseline must persist across runs to be useful. |

**Concurrency note:** Playwright runs parallel workers. Either (a) shard the store per worker and merge in `globalTeardown`, or (b) serialize writes through a single process. Decide in phase 1 — this is a real pitfall, flag it to the roadmap.

---

## Publishing, Versioning, Configuration

- **Publish:** public npm, MIT license, `dist/` only, ESM+CJS dual via `exports` (types condition first). Run `npm pack` + `publint` + `attw` in CI before publish.
- **Version:** SemVer via Changesets. Treat the config schema and the fingerprint store format as part of the public contract (store format changes = at least minor + migration/ignore-old logic).
- **Configuration — two layers (recommended):**
  1. **`playwright.config.ts`** registers the plugin's Reporter and (optionally) points tests at the exported `test`. This is the idiomatic Playwright surface.
  2. **Plugin options** (threshold, on/off, test-id attribute, store path) passed to the fixture factory and/or a dedicated `selfheal.config.{ts,json}` discovered via a loader. Keep a sane zero-config default so "minimal config" (PROJECT.md requirement) holds: install + add reporter + wrap `test` = working.

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Fixture + locator wrapper | Reporter-only | Never for healing (post-hoc). Use Reporter only for the summary. |
| Fixture + locator wrapper | Monkey-patch `playwright-core` | Never — breaks across Playwright minor upgrades; kills trust. |
| tsdown | tsup | If you need a battle-tested tool with the largest community and don't mind it being unmaintained. tsdown is the forward path. |
| tsdown | unbuild / rollup direct | unbuild if you want Nuxt-ecosystem conventions; raw rollup only if you need exotic plugin chains. Neither is needed here. |
| JSON file store | SQLite (`node:sqlite`) | Large baselines or heavy parallel-worker write contention. |
| pnpm | npm | npm is fine; pnpm is faster and stricter about phantom deps (good for a lean lib). |
| Vitest + PW runner | Jest | Jest is heavier and ESM-awkward in 2026; avoid for new libs. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Monkey-patching `playwright-core` internals | Breaks on minor Playwright upgrades; opaque; erodes trust | Public `test.extend` fixture + locator factory wrapper |
| `Reporter` as the healing mechanism | Runs after the test already failed; cannot rebind live | Reporter for summary only; heal in the fixture |
| `addLocatorHandler` for healing | Fires on visibility for overlay dismissal, not on resolution failure | Try/catch in the wrapped action |
| jsdom / cheerio for fingerprinting | The real DOM is in the live browser; a parallel parser drifts and adds weight | `locator.evaluate` / `page.evaluate` in-browser |
| Any HTTP/AI/telemetry SDK | Violates the hard offline + no-API-key constraint | Deterministic in-house heuristic scorer |
| chalk | Larger, CJS-history baggage | picocolors |
| tsup (for new build) | No longer actively maintained | tsdown |
| Native-addon stores (better-sqlite3, lmdb) | Compile step breaks zero-friction install | JSON file (or `node:sqlite`, no native build) |
| Bundling `@playwright/test` as a dependency | Version conflicts with the user's Playwright | Declare it `peerDependencies` |

## Stack Patterns by Variant

**If supporting older user Playwright versions (e.g. teams on 1.4x):**
- Keep the wrapper pattern (works on very old versions) and set `peerDependencies` floor low; gate `ariaSnapshot`-based signals behind a version check (added 1.49) so older hosts still get text/attribute scoring.

**If parallel-worker write contention shows up:**
- Switch the store to per-worker shards merged in `globalTeardown`, or move to `node:sqlite` (no native build, Node 22.5+).

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| plugin (ESM+CJS) | `@playwright/test` >=1.42 (tested against 1.60) | Wrapper pattern works earlier; `ariaSnapshot` signals require >=1.49. Pin tested floor in phase 1. |
| Node >=22 | tsdown, Vitest 3, `node:sqlite` | `node:sqlite` stable from 22.5; safe on 24. |
| tsdown | TypeScript 5.9, Rolldown | Emits ESM with correct extensions + CJS + d.ts. |

## Sources

- https://playwright.dev/docs/test-fixtures — `test.extend`, overriding built-in `page` fixture (HIGH)
- https://playwright.dev/docs/api/class-reporter — `onTestEnd`/`onError`/`onEnd` are post-hoc (HIGH)
- https://playwright.dev/docs/api/class-locator — `evaluate`, `evaluateAll`, `elementHandle`, `all`, `count`, `getAttribute`, `textContent` (HIGH)
- https://playwright.dev/docs/aria-snapshots + v1.59/v1.60 release notes — `ariaSnapshot` added 1.49, `mode:'ai'`/`boxes` added 1.59–1.60 (HIGH)
- https://github.com/microsoft/playwright/releases — latest stable 1.60 (May 2026), 1.61 alpha (HIGH)
- https://github.com/qosha1/healing-playwright, https://github.com/amrsa1/healwright, https://github.com/paulocoliveira/playwright-auto-heal — confirm fixture+wrapper integration pattern (MEDIUM — read source in phase 1)
- https://tsdown.dev + https://www.pkgpulse.com/guides/tsup-vs-tsdown-vs-unbuild-typescript-library-bundling-2026 — tsdown is the 2026 successor; tsup unmaintained (MEDIUM/HIGH)
- https://endoflife.date/nodejs + https://github.com/nodejs/Release — Node 24 Active LTS, 22 Maintenance LTS (HIGH)
- https://publint.dev/rules + https://www.npmjs.com/package/@arethetypeswrong/cli — exports map + publish validation (HIGH)

---
*Stack research for: self-healing Playwright locator plugin (offline, MIT, npm)*
*Researched: 2026-05-31*
