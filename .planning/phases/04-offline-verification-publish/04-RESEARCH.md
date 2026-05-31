# Phase 4: Offline Verification & Publish - Research

**Researched:** 2026-05-31
**Domain:** npm dual-format publish prep + Playwright in-process runtime network-block proof (PRIV-01) + GitHub Actions compatibility matrix
**Confidence:** HIGH (the load-bearing claims — what Chromium touches at the Node net layer, the npm resolver crash root cause + fix, and the pack/publint/attw state — were all verified by running them in this exact repo on this machine)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Prepare-and-stop, do NOT run the real `npm publish`. Build to publish-ready and verify with `npm publish --dry-run` + `npm pack` + publint + attw. The real `npm publish` is a documented manual human step (irreversible, needs their npm auth).
- **D-02:** First version is `0.1.0` (pre-1.0). Set in package.json (currently 0.0.0); add a CHANGELOG entry for 0.1.0.
- **D-03:** PRIV-01 proven by an in-process RUNTIME network-block test: override Node's `net`/`http`/`https`/`dns` (and global `fetch`) to THROW on any use, run a full capture + heal + merge cycle, assert it completes with ZERO attempted connections. Portable, deterministic, no special infra. This is the canonical PRIV-01 proof.
- **D-04:** No network-disabled CI container required for v1 (the runtime block test is the guarantee). Offline-by-construction already holds: zero network/AI/telemetry runtime deps (only zod + picocolors).
- **D-05:** Full CI via GitHub Actions on every push/PR: lint + unit (vitest) + integration (playwright) + the offline network-block test + `npm pack` + publint + attw, across a Playwright-version MATRIX (declared floor `>=1.42` and latest `1.60`).
- **D-06:** Release stays MANUAL for v1. No Changesets auto-publish, no NPM_TOKEN in CI yet.
- **D-07:** Shipped README covers: install + import-swap quickstart; config reference (`enabled`, `threshold`, `margin`, `testIdAttr`, `SELFMEND_PRUNE` env opt-in); a "how healing works + never-false-green trust model" section; the committed-baseline workflow (what `.selfmend/baseline.json` is, that it is committed, that shards are ignored); honest Limitations (locator-only, Playwright-only v1; WR-03 occurrence-index-on-chained-calls, WR-04 selectOption/setInputFiles replay). No docs site.
- **D-08:** Regenerate `package-lock.json` via a clean `npm install` BEFORE pack/publish prep. If the resolver bug recurs, diagnose it (it is a blocker), do not paper over it.

### Claude's Discretion
- Exact network-block test implementation (which modules to stub, how to assert zero-egress).
- The GitHub Actions workflow YAML shape and matrix syntax.
- CHANGELOG format (keep-a-changelog vs simple).
- The precise README structure/wording.
- Whether to add a `.gitattributes` / pre-commit NUL-byte guard (recommended given two stray-NUL incidents in Phase 3).
- Keep the package lean (`files:[dist]`); do not add runtime deps.

### Deferred Ideas (OUT OF SCOPE)
- The actual `npm publish` (human runs it after this phase).
- Changesets / automated CI publish with NPM_TOKEN.
- Network-disabled CI container.
- Docs site / extended guides / contributing guide.
- Dedicated fixes for WR-03 / WR-04 (documented as limitations now).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PRIV-01 | The entire healing path runs fully offline — no network calls, no API key, no telemetry — verified by a network-blocked test | VERIFIED in-repo: a real Chromium launch + page + click + evaluate makes ZERO `net.Socket.connect`/`net.connect`/`http.request`/`https.request`/`dns.*`/`tls.connect`/`fetch` calls (only one `child_process.spawn("chrome-headless-shell.exe")`). A throw-on-any-egress stub therefore does NOT break the browser, so the canonical D-03 block test is feasible and least-flaky as a **Playwright** test installing stubs per-test or via a fixture. Source layer also imports zero `node:http/https/net/dns/tls`. |
</phase_requirements>

## Summary

Three things gate this phase, and all three were resolved with direct verification on this machine (Node v24.12.0, npm 11.6.2, Windows 11) rather than from training memory:

1. **The PRIV-01 offline test (D-03) is safe and simple — proven by instrumentation.** I instrumented `net.Socket.connect`, `net.connect`, `http.request`, `https.request`, `dns.lookup/resolve*`, `dns.promises.*`, `tls.connect`, and global `fetch`, then launched real headless Chromium, opened a page, navigated to a `data:` URL, clicked, and ran `locator.evaluate`. **Result: zero calls to any of those APIs.** The only Node-level external action was a single `child_process.spawn("chrome-headless-shell.exe")` — Chromium's CDP transport is a stdio pipe to the spawned process, NOT a Node TCP socket or Node DNS. **Therefore a block that throws on ANY use of `net`/`http`/`https`/`dns`/`tls`/`fetch` will not break the browser or the heal path.** A loopback-allowlist is not strictly required for Chromium; I still recommend the slightly richer "throw on non-loopback only" variant because it is more robust against a future `webServer`/dev-server config and reads as intentional. The test should be a Playwright test (the heal path needs a real `page`), with stubs installed per-test (or in a tiny fixture), asserting a green capture→heal cycle completes AND a recording counter stays at 0.

2. **The npm resolver crash (D-08) has a definite root cause and a clean fix — both verified.** `npm install --dry-run` reproduced `Cannot read properties of null (reading 'children')`. The cause: Phase 3 hand-extracted `@types/node` into `node_modules` without any lockfile, and crucially there was **no `node_modules/.package-lock.json`** (npm's hidden arborist metadata). npm's tree builder hits a null node and crashes. The npm cache itself is intact (`npm cache verify` → 5367 entries OK). Fix verified: remove `node_modules` (no root `package-lock.json` existed), `npm install` → **succeeded in 11s, exit 0, 148 packages**, and produced a fresh `package-lock.json` (lockfileVersion 3, 189 packages, `@types/node` 24.12.4, `@playwright/test` 1.60.0) plus the hidden lockfile. A second `npm install` was idempotent. **This is done — the lockfile now exists in the repo as an untracked file ready to commit.**

3. **The dual ESM/CJS publish surface is already valid — verified.** After the clean install + `npm run build`, `publint` is **"All good!"**, `attw --pack` exits 0 with only the expected `node10` 💀 on the `./reporter` subpath (legacy node10 cannot resolve subpath exports — standard and ignorable), and `npm pack --dry-run` / `npm publish --dry-run` both succeed with a 20-file, 107.7 kB tarball (dist + README + package.json only). One non-blocking cleanup: the tarball ships `.map` source maps (~130 kB of 333 kB unpacked) that reference un-shipped `src/` — consider disabling them for publish.

**Primary recommendation:** Build order — (1) commit the regenerated `package-lock.json` first (D-08, unblocks everything); (2) write the PRIV-01 Playwright offline test (TDD: it should pass immediately since the code is already offline, but assert it hard); (3) bump to 0.1.0 + CHANGELOG + expand README + add a `prepublishOnly` build-and-pack guard; (4) wire the GitHub Actions matrix; (5) run the terminal proof (`npm publish --dry-run` + publint + attw green) and write the human publish checklist. Add the cheap `.gitattributes` NUL guard.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Offline proof (PRIV-01) | Test harness (Playwright runner) | — | Needs a real `page` to run the genuine capture→heal cycle; stubs live in the Node process the test runs in |
| Network-block stubs | Node process (per-test/fixture) | globalSetup (avoid) | Per-test install is most local + deterministic; globalSetup would also block the browser-download/CI bootstrap, which we do NOT want |
| Package build (dual ESM/CJS) | Build tooling (tsdown) | — | Already produces correct types-first exports; phase only validates + version-bumps |
| Publish validation | CI + local scripts (publint/attw/pack) | — | Static analysis of the package surface; no runtime tier |
| Compatibility proof | CI matrix (GitHub Actions) | — | Cross-version install + test is an infra concern, not a code concern |
| Lockfile reproducibility | Package manager (npm) | — | `package-lock.json` is the install contract for consumers + CI |

## Standard Stack

All tooling already present in `devDependencies` and verified working in this repo. No new runtime deps (offline guarantee, D-04). CI/dev tooling only.

### Core (already installed + verified this session)
| Library | Version (verified) | Purpose | Why Standard |
|---------|--------------------|---------|--------------|
| tsdown | 0.22.x | Dual ESM+CJS+d.ts build | Builds clean; produces types-first `exports` matching package.json [VERIFIED: `npm run build` exit 0 this session] |
| publint | 0.3.21 | Lint `package.json`/`exports` shape | `npx publint` → "All good!" [VERIFIED this session] |
| @arethetypeswrong/cli (attw) | 0.18.x | Verify TS resolution under import+require | `npx attw --pack` exit 0 (only node10 subpath 💀, expected) [VERIFIED this session] |
| @playwright/test | 1.60.0 (peer `>=1.42`) | Host framework + the offline-test browser | [VERIFIED: installed 1.60.0; floor declared `>=1.42`] |
| vitest | 4.x | Pure-logic unit tests | Existing suite (unchanged this phase) |
| @types/node | 24.12.4 | Node typings | [VERIFIED: clean install resolved 24.12.4, supersedes the hand-installed 24.10.1] |

### Supporting (CI / dev — add this phase)
| Tool | Version | Purpose | When to Use |
|------|---------|---------|-------------|
| GitHub Actions `actions/checkout` | v4 | Checkout | CI bootstrap [ASSUMED — pin to latest v4 at write time] |
| GitHub Actions `actions/setup-node` | v4 | Node + npm cache | CI bootstrap; supports `node-version` matrix + `cache: npm` [ASSUMED — pin latest] |
| `actions/cache` (or setup-node cache) | v4 | Cache Playwright browsers | Speed only; optional [ASSUMED] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Per-test stub install (offline test) | `globalSetup` stub install | globalSetup runs once before workers and would also block the CI browser download / any bootstrap network — wrong scope. Reject. |
| Throw-on-non-loopback block | Throw-on-ANY-egress block | Either works (Chromium uses neither path). Non-loopback variant is more robust to a future `webServer`. Both acceptable. |
| `npm ci` in CI | `npm install` in CI | `npm ci` is the correct CI command once the lockfile is committed (fails on lockfile drift — exactly what we want as a regression net). |

**Installation:** No installs needed — all tooling is present after the clean `npm install` (D-08). The matrix step installs a second Playwright version (see CI section).

**Version verification (run this session):**
- `node --version` → v24.12.0; `npm --version` → 11.6.2
- clean `npm install` → `package-lock.json` lockfileVersion 3, `@types/node@24.12.4`, `@playwright/test@1.60.0`

## Package Legitimacy Audit

> No NEW external packages are installed this phase. All packages below are pre-existing, locked by the regenerated `package-lock.json`, and from the original STACK.md research. slopcheck was not run (no new package surface to audit); the existing deps are well-known, high-trust packages.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| zod | npm | mature | very high | github.com/colinhacks/zod | not run (existing) | Pre-existing, runtime dep |
| picocolors | npm | mature | very high | github.com/alexeyraspopov/picocolors | not run (existing) | Pre-existing, runtime dep |
| @playwright/test | npm | mature | very high | github.com/microsoft/playwright | not run (existing) | Pre-existing, peer dep |
| tsdown / publint / @arethetypeswrong/cli / vitest / @types/node | npm | mature | high | (each official) | not run (existing) | Pre-existing dev deps |

**Packages removed due to slopcheck [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** none.
**GitHub Actions** (`actions/checkout`, `actions/setup-node`) are first-party GitHub actions — pin to a major version tag (`@v4`) per supply-chain hygiene; optionally pin to a full commit SHA for maximum strictness.

## Architecture Patterns

### System Architecture Diagram

```
PHASE-4 DELIVERABLES (no product code changes to the heal core)

  D-08 prerequisite ──────────────────────────────────────────────┐
  rm node_modules → npm install → package-lock.json (commit)       │ unblocks
                                                                    ▼
  ┌─────────────────────────── PRIV-01 offline test ───────────────────────────┐
  │  Playwright test (needs real page)                                          │
  │    beforeEach: install throw-on-egress stubs                                │
  │      net.connect / net.Socket.connect / http.request / https.request /      │
  │      dns.lookup|resolve* (+ promises) / tls.connect / globalThis.fetch      │
  │      → each increments egressAttempts AND throws OfflineViolationError       │
  │    test body (mirrors heal.spec.ts):                                        │
  │      goto file://index.html → capture fingerprint                           │
  │      goto file://broken.html → action TimeoutError → score → decide →       │
  │        rebind page.locator(newSel) → replay GREEN  (full capture+heal)      │
  │      (+ optional shard write + reporter merge to exercise the store path)   │
  │    afterEach: restore originals; assert egressAttempts === 0                 │
  │  Browser CDP = child_process.spawn(chrome) + stdio PIPE  ← NOT blocked       │
  └──────────────────────────────────────────────────────────────────────────┘
                                                                    │
  ┌─────────── publish prep ──────────┐    ┌──────── CI matrix (GH Actions) ────┐
  │ version 0.0.0 → 0.1.0             │    │ os: ubuntu (+ windows optional)     │
  │ CHANGELOG.md (keep-a-changelog)  │    │ node: [22, 24]                      │
  │ README expand (D-07)             │    │ playwright: [1.42, 1.60]            │
  │ prepublishOnly: build+pack guard │    │ steps: npm ci → install pw@<ver> →  │
  │ (optional) drop dist sourcemaps  │    │   build → typecheck → vitest →      │
  └──────────────────────────────────┘    │   playwright test (incl offline) → │
                    │                       │   publint → attw --pack → pack      │
                    ▼                       └─────────────────────────────────────┘
  TERMINAL PROOF: npm publish --dry-run green (+ pack + publint + attw)
                    │
                    ▼
  HUMAN STEP (out of scope): npm login → npm publish --access public  (2FA)
```

### Pattern 1: The PRIV-01 offline network-block test
**What:** A Playwright test that installs throw-on-egress stubs in the worker's Node process, then runs the real capture→heal cycle and asserts zero egress attempts.
**When to use:** This is the single canonical PRIV-01 proof (D-03).
**Why a Playwright test, not Vitest:** the heal path requires a real `page` (capture via `locator.evaluate`, candidate enumeration, live rebind+replay). A pure Vitest stub-test cannot exercise the genuine path. [VERIFIED: the heal path runs entirely inside the browser + in-process scorer; no Node net is used by either.]
**Where to install the stubs:** per-test `beforeEach`/`afterEach` (or a small `test.extend` fixture), NOT `globalSetup`. globalSetup would also block CI's browser download / bootstrap. Per-test install is local, deterministic, and trivially restored.
**Example (model after `tests/heal.spec.ts`):**
```typescript
// Source: VERIFIED behavior — Chromium launch+page+click+evaluate triggers
// zero net/dns/tls/http/fetch in the Node process (instrumented this session).
import { errors } from "@playwright/test";
import { healingFixture as test } from "../src/integration/fixture.js";
import net from "node:net";
import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import tls from "node:tls";

class OfflineViolationError extends Error {}

function installEgressBlock(counter: { n: number }) {
  const restores: Array<() => void> = [];
  const block = (label: string) => (..._a: unknown[]): never => {
    counter.n++;
    throw new OfflineViolationError(`offline violation: ${label}`);
  };
  // Optional refinement: only throw for non-loopback. For Chromium this is
  // never exercised, so a blanket throw is equally safe and simpler to assert.
  const patch = <T extends object>(obj: T, key: keyof T, label: string) => {
    const orig = obj[key];
    (obj as any)[key] = block(label);
    restores.push(() => { (obj as any)[key] = orig; });
  };
  patch(net, "connect", "net.connect");
  patch(net.Socket.prototype, "connect", "net.Socket.connect");
  patch(http, "request", "http.request");
  patch(https, "request", "https.request");
  patch(dns, "lookup", "dns.lookup");
  patch(dns.promises, "lookup", "dns.promises.lookup");
  patch(tls, "connect", "tls.connect");
  const origFetch = globalThis.fetch;
  globalThis.fetch = block("fetch") as typeof fetch;
  restores.push(() => { globalThis.fetch = origFetch; });
  return () => restores.forEach((r) => r());
}

test("PRIV-01: full capture+heal completes with zero network egress", async ({ page }, testInfo) => {
  const counter = { n: 0 };
  const restore = installEgressBlock(counter);
  try {
    await page.goto(INDEX_URL);                 // file:// — offline
    const submit = page.locator(".btn-primary");
    await submit.waitFor();                     // capture fingerprint
    await page.goto(BROKEN_URL);
    await submit.click({ timeout: 1200 });      // TimeoutError → heal → GREEN
    await expect(page.locator('[data-testid="submit-btn"]')).toHaveText("Submit");
  } finally {
    restore();
  }
  expect(counter.n).toBe(0); // the load-bearing PRIV-01 assertion
});
```
**Note on the store/merge half of D-03:** the in-fixture worker shard write + reporter merge also touch only `node:fs`/`node:path` (no network) — to assert "capture + heal + MERGE" end-to-end offline, run the existing `tests/parallel/*.pwspec.ts` driver under the block, OR keep the heal-cycle test plus a separate assertion that `src/store/persistence.ts` imports no network module (it does not — [VERIFIED]).

### Pattern 2: `prepublishOnly` publish-safety guard
**What:** A package.json script that rebuilds and re-validates before any `npm publish` (manual or otherwise).
**When to use:** Always — prevents a human shipping stale/unbuilt `dist`.
**Example:**
```jsonc
"scripts": {
  "prepublishOnly": "npm run build && npm run lint:pack && npm run lint:types"
  // build → fresh dist; publint + attw → fail the publish if the surface regressed.
  // npm runs prepublishOnly automatically on `npm publish` (NOT on install).
}
```

### Pattern 3: Two-Playwright-version matrix without breaking the peer dep
**What:** Install the floor and latest `@playwright/test` per matrix leg, after a clean `npm ci`.
**When to use:** D-05 compatibility proof.
**Example (the load-bearing step):**
```yaml
# After `npm ci` (installs the dev pin 1.60), override for the floor leg:
- run: npm install --no-save @playwright/test@${{ matrix.playwright }}
- run: npx playwright install --with-deps chromium
```
`--no-save` installs the matrix version into `node_modules` without rewriting `package.json`/lockfile. Because `@playwright/test` is a peerDependency (not a dependency), there is no version conflict — selfmend always binds to whatever Playwright is resolved in `node_modules`. [VERIFIED: package.json declares `peerDependencies["@playwright/test"]: ">=1.42"` and tsdown `neverBundle`s it.]

### Anti-Patterns to Avoid
- **Installing the egress block in `globalSetup`:** blocks the CI browser download and any bootstrap; scope it per-test.
- **Asserting offline by checking `page.route`/CDP network:** that measures the *browser's* network (the page is `file://`/`data:` anyway), not the *plugin's* Node-process egress, which is what PRIV-01 is about. Block at the Node API layer.
- **Pinning a narrow `@playwright/test` dependency:** keep it a peerDependency with the tested `>=1.42` floor; the matrix is what proves the range (Pitfall 8).
- **Committing `dist/` or hand-editing the lockfile:** `dist` is gitignored + rebuilt by `prepublishOnly`; the lockfile must come from a real `npm install` (D-08).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Package-surface validation | A custom `exports`-map checker | `publint` + `attw --pack` (already wired) | They encode every node10/node16/bundler resolution rule; hand-rolling misses cases |
| Offline assertion | A custom CDP/network sniffer | Node-API stubs that throw + a counter | Simplest correct measure of *plugin* egress; verified to not break the browser |
| Lockfile | Hand-editing `package-lock.json` | A clean `npm install` | The arborist computes integrity hashes + the hidden lockfile; hand edits re-trigger the crash |
| Changelog generation | A script | A hand-written `CHANGELOG.md` (keep-a-changelog) | One entry for 0.1.0; Changesets is deferred (D-06) |

**Key insight:** This phase is almost entirely validation + packaging + proof. The product code (heal core, store, reporter) is frozen — touching it risks the Phase 1-3 invariants. The only new *code* is the offline test (and the tiny `prepublishOnly` script + optional NUL guard).

## Runtime State Inventory

> This phase renames nothing in stored data and registers no OS state, but it DOES regenerate a build/install artifact (the lockfile) and bump a version. Inventory below.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — the `.selfmend/baseline.json` store format is unchanged this phase (no schema bump). Verified: no store-version literal change planned. | None |
| Live service config | None — no external services. | None |
| OS-registered state | None — no scheduled tasks, no daemons. | None |
| Secrets/env vars | `SELFMEND_PRUNE` (opt-in destructive prune) and `SELFMEND_STORE_DIR` (test redirect) and `SELFMEND_DEBUG` are read by the code — document `SELFMEND_PRUNE` in the README per D-07; the other two are internal/test-only. No secret keys involved. NPM_TOKEN explicitly NOT added to CI (D-06). | Document `SELFMEND_PRUNE` only |
| Build artifacts / installed packages | **`node_modules` was hand-extracted in Phase 3 with no lockfile → npm resolver crash.** A clean `npm install` (this session) regenerated `node_modules` + a fresh `package-lock.json` (`@types/node` 24.10.1 → 24.12.4). `dist/` is rebuilt by `prepublishOnly` and gitignored. | **Commit the new `package-lock.json` (D-08, done — file present untracked).** Stale `dist/` is not tracked. |

## Common Pitfalls

### Pitfall 1: Blocking egress in the wrong scope breaks the browser launch
**What goes wrong:** Installing the network block too early (globalSetup, or before `chromium.launch`) is believed to break Chromium, leading authors to a fragile loopback-allowlist they think is mandatory.
**Why it happens:** Assumption that CDP uses a localhost TCP socket through Node.
**How to avoid:** It does NOT — [VERIFIED] Chromium uses `child_process.spawn` + a stdio pipe, zero Node `net`/`dns`/`tls`. Install the block per-test (after launch is owned by the fixture) and a blanket throw is safe. If you want defense-in-depth, the non-loopback variant is equivalent.
**Warning signs:** Test fails with a browser-launch error rather than an `OfflineViolationError` → you blocked the wrong scope.

### Pitfall 2: The npm resolver crash recurs because node_modules is hand-patched again
**What goes wrong:** `Cannot read properties of null (reading 'children')` on any `npm install`/`npm ci`.
**Why it happens:** A `node_modules` tree with packages but no `node_modules/.package-lock.json` (hidden lockfile) and no root lockfile — npm's arborist hits a null node. [VERIFIED root cause this session: hidden lockfile was absent.]
**How to avoid:** Never hand-extract into `node_modules`. Recovery (verified to work): `rm -rf node_modules` (and `package-lock.json` if present/corrupt) → `npm install` → commit the fresh `package-lock.json`. The npm cache is fine (`npm cache verify` passed), so no cache wipe is needed. In CI use `npm ci` (fails loudly on lockfile drift).
**Warning signs:** The error mentions `children`/`null` in arborist — it is a tree-state problem, not a network or registry problem.

### Pitfall 3: Stale/unbuilt dist shipped on manual publish
**What goes wrong:** The human runs `npm publish` against an old `dist/`.
**How to avoid:** `prepublishOnly` rebuilds + re-lints before publish (Pattern 2). It runs on `npm publish` but not on install.
**Warning signs:** Published tarball size/hash differs from the dry-run; consumers report missing exports.

### Pitfall 4: `attw` node10 💀 on the subpath misread as a failure
**What goes wrong:** Seeing `💀 Resolution failed` for `selfmend/reporter` under `node10` and treating it as a publish blocker.
**Why it happens:** node10 (legacy) resolution cannot resolve `exports` subpaths — this is expected for any package with subpath exports and a `>=node16` floor (`engines.node>=22` here). [VERIFIED: attw exits 0; only the node10 subpath row is 💀; node16/bundler all 🟢.]
**How to avoid:** Accept it, or make it explicit with `attw --pack --ignore-rules cjs-resolves-to-esm` is NOT needed here; if you want a clean board, add `--profile node16` (only checks the modern resolver) in CI. Document the decision.
**Warning signs:** A non-node10 row turning 💀/🟡 — that IS a real regression to fix.

### Pitfall 5: Shipping source maps that point at un-shipped src
**What goes wrong:** ~130 kB of `.map` files in the tarball reference `src/` that `files:[dist]` does not ship, so they are dead weight (and a minor source-leak-of-paths).
**How to avoid (optional, Claude's discretion):** Set `sourcemap: false` in `tsdown.config.ts` for the published build, or exclude `*.map` from the tarball. Non-blocking — publint/attw/pack are all green with them present.
**Warning signs:** Tarball unpacked size dominated by `.map` files (333 kB → ~200 kB without).

## Code Examples

### Verified clean-install recovery (D-08)
```bash
# Source: VERIFIED in this repo this session (exit 0, 148 packages, 11s)
rm -rf node_modules          # PowerShell: Remove-Item -Recurse -Force node_modules
# (no root package-lock.json existed; if a corrupt one exists, remove it too)
npm install                  # regenerates node_modules + package-lock.json (lockfileVersion 3)
git add package-lock.json && git commit -m "build: regenerate package-lock (D-08)"
```

### Verified terminal proof sequence (D-01)
```bash
# Source: VERIFIED in this repo this session — all green
npm ci                       # clean install from the committed lockfile
npm run build                # tsdown → dist (exit 0)
npx publint                  # "All good!"
npx @arethetypeswrong/cli --pack   # exit 0 (node10 subpath 💀 expected)
npm pack --dry-run           # 20 files, dist+README+package.json, 107.7 kB
npm publish --dry-run        # "+ selfmend@<ver>" (no real publish)
```

### Human publish checklist (out of scope to RUN — document in README/RELEASING)
```bash
# The human runs these with their own npm account (D-01). prepublishOnly re-guards.
npm login                          # interactive, with 2FA
npm whoami                         # confirm the publishing account
npm publish --access public        # --access public is explicit + required if ever scoped
#   (an unscoped public package defaults to public, but be explicit)
git tag v0.1.0 && git push --tags   # tag the release
```

### GitHub Actions matrix (D-05) — recommended shape
```yaml
# .github/workflows/ci.yml  [ASSUMED action versions — pin latest v4 at write time]
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest]          # add windows-latest if Windows-specific atomicWrite coverage wanted
        node: [22, 24]
        playwright: ["1.42.0", "1.60.0"]   # declared floor + latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: ${{ matrix.node }}, cache: npm }
      - run: npm ci
      - run: npm install --no-save @playwright/test@${{ matrix.playwright }}
      - run: npx playwright install --with-deps chromium
      - run: npm run typecheck
      - run: npm test                       # vitest unit
      - run: npm run test:e2e               # playwright integration incl. PRIV-01 offline test
      - run: npm run build
      - run: npx publint
      - run: npx @arethetypeswrong/cli --pack
      - run: npm pack --dry-run
```
Notes: the offline PRIV-01 test rides inside `npm run test:e2e` (it is just another `tests/*.spec.ts`). The pack/publint/attw steps need only run once (e.g. gate on `matrix.node == 24 && matrix.playwright == '1.60.0'`) to avoid redundant noise — Claude's discretion.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Network-disabled CI container for offline proof | In-process Node-API egress block (D-03) | this phase | Portable, runs on the author's Windows box + any CI, no infra |
| `npm install` in CI | `npm ci` from committed lockfile | standard 2026 | Reproducible installs; fails on lockfile drift |
| Changesets auto-publish | Manual `npm publish` for v1 (D-06) | this phase | No NPM_TOKEN handed to CI; human-gated first release |
| tsup | tsdown (already adopted) | 2026 | Correct dual-format extensions; already in use |

**Deprecated/outdated:**
- The hand-installed `@types/node@24.10.1` (Phase 3 workaround) is superseded by the lockfile's `24.12.4`. No action beyond committing the lockfile.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `actions/checkout@v4` and `actions/setup-node@v4` are the current major versions | CI matrix | Low — pin the actual latest tag at write time; mechanical |
| A2 | `@playwright/test@1.42.0` installs + runs on Node 22/24 with this code (floor leg of the matrix) | CI matrix | Medium — the matrix run is itself the proof; if 1.42 fails, document the real floor and raise it (Pitfall 8). The wrapper pattern + `errors.TimeoutError` are old-stable APIs, so 1.42 is expected to pass, but it was NOT run this session (only 1.60 is installed locally) |
| A3 | Disabling dist source maps is harmless for consumers | Pitfall 5 | Low — maps are optional; only affects debug stack traces into the lib |

## Open Questions (RESOLVED)

Both resolved for planning and encoded in the Phase 4 plans:
- **Q1 RESOLVED:** one canonical PRIV-01 heal-cycle test under the egress block is the proof; persistence/merge is statically network-free, so no separate "merge offline" test is required. Implemented in 04-01 Task 2.
- **Q2 RESOLVED:** the CI matrix is the empirical proof for the `@playwright/test@1.42` floor; if the 1.42 leg fails, raise the declared peer floor (honest-floor rule) rather than claim false support. Implemented in 04-03 Task 1.

1. **Should the offline test also exercise the reporter merge (the "+ merge" in D-03), or is the heal-cycle + a static "no network import in persistence" assertion sufficient?**
   - What we know: the store/merge path imports only `node:fs`/`node:path` ([VERIFIED]); the parallel driver specs already exercise capture→shard→merge.
   - What's unclear: whether the planner wants one combined test or two.
   - Recommendation: one PRIV-01 heal-cycle test under the block (the canonical proof) PLUS reuse an existing parallel driver spec under the same block if a "merge offline" assertion is wanted. Don't over-build.

2. **Does the floor leg `@playwright/test@1.42` actually pass the integration suite?**
   - What we know: only 1.60 is installed + green locally; the APIs used (`test.extend` page override, `errors.TimeoutError`, `locator.evaluate`, Reporter `onEnd`) predate 1.42.
   - What's unclear: empirical pass on 1.42.
   - Recommendation: let the CI matrix be the proof. If 1.42 fails, raise the declared floor to the lowest version that passes and update the README/peerDependencies (this is the honest-floor rule from Pitfall 8).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | everything | ✓ | v24.12.0 (engines `>=22`) | — |
| npm | install/lockfile/publish | ✓ | 11.6.2 | — |
| @playwright/test | offline test + integration | ✓ | 1.60.0 | — |
| Chromium browser | offline test | ✓ | installed (`npx playwright install chromium` ran clean) | — |
| publint | publish validation | ✓ | 0.3.21 | — |
| attw | type-resolution validation | ✓ | 0.18.x | — |
| GitHub Actions runner | CI matrix | n/a locally | — | CI-only; YAML is the deliverable |
| git | commit lockfile / tag | ✓ | repo confirmed (HEAD 236cbcb) | — |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** none. Everything the phase needs to PREPARE the publish is present and verified; the only thing not runnable locally is the GitHub Actions matrix (by definition CI-only) and `@playwright/test@1.42` (matrix proves it).

## Validation Architecture

> `.planning/config.json` was not present to read; treating nyquist_validation as enabled (the existing repo is heavily TDD'd — 106+ vitest, 17 playwright).

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4 (unit) + @playwright/test 1.60 runner (integration/e2e) |
| Config file | `playwright.config.ts` (default), `playwright.parallel.config.ts` (parallel driver), Vitest via `vitest run src` |
| Quick run command | `npm test` (vitest unit) |
| Full suite command | `npm test && npm run test:e2e && npm run typecheck` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PRIV-01 | full capture+heal runs with zero Node egress | integration (playwright) | `npx playwright test tests/offline.spec.ts` | ❌ Wave 0 (new file) |
| PRIV-01 | source layer imports no network module | static / unit | `grep`-guard or a vitest assertion | ❌ Wave 0 (optional) |
| (publish) | publint/attw/pack/publish-dry-run all green | script | the verified terminal-proof sequence | ✅ scripts exist |

### Sampling Rate
- **Per task commit:** `npm test` (vitest) — fast.
- **Per wave merge:** `npm run test:e2e` (includes the new PRIV-01 test) + `npm run typecheck`.
- **Phase gate:** the full terminal-proof sequence green + the CI matrix defined.

### Wave 0 Gaps
- [ ] `tests/offline.spec.ts` — the PRIV-01 network-block heal-cycle test (covers PRIV-01). Model after `tests/heal.spec.ts`; install the egress block per-test.
- [ ] `package-lock.json` — DONE this session (commit it).
- [ ] `.github/workflows/ci.yml` — the matrix (D-05).
- [ ] `CHANGELOG.md` — 0.1.0 entry (D-02).
- [ ] (optional) `.gitattributes` + a NUL-byte CI/grep guard.

## Security Domain

> The product's entire security posture IS the offline guarantee. ASVS framing below.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | npm publish auth is the human's npm account (2FA) — out of code scope |
| V3 Session Management | no | n/a |
| V4 Access Control | no | n/a |
| V5 Input Validation | yes | config validated via zod schema ([VERIFIED] `src/config/schema.ts`); store reads fail-soft via safe parsers |
| V6 Cryptography | partial | `package-lock.json` integrity hashes + `npm publish` provenance; do NOT hand-roll any crypto |
| V10 Malicious Code / Supply Chain | yes | committed lockfile (integrity-pinned), `prepublishOnly` guard, pin GitHub Actions to a major tag/SHA, no NPM_TOKEN in CI (D-06) |

### Known Threat Patterns for an offline-first npm plugin
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Network egress in the heal path (privacy violation) | Information Disclosure | The PRIV-01 throw-on-egress test (D-03); zero network runtime deps [VERIFIED] |
| Shipping stale/unbuilt dist | Tampering | `prepublishOnly` rebuild + publint/attw guard |
| Lockfile drift / hand-edited tree (the Phase 3 crash) | Tampering / Integrity | Clean `npm install` only; `npm ci` in CI |
| Source maps leaking src paths | Information Disclosure (minor) | Optionally drop `*.map` from the published tarball |
| Raw NUL bytes corrupting tracked source (2 incidents in Phase 3) | Tampering / Integrity | `.gitattributes` + a CI grep guard that fails on a NUL in tracked source (recommended) |

## Sources

### Primary (HIGH confidence — verified by running in THIS repo this session)
- `node probe` instrumentation of `net`/`dns`/`tls`/`http`/`https`/`fetch`/`child_process` during real Chromium launch+page+click+evaluate → only `child_process.spawn("chrome-headless-shell.exe")`, zero Node net/dns/tls/http/fetch. **The decisive PRIV-01 finding.**
- `npm install --dry-run` → reproduced `Cannot read properties of null (reading 'children')`; `npm cache verify` → cache OK; `rm -rf node_modules && npm install` → exit 0, fresh `package-lock.json` (lockfileVersion 3, `@types/node` 24.12.4, `@playwright/test` 1.60.0). **The decisive D-08 finding.**
- `npm run build` (exit 0), `npx publint` ("All good!"), `npx @arethetypeswrong/cli --pack` (exit 0, node10 subpath 💀 expected), `npm pack --dry-run` (20 files, 107.7 kB), `npm publish --dry-run` (`+ selfmend@0.0.0`). **The decisive publish-surface finding.**
- Repo source read: `package.json`, `tsdown.config.ts`, `tsconfig.json`, both playwright configs, `src/integration/{fixture,locator-proxy}.ts`, `src/reporter/reporter.ts`, `src/store/persistence.ts`, `src/config/{schema,defaults}.ts`, `tests/heal.spec.ts`, `.gitignore` — confirms zero network imports in `src/` and the heal-path shape.

### Secondary (MEDIUM confidence — project research carried forward)
- `.planning/research/STACK.md` — dual ESM/CJS via types-first `exports`, publint+attw, Changesets-deferred, Playwright peer-dep floor 1.42 / latest 1.60, Node 22+24.
- `.planning/research/PITFALLS.md` — Pitfall 8 (distribution: ESM/CJS, peer-dep range = tested matrix, semver), Security Mistakes table (CI test asserting no outbound connections).
- `.planning/phases/03-.../03-02-SUMMARY.md` — the `@types/node` hand-install + stale-lockfile follow-up (D-08 origin) and the two NUL-byte incidents.

### Tertiary (LOW / ASSUMED — flagged in Assumptions Log)
- GitHub Actions action major versions (`@v4`) — pin latest at write time.
- `@playwright/test@1.42` floor-leg pass — proven by the matrix, not run locally.

## Metadata

**Confidence breakdown:**
- PRIV-01 offline approach: HIGH — instrumented the real browser; the "does it break Chromium?" question is answered with measured zero-egress.
- npm lockfile remediation: HIGH — reproduced the crash and verified the fix produces a committed lockfile.
- Publish surface (publint/attw/pack/dry-run): HIGH — all run green this session.
- CI matrix shape: MEDIUM — standard pattern, but the 1.42 floor leg and exact action versions are unproven locally (matrix is the proof).
- README content: HIGH — config keys/defaults read straight from `src/config/schema.ts` (`enabled` true, `threshold` 0.9, `margin` 0.05, `testIdAttr` "data-testid") and the committed-baseline workflow from `.gitignore`.

**Research date:** 2026-05-31
**Valid until:** 2026-06-30 (stable domain; the only fast-moving piece is exact GitHub Actions tags)
