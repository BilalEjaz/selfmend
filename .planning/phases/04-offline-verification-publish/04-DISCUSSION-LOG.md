# Phase 4: Offline Verification & Publish - Discussion Log

> **Audit trail only.** Decisions are captured in CONTEXT.md; this log preserves the alternatives considered.

**Date:** 2026-05-31
**Phase:** 4-Offline Verification & Publish
**Areas discussed:** Publish-for-real vs prepare-only, Offline-proof rigor, CI / release automation, README / docs scope

---

## Publish posture & version

| Option | Description | Selected |
|--------|-------------|----------|
| Prepare + dry-run, human publishes (0.1.0) | publish-ready + npm publish --dry-run; human runs real publish | ✓ |
| Prepare, first version 1.0.0 | same but commit to 1.0.0 semver stability | |
| Fully automate publish via CI | Changesets + NPM_TOKEN auto-publish | |

**User's choice:** Prepare + dry-run, version 0.1.0, human runs the final `npm publish`.
**Notes:** Real publish is irreversible and needs the user's npm auth — out of scope for the agent. 0.1.0 signals pre-1.0/iterating.

---

## Offline proof (PRIV-01)

| Option | Description | Selected |
|--------|-------------|----------|
| Runtime network-block test | stub net/http/https/dns/fetch to throw; run capture+heal+merge; assert zero egress | ✓ |
| Network-disabled CI job | unshare/no-egress container | |
| Both | runtime + CI container | |

**User's choice:** Runtime network-block test.
**Notes:** Portable (Windows + any CI), deterministic, no special infra. Offline-by-construction already holds (no network/AI/telemetry deps).

---

## CI / release automation

| Option | Description | Selected |
|--------|-------------|----------|
| Full CI, manual release | GH Actions lint+unit+integration+offline+pack+publint+attw + PW-version matrix; manual publish | ✓ |
| Full CI + Changesets auto-release | above + tag-triggered publish with NPM_TOKEN | |
| Minimal / local-only | local scripts only | |

**User's choice:** Full CI, manual release.
**Notes:** Strong regression net + compatibility matrix (floor >=1.42 and 1.60) without handing CI publish rights.

---

## README / docs scope

| Option | Description | Selected |
|--------|-------------|----------|
| Quickstart + trust model + limitations | install/swap + config ref + trust model + committed-baseline workflow + honest limitations | ✓ |
| Quickstart only | minimal README | |
| Full docs site | extended guides + contributing | |

**User's choice:** Quickstart + config reference + trust model + committed-baseline workflow + honest limitations (WR-03/WR-04, locator-only, Playwright-only).

---

## Claude's Discretion

- Network-block test internals, GH Actions YAML/matrix shape, CHANGELOG format, README structure, optional `.gitattributes`/pre-commit NUL guard. No new runtime deps; keep files:[dist].

## Required task (not discussed)

- D-08: regenerate package-lock.json via clean `npm install` before pack/publish (P3 npm-install crash + hand-installed @types/node left the lockfile stale).

## Deferred Ideas

- The real `npm publish` (human step).
- Changesets / auto-publish (later-maybe).
- Network-disabled CI container.
- Docs site.
- Dedicated WR-03 / WR-04 fixes.
