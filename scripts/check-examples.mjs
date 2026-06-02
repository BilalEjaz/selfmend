#!/usr/bin/env node
// Docs/example smoke check (the `check:examples` script).
//
// Proves ROADMAP Phase 7 criterion 3: every README recipe still compiles
// against the PUBLISHED selfmend API. The three example files under examples/
// are the single source of truth the README embeds, so if a recipe stops
// type-checking against the built package, this gate (and CI) goes red.
//
// It deliberately installs NO test framework: the Cucumber/Mocha/Jest hook
// symbols resolve through the type-only declarations in examples/shims, so the
// gate uses only the already-present tsc and the package's own dist/ types.
//
// Steps:
//   1. npm run build  -> produces dist/ so the examples can self-resolve the
//      "selfmend" package name through its exports map (the published types).
//   2. tsc -p tsconfig.examples.json (noEmit) -> type-checks the recipes
//      against those built types.
// Either failure exits non-zero (execSync throws, which propagates).

import { execSync } from "node:child_process";

// `shell: true` so npm's Windows `.cmd` shim spawns (Node refuses to spawn a
// `.cmd` directly without a shell). The command strings are fully static, with
// no interpolated or user input, so the shell is safe.
const run = (cmd) => execSync(cmd, { stdio: "inherit", shell: true });

// 1. Build the package so dist/ and the published types exist.
run("npm run build");

// 2. Type-check the examples against the built package.
run("npm exec -- tsc -p tsconfig.examples.json");

console.log("check:examples ok");
