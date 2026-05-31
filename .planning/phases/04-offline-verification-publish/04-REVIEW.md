---
phase: 04-offline-verification-publish
reviewed: 2026-05-31T00:00:00Z
depth: deep
files_reviewed: 11
files_reviewed_list:
  - tests/offline.spec.ts
  - scripts/check-types.mjs
  - package.json
  - tsdown.config.ts
  - tsconfig.json
  - .github/workflows/ci.yml
  - .github/workflows/nul-guard.yml
  - .gitattributes
  - README.md
  - CHANGELOG.md
  - RELEASING.md
findings:
  critical: 0
  warning: 3
  info: 4
  total: 7
status: clean
---

# Phase 4: Code Review Report

**Reviewed:** 2026-05-31
**Depth:** deep
**Files Reviewed:** 11
**Status:** issues_found

## Summary

Phase 4 is solid and the publish surface is well thought through. The dual ESM/CJS
`exports` map is correct (types-first, import/require split), the on-disk `dist/`
actually matches the declared `.d.cts`/`.d.mts`/`.cjs`/`.mjs` filenames, `files:[dist]`
plus no `.npmignore` ships the right bytes, `src/` is verified network-free (grep for
http2/child_process/node:net/http/dns/tls in src/ returns zero matches, confirming the
offline-by-construction claim), and the CI workflow correctly carries no publish step and
no NPM_TOKEN. The self-validating PRIV-01 test is a genuinely good design: it proves the
block trips before trusting the zero-egress count.

No BLOCKER-class defects found. The findings below are honest gaps in the *strength* of
the offline proof and one real anti-stale-publish regression introduced when `attw` was
moved out of `prepublishOnly`. None of them make the published 0.1.0 unsafe, but WR-01 and
WR-02 narrow the proof's actual coverage versus what the README/CHANGELOG claim, and should
be addressed (or the claim hedged) before shipping a package whose headline feature is the
offline guarantee.

## Warnings

### WR-01: Egress block does not cover `http2`, raw socket `write`, or `Agent` keep-alive reuse — the "every outbound API" claim is overstated

**File:** `tests/offline.spec.ts:65-106` (and the header comment lines 6-9, 18-23)

**Issue:** The block patches `net.connect`, `net.createConnection`, `net.Socket.prototype.connect`, `http(s).request/get`, `dns.lookup/resolve` (+ promises), `tls.connect`, and `globalThis.fetch`. It does **not** patch `node:http2` (`http2.connect`), nor `node:dgram` (UDP/QUIC-ish), nor does it intercept a socket that is already connected and then reused (HTTP keep-alive `Agent` sockets, or a `net.Socket` created via a path other than the three patched entry points and then `.write()`-en). The header comment asserts the block covers "every Node-process outbound API," which is stronger than what is actually patched. A future `src/` change (or a transitive dep) that opened an `http2` session, used a pooled keep-alive agent, or wrote to an already-open socket would slip past the counter and the test would still report `counter.n === 0` — a false green for the privacy proof.

For v1 this is largely theoretical: `src/` imports none of these today (verified) and the only runtime deps are `zod` + `picocolors`. But the test is the *mechanical* guarantee, and it is weaker than its own prose. Either widen the block or narrow the claim.

**Fix:** Add the missing surfaces (at minimum `http2`), and soften the header comment to "every common Node outbound API" rather than "every":
```ts
import http2 from "node:http2";
// ...inside installEgressBlock:
patch(http2, "connect", "http2.connect");
// Defence-in-depth against keep-alive reuse: also block Socket.prototype.write
// is too aggressive (breaks the CDP stdio pipe is fine — that's a pipe not a
// Socket — but stdout IS a Socket on some platforms). Prefer documenting the
// keep-alive gap explicitly instead of patching .write.
```
If `Socket.prototype.write` cannot be safely patched (it can break unrelated stdio), document the keep-alive/`write` gap in the header comment as a known boundary rather than implying total coverage.

### WR-02: The "trip proof" only exercises 3 of the 13 patched surfaces — 10 patches are never proven non-no-op

**File:** `tests/offline.spec.ts:123-130`

**Issue:** The self-validation test (the load-bearing anti-no-op check) only trips `fetch`, `net.connect`, and `dns.lookup`. The other ten patches — `net.createConnection`, `net.Socket.prototype.connect`, `http.request`, `http.get`, `https.request`, `https.get`, `dns.resolve`, `dns.promises.lookup`, `dns.promises.resolve`, `tls.connect` — are installed but never asserted to actually throw. If a refactor of `installEgressBlock` silently broke one of those patches (e.g. patched the wrong object, or a Node version moved the property), the self-validation test would still pass (because its 3 probes still trip) while that surface became a silent no-op. The proof would then claim coverage it no longer has.

**Fix:** Either assert each patched surface trips, or iterate the surfaces programmatically. Minimal version:
```ts
test("PRIV-01 self-validation: every patched surface throws", () => {
  expect(() => globalThis.fetch("http://x")).toThrow(OfflineViolationError);
  expect(() => net.connect(80, "x")).toThrow(OfflineViolationError);
  expect(() => net.createConnection({ port: 80 })).toThrow(OfflineViolationError);
  expect(() => http.request("http://x")).toThrow(OfflineViolationError);
  expect(() => http.get("http://x")).toThrow(OfflineViolationError);
  expect(() => https.request("https://x")).toThrow(OfflineViolationError);
  expect(() => https.get("https://x")).toThrow(OfflineViolationError);
  expect(() => dns.lookup("x", () => {})).toThrow(OfflineViolationError);
  expect(() => dns.resolve("x", () => {})).toThrow(OfflineViolationError);
  expect(() => tls.connect({ port: 443 })).toThrow(OfflineViolationError);
  // dns.promises.* throw synchronously here because the stub throws sync:
  expect(() => dns.promises.lookup("x")).toThrow(OfflineViolationError);
  expect(() => dns.promises.resolve("x")).toThrow(OfflineViolationError);
  expect(counter.n).toBe(12);
});
```

### WR-03: `prepublishOnly` no longer runs `attw`, weakening (but not breaking) the anti-stale/anti-wrong-types publish guarantee

**File:** `package.json:48` and `scripts/check-types.mjs:9-12`, `RELEASING.md:11-14`

**Issue:** `attw` was moved out of `prepublishOnly` (now only `npm run build && npm run lint:pack`). The justification (nested `npm pack` inside an in-progress `npm publish` lifecycle misbehaves on Windows) is legitimate. The anti-*stale*-dist guarantee survives because `prepublishOnly` rebuilds (`build`) and runs `publint`. However, the anti-*wrong-types* guarantee (the thing only `attw` catches — CJS/ESM masquerading, broken `require` type resolution) is now enforced **only in CI and in the manual RELEASING pre-flight**, not at the `npm publish` gate. If a maintainer publishes from a branch/state where CI has not run green and they skip the manual `npm run lint:types` pre-flight step, a types-resolution regression could ship. `publint` overlaps but does not fully substitute for `attw`'s dual-resolver check.

This is acceptable given the documented manual release process, but it is a real reduction in the automatic guarantee and the RELEASING.md prose ("you cannot ship a stale or unbuilt dist") should not be read as also covering type-resolution correctness.

**Fix:** Keep the move, but make the RELEASING.md pre-flight `lint:types` step non-skippable in practice — e.g. add a single combined `verify` script and reference only it in RELEASING.md:
```json
"verify": "npm run build && npm run typecheck && npm run lint:pack && npm run lint:types"
```
and have the human run `npm run verify` before `npm publish`. Optionally gate publish on a green CI commit SHA. Also clarify in RELEASING.md line 11-14 that the auto guard covers stale/unbuilt dist and publint shape, but type-resolution (`attw`) is the human pre-flight's responsibility.

## Info

### IN-01: CI floor-install of `@playwright/test@1.42.0` can be silently defeated by hoisting / peer resolution

**File:** `.github/workflows/ci.yml:55-56`

**Issue:** `npm install --no-save @playwright/test@1.42.0` after `npm ci` is intended to force the floor version. With npm's flat hoisting, this generally replaces the top-level `@playwright/test`, so the override usually does take. But there is no assertion that the floor version is the one actually loaded at test time. If npm ever kept 1.60 (peer-satisfied, deduped) the matrix would silently prove 1.60 twice and the `>=1.42` floor claim would be unproven while appearing green. Given the README/CHANGELOG/RELEASING all stake the honesty of the `>=1.42` floor on this leg, the leg should *prove* the resolved version.

**Fix:** Add a verification step after the override:
```yaml
- name: Assert resolved Playwright version
  run: |
    RESOLVED=$(node -p "require('@playwright/test/package.json').version")
    echo "resolved @playwright/test=$RESOLVED expected=${{ matrix.playwright }}"
    test "$RESOLVED" = "${{ matrix.playwright }}"
```

### IN-02: `npx playwright install` after the version override may install the wrong browser build for the floor leg

**File:** `.github/workflows/ci.yml:56-59`

**Issue:** The order is: override to `@playwright/test@1.42.0`, then `npx playwright install --with-deps chromium`. `npx playwright` resolves the `playwright` CLI from node_modules; after the `--no-save` override of `@playwright/test` (but not `playwright`), the CLI driving the browser download may not match the test runner's expected browser revision for 1.42. This usually works (Chromium download is tolerant) but can produce a subtle runner/browser-revision mismatch on the floor leg. Pin or verify if the floor leg ever shows browser-launch flakiness.

**Fix:** No change required if the floor leg passes green; if it flakes, install the browser via the matrix-pinned binary (`npx playwright@${{ matrix.playwright }} install` or install `playwright@<ver>` alongside `@playwright/test@<ver>`).

### IN-03: `nul-guard` network-import regex would miss dynamic `import()` and aliased/namespaced requires

**File:** `.github/workflows/nul-guard.yml:54-58`

**Issue:** The regex matches `from "node:net"` and `require( "node:net" )` forms after comment-stripping. It would not catch `await import("node:net")` (dynamic import — no `from`, no `require(`) nor `import * as net from "net"` (the un-prefixed `"net"` specifier, which Node also resolves). For a hardening guard the dynamic-import and bare-specifier escape hatches are worth closing, since the guarded invariant is "src/ never reaches the network." Low risk today (src/ is clean) but the guard advertises completeness.

**Fix:** Broaden the alternation to also catch dynamic import and bare specifiers:
```perl
exit(/(?:from|require\(\s*|import\(\s*)\s*["']node:(?:http|https|net|dns|tls)["']/ ? 0 : 1);
```
and consider also matching the non-`node:`-prefixed `"net"|"http"|...` specifiers.

### IN-04: NUL-guard `perl -0777 ... exit(/\x00/ ? 0 : 1)` is correct but relies on a non-obvious exit-code inversion

**File:** `.github/workflows/nul-guard.yml:32`

**Issue:** The check is sound: `perl ... exit(0)` on a NUL hit (success → recorded as a hit), `exit(1)` otherwise, and the `if perl ...; then` records the file when perl exits 0. The `-0777` slurp correctly reads the whole file so a NUL anywhere is caught, including binary-corrupted `.ts`. No false negative for the stated case (NUL in a tracked `src/`/`tests/` `.ts`). This is a no-defect note: the logic is correct but the inverted exit code is easy to misread on maintenance — a one-line comment stating "perl exits 0 when a NUL IS found" would prevent a future accidental inversion.

**Fix:** Add a clarifying inline comment:
```bash
# perl exits 0 (=hit) when a NUL byte is present, 1 otherwise; the `if` then records it.
if perl -0777 -ne 'exit(/\x00/ ? 0 : 1)' "$f"; then
```

---

_Reviewed: 2026-05-31_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
