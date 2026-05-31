---
status: partial
phase: 04-offline-verification-publish
source: [04-VERIFICATION.md]
started: 2026-05-31
updated: 2026-05-31
---

## Current Test

[awaiting human action — push to GitHub + run the matrix CI]

## Tests

### 1. CI compatibility matrix runs green on a real GitHub runner
expected: Pushing the repo to GitHub triggers `.github/workflows/ci.yml`. All matrix legs pass: node 22 and 24, each against `@playwright/test@1.42.0` and `@1.60.0`. The "Assert resolved @playwright/test version" step confirms the floor leg genuinely runs 1.42.0. The nul-guard workflow also passes.
result: [pending]
note: The floor `>=1.42` peer support is UNPROVEN until this runs. If the 1.42.0 legs fail, apply the honest-floor rule in RELEASING.md — raise the declared `peerDependencies` floor (and the README) to the lowest version that actually passes, rather than claiming false support.

### 2. First npm publish (the real release)
expected: After CI is green, follow RELEASING.md: run `npm run verify` (build + publint + attw + typecheck + tests), then `npm login` (with 2FA), then `npm publish --access public`. Confirm `selfmend@0.1.0` appears on npmjs.com and `npm view selfmend` resolves.
result: [pending]
note: Intentionally a human step (irreversible, needs the maintainer's npm auth). `npm publish --dry-run` is already green locally.

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps

(none — both items are human actions external to the codebase, not code defects)
