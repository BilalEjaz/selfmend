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
— you cannot ship a stale or unbuilt `dist`.

---

## Pre-flight (verify locally before publishing)

Run the publish-readiness proof. Every step must be green and nothing is
published:

```sh
npm ci                  # clean install from the committed lockfile
npm run build           # tsdown -> dist (exit 0)
npm run lint:pack       # publint -> "All good!"
npm run lint:types      # attw -> all modern resolvers green (node10 ./reporter skull is ignored, expected)
npm pack --dry-run      # tarball MUST be dist/ + README.md + package.json ONLY (14 files; no src, tests, .env, .selfmend, or .map)
npm publish --dry-run   # MUST print "+ selfmend@0.1.0" and publish NOTHING
```

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

`package.json` declares `peerDependencies["@playwright/test"]: ">=1.42"`. The
floor leg (`@playwright/test@1.42.0`) is proven by the CI **matrix**
(`node 22/24 × playwright 1.42.0/1.60.0`), not on the author's machine (only
1.60 is installed locally). **Before the first publish, confirm the matrix has
run green on `1.42.0`.** If the `1.42.0` leg fails, do NOT claim false support:
raise the declared `peerDependencies` floor (and the README) to the lowest
version that actually passes CI, then re-run the pre-flight and publish.
