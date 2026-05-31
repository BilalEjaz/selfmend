#!/usr/bin/env node
// Portable `attw` type-resolution gate (the `lint:types` script).
//
// Why a script instead of bare `attw --pack`: `attw --pack` exits non-zero on
// the EXPECTED node10 skull (below), so a plain `attw --pack` cannot be a clean
// pass/fail gate without rule filtering. This script packs the tarball
// explicitly, points attw at it, and ignores only that one expected rule, so it
// is a deterministic green/red gate on every OS. It runs as the `lint:types`
// script (locally and in CI). It is intentionally NOT part of `prepublishOnly`:
// running any nested `npm pack` from inside an in-progress `npm publish`
// lifecycle yields zero/misplaced tarballs on Windows, so the publish-time
// guard is build + publint only; attw is the separate CI/local gate.
//
// We ignore the `no-resolution` rule because the ONLY instance is the EXPECTED
// legacy node10 skull on the `./reporter` subpath: node10 cannot resolve
// `exports` subpaths, and `engines.node` is `>=22`, so node10 support is
// intentionally not claimed (research Pitfall 4). Every modern resolver
// (node16 CJS/ESM, bundler) is green. If a non-node10 row ever regresses, attw
// reports a DIFFERENT rule and this gate fails as intended.

import { execSync } from "node:child_process";
import { readdirSync, rmSync } from "node:fs";

function packedTarballs() {
  return readdirSync(process.cwd()).filter(
    (f) => /^selfmend-.*\.tgz$/.test(f),
  );
}

// `shell: true` so npm's Windows `.cmd` shim spawns (Node refuses to spawn a
// `.cmd` directly without a shell since the EINVAL hardening). The command
// strings are fully static — no interpolated/user input — so the shell is safe.
const run = (cmd) => execSync(cmd, { stdio: "inherit", shell: true });

// Clean any stale tarball so we open exactly the one we pack now.
for (const f of packedTarballs()) rmSync(f, { force: true });

try {
  // Explicit pack -> a real .tgz in cwd.
  run("npm pack");
  const produced = packedTarballs();
  if (produced.length !== 1) {
    throw new Error(
      `expected exactly one selfmend-*.tgz after npm pack, found ${produced.length}: ${produced.join(", ")}`,
    );
  }
  const tarball = produced[0];

  // attw against the explicit tarball; ignore only the expected node10 skull.
  run(`npm exec -- @arethetypeswrong/cli ${tarball} --ignore-rules no-resolution`);
} finally {
  // Always remove the tarball we created, success or failure.
  for (const f of packedTarballs()) rmSync(f, { force: true });
}
