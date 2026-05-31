---
phase: 04-offline-verification-publish
plan: 01
subsystem: offline-proof + supply-chain integrity
tags: [PRIV-01, offline, lockfile, ci-guard, tdd]
requires:
  - "Phase 1-3 heal core (capture -> score -> decide -> rebind) frozen and green"
  - "healingFixture page override + HEAL_ATTACHMENT_NAME wire contract"
provides:
  - "Committed package-lock.json (reproducible npm ci install contract, D-08)"
  - "tests/offline.spec.ts — the canonical self-validating PRIV-01 zero-egress proof (D-03)"
  - ".gitattributes + nul-guard CI workflow (NUL-byte + no-network-import integrity gate, D-04/D-07)"
affects:
  - "CI (a new standalone nul-guard workflow runs on push/PR)"
  - "All future installs (npm ci now resolves from the committed lockfile)"
tech-stack:
  added:
    - "perl-based portable NUL detection in CI (grep -P unavailable across runner locales)"
  patterns:
    - "Per-test throw-on-egress block (beforeEach install / afterEach restore), NEVER globalSetup"
    - "Self-validating security test: prove the harness trips before asserting the negative"
key-files:
  created:
    - "tests/offline.spec.ts"
    - ".gitattributes"
    - ".github/workflows/nul-guard.yml"
  modified:
    - "package-lock.json (committed; was untracked)"
decisions:
  - "PRIV-01 proven mechanically by a per-test Node-API egress block + a self-validation trip, not asserted"
  - "Blanket throw-on-egress is browser-safe (Chromium CDP is a child_process stdio pipe, not Node net) — no loopback allowlist"
  - "NUL guard uses perl slurp-mode match (portable) instead of grep -P; comments stripped before the network-import count so prose cannot self-trip"
metrics:
  duration: "~9 min"
  completed: "2026-05-31"
  tasks: 3
  files: 4
---

# Phase 4 Plan 01: Offline Proof + Lockfile + Source-Integrity Guard Summary

Committed the reproducible lockfile, landed the canonical self-validating PRIV-01 zero-network-egress heal-cycle test, and added a portable NUL-byte + no-network-import CI guard — all three gating prerequisites for the publish, with the heal core untouched.

## What Was Built

### Task 1 — Committed the regenerated `package-lock.json` (D-08) — commit `d45a4ad`
The lockfile produced by the research pass's clean `rm -rf node_modules && npm install` was present untracked. Verified it is the verbatim install output (lockfileVersion 3, `@types/node` 24.12.4, `@playwright/test` 1.60.0), ran `npm ci` against it (exit 0, "added 146 packages"), and confirmed `git status --porcelain package-lock.json` stayed `??` afterward — i.e. `npm ci` did NOT modify the lockfile, proving reproducibility. Staged and committed only that file (no hand-edits, which would re-trigger the arborist null/children crash per D-08).

### Task 2 — PRIV-01 self-validating offline heal-cycle test (D-03) — commit `33d478d`
`tests/offline.spec.ts`, modeled on `tests/heal.spec.ts`. `installEgressBlock(counter)` patches `net.connect`/`createConnection`, `net.Socket.prototype.connect`, `http.request`/`get`, `https.request`/`get`, `dns.lookup`/`resolve` (+ `dns.promises`), `tls.connect`, and `globalThis.fetch` to increment a counter and throw `OfflineViolationError`; it returns a `restore()` that reverts every patch in reverse. Installed per-test in `beforeEach`, restored in `afterEach` (never globalSetup, which would block the CI browser download).

Two tests:
1. **Self-validation** — with the block installed, calls `fetch`/`net.connect`/`dns.lookup` directly and asserts each THROWS `OfflineViolationError` and the counter increments. This proves the harness genuinely trips, so the zero-egress assertion can never be a silent pass.
2. **PRIV-01 heal cycle** — runs the real capture+heal flow (goto index.html -> `.btn-primary` waitFor capture -> goto broken.html -> `.click({timeout:1200})` heals green at score 1.00, `HEAL_ATTACHMENT_NAME` present, score >= 0.9), then asserts `counter.n === 0`.

`npx playwright test tests/offline.spec.ts` -> 2 passed. The blanket throw did not break Chromium (confirming the research finding that CDP is a stdio pipe, not Node net).

### Task 3 — NUL-byte + no-network-import source guard (D-04/D-07) — commit `47276ed`
- `.gitattributes`: `* text=auto eol=lf` plus explicit `text eol=lf` for `.ts/.tsx/.js/.json/.md/.yml/.html` and the lockfile, so accidental binary/NUL corruption surfaces in diffs (two Phase 3 incidents).
- `.github/workflows/nul-guard.yml`: a standalone push/PR job (separate from the future matrix CI) with two steps:
  - **NUL guard** — iterates tracked `src/**/*.ts` and `tests/**/*.ts`, fails if any contains a raw NUL byte.
  - **Offline-by-construction guard (D-04)** — fails if any `src/**/*.ts` imports `node:http/https/net/dns/tls`, after stripping `//` and `/* */` comments so prose/doc-comments cannot self-trip or self-excuse the gate.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Portable NUL detection — `grep -P` unusable**
- **Found during:** Task 3 (verifying the guard logic locally before commit)
- **Issue:** The plan's verify and a first-draft workflow used `grep -P '\x00'` (and `git grep -Il $NUL`). Both are non-portable: the local Git Bash grep rejects `-P` ("supports only unibyte and UTF-8 locales") regardless of `LC_ALL`, and `git grep` with a NUL pattern drops the byte through bash command substitution. A guard that errors out instead of matching would silently never catch a NUL.
- **Fix:** Replaced the NUL detector with `perl -0777 -ne 'exit(/\x00/ ? 0 : 1)'` (slurp-mode, works on every CI runner and locally) and the network-import detector with a comment-stripping perl one-liner. Verified locally: passes the clean tree, CATCHES a planted NUL, TRIPS real imports/requires, and IGNORES commented mentions.
- **Files modified:** `.github/workflows/nul-guard.yml`
- **Commit:** `47276ed`

**2. [Rule 1 - Bug] Network-import regex missed `import x from "node:net"`**
- **Found during:** Task 3 verification (comment-filter soundness check)
- **Issue:** The first regex `(?:from|require\()...["']node:...` required the quote to immediately follow `from`, so a normal `import net from "node:net";` (space before the quote) did not trip — a false-negative that would let a real network import through.
- **Fix:** Added `\s*` before the opening quote: `(?:from|require\(\s*)\s*["']node:(...)["']`. Re-verified all four cases (real import, real require, mixed file, commented mention) behave correctly and the live `src/` reports zero offenders.
- **Files modified:** `.github/workflows/nul-guard.yml`
- **Commit:** `47276ed`

## Authentication Gates

None.

## Verification

- `npm ci` exits 0 from the committed lockfile and leaves it unmodified (reproducible).
- `npx playwright test tests/offline.spec.ts` -> 2 passed (self-validation trips; heal cycle green at egress === 0).
- `npm test` (vitest) -> 125 passed; `npm run test:e2e` -> 23 passed (incl. the new PRIV-01 test) — no regression.
- `npx tsc --noEmit` -> exit 0 (new test typechecks).
- NUL guard verified locally: clean tree passes, a planted NUL is caught, real network imports trip, commented mentions stay clean, current `src/` has zero offenders.

## Known Stubs

None — all deliverables are wired and exercised by passing tests.

## Notes for Downstream

- The store/merge offline guarantee (the "+ merge" half of D-03) is proven STATICALLY by the Task 3 network-import guard plus the existing parallel-store specs (persistence.ts imports only `node:fs`/`node:path`), per research Open Q1 — no separate merge-offline test was added (do-not-over-build).
- No version bump and no real publish (those are Plan 02 / the human step, D-01/D-02).

## Self-Check: PASSED

All created files exist on disk (`tests/offline.spec.ts`, `.gitattributes`, `.github/workflows/nul-guard.yml`, `package-lock.json` tracked, `04-01-SUMMARY.md`) and all three task commits (`d45a4ad`, `33d478d`, `47276ed`) are present in git history.
