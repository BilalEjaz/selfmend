# Releasing `selfmend`

The first release of `selfmend` is **manual** (D-06). CI proves the package is
publish-ready on every push/PR (build + lint + unit + integration + the PRIV-01
offline test + publint + attw + `npm pack`), but **CI holds no npm auth token
and never publishes** — there is no publish step and no registry secret in
`.github/workflows/ci.yml`. The maintainer runs the publish below by hand with
their own npm account. The actual `npm publish` is irreversible, so it is kept
out of automation for v1.

`prepublishOnly` (`npm run build && npm run lint:pack`) runs automatically on
`npm publish`, so the published `dist/` is always freshly built and publint-clean
— you cannot ship a stale or unbuilt `dist`. **Scope of the auto guard:** it
covers stale/unbuilt `dist` and publint package-shape only. The type-resolution
check (`attw`, via `npm run lint:types`) is deliberately NOT in `prepublishOnly`
— running a nested `npm pack` inside an in-progress `npm publish` lifecycle
misbehaves on Windows — so wrong-types / CJS-ESM-masquerade regressions are
caught by CI and by the **mandatory** `npm run verify` pre-flight below, not by
the `npm publish` gate itself. Do not skip the pre-flight.

---

## Pre-flight (verify locally before publishing)

First run the single combined gate. It is the non-skippable guard that runs the
build, package-shape lint (`publint`), the wrong-types check (`attw`, via
`lint:types`), the typecheck, and the unit tests in one command — so a local
publisher cannot omit the `attw` type-resolution check:

```sh
npm ci                  # clean install from the committed lockfile
npm run verify          # build + lint:pack + lint:types (attw) + typecheck + unit tests — ALL must pass
```

Then run the publish-readiness proof. Every step must be green and nothing is
published:

```sh
npm run lint:types      # attw -> all modern resolvers green (node10 ./reporter skull is ignored, expected)
npm pack --dry-run      # tarball MUST be dist/ + README.md + package.json ONLY (14 files; no src, tests, .env, .selfmend, or .map)
npm publish --dry-run   # MUST print "+ selfmend@0.1.0" and publish NOTHING
```

`npm run verify` already runs `build`, `lint:pack`, and `lint:types`; the steps
above re-run `lint:types` explicitly as the final types gate and add the
tarball-surface and dry-run checks. Do NOT run `npm publish` unless
`npm run verify` exited 0.

If `npm publish --dry-run` does not print `+ selfmend@0.1.0`, or the tarball
lists anything outside `dist/`, `README.md`, `package.json`, STOP and fix it
before continuing.

---

## Publish (the human step — irreversible)

```sh
npm login               # interactive; complete 2FA when prompted
npm whoami              # confirm you are publishing as the intended account
npm publish --access public
```

Notes:

- `selfmend` is an **unscoped** package, so public access is already the
  default — `--access public` is stated explicitly so the intent is
  unambiguous and the command still works verbatim if the package is ever
  moved under a scope.
- `npm publish` re-runs `prepublishOnly` (build + publint) before uploading, so
  the tarball is rebuilt from source at publish time.
- npm will prompt for your **2FA** one-time code (publish-level 2FA). There is
  no automated path for this — it is the human gate.

---

## Tag the release

```sh
git tag v0.1.0
git push --tags
```

(Optionally create a GitHub Release from the `v0.1.0` tag using the matching
`CHANGELOG.md` entry as the release notes.)

---

## Post-publish verification

```sh
npm view selfmend version            # should report 0.1.0
npm view selfmend dist.tarball       # the published tarball URL
```

Also confirm the package page renders on https://www.npmjs.com/package/selfmend
(README, version `0.1.0`, MIT license, the two entrypoints `.` and `./reporter`).

---

## Playwright compatibility floor — honest-floor rule

`package.json` declares `peerDependencies["@playwright/test"]: ">=1.49"`,
proven by the CI **matrix** (`node 22/24 × playwright 1.49.1/1.60.0`).

The original `1.42` floor was dropped after the CI matrix showed a real
incompatibility: on Playwright `1.42`, `expect()`'s stricter Locator detection
rejects selfmend's wrapped-locator Proxy (`"toBeVisible can be only used with
Locator object"`), which would break `expect(page.locator(...))` for actual
`1.42` users — not just our tests. Per the honest-floor rule we declare only
what CI proves green, so the floor was raised to `1.49`.

**Before the first publish, confirm the matrix is green on the declared floor.**
If a future floor leg fails, do the same: raise the declared `peerDependencies`
floor (and the README) to the lowest version that passes CI, then re-run the
pre-flight and publish. To probe a lower floor later, add candidate versions to
the matrix `playwright:` list and lower the declared floor only once green.
