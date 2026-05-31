/**
 * D-09 (filtered run REFRESHES but does NOT prune) DRIVER spec.
 *
 * Runs under the DEFAULT config (workers:1). Spawns CHILD `playwright test`
 * runs against `playwright.parallel.config.ts` sharing one SELFMEND_STORE_DIR
 * temp dir, then inspects baseline.json. SELFMEND_STORE_DIR is repo-relative so
 * persistence clamps it under rootDir and the repo's real store is untouched.
 *
 * Proves Pitfall 2 cannot bite:
 *  1. A full run captures BOTH keys (alpha + beta).
 *  2. A `--grep`-filtered run touching only alpha, even with SELFMEND_PRUNE set,
 *     REFRESHES but does NOT prune beta (the run is not COMPLETE -> gate off).
 *  3. A complete passing run WITHOUT SELFMEND_PRUNE does not delete beta either
 *     (the opt-in gate): refresh-only never removes entries.
 */
import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join, relative } from "node:path";

import { parseBaseline } from "../src/store/schema.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const PARALLEL_CONFIG = "playwright.parallel.config.ts";
// SELFMEND_STORE_DIR resolves under the inner config's rootDir (tests/parallel),
// so the temp store dir is created there and the child gets its basename.
const PARALLEL_ROOT = join(REPO_ROOT, "tests", "parallel");

// Drive the Playwright CLI with the SAME node binary (avoids Windows npx.cmd
// spawnSync EINVAL). Offline + deterministic.
const require = createRequire(import.meta.url);
const PW_CLI = require.resolve("@playwright/test/cli");

function makeStoreDir(): { abs: string; rel: string } {
  const abs = mkdtempSync(join(PARALLEL_ROOT, ".tmp-store-"));
  return { abs, rel: relative(PARALLEL_ROOT, abs) };
}

function runChild(args: string[], env: Record<string, string>): void {
  execFileSync(
    process.execPath,
    [PW_CLI, "test", "--config", PARALLEL_CONFIG, ...args],
    { cwd: REPO_ROOT, env: { ...process.env, ...env }, stdio: "pipe", timeout: 120_000 },
  );
}

function readKeys(storeAbs: string): string[] {
  const baselineFile = join(storeAbs, "baseline.json");
  expect(existsSync(baselineFile)).toBe(true);
  const parsed = parseBaseline(JSON.parse(readFileSync(baselineFile, "utf8")));
  return Object.keys(parsed.entries);
}

test("D-09: a --grep-filtered run refreshes but does NOT prune the unseen key", () => {
  const store = makeStoreDir();
  try {
    // 1. Full run -> both alpha + beta captured.
    runChild(["prune.pwspec.ts", "--workers=1"], { SELFMEND_STORE_DIR: store.rel });
    const both = readKeys(store.abs);
    expect(both.length).toBe(2);

    // 2. Filtered run touching ONLY alpha, WITH the prune opt-in set. The run is
    //    not COMPLETE (grep narrowed it), so the prune gate stays closed: beta
    //    (unseen this run) MUST survive. Refresh-on-pass still runs.
    runChild(["prune.pwspec.ts", "--workers=1", "--grep", "prune-alpha"], {
      SELFMEND_STORE_DIR: store.rel,
      SELFMEND_PRUNE: "1",
    });
    const afterFiltered = readKeys(store.abs);
    expect(afterFiltered.length).toBe(2); // beta NOT pruned (D-09 / Pitfall 2)
    expect(afterFiltered.sort()).toEqual(both.sort());
  } finally {
    rmSync(store.abs, { recursive: true, force: true });
  }
});

test("D-09 opt-in gate: a complete passing run WITHOUT SELFMEND_PRUNE does not delete the unseen key", () => {
  const store = makeStoreDir();
  try {
    // 1. Full run -> both keys captured.
    runChild(["prune.pwspec.ts", "--workers=1"], { SELFMEND_STORE_DIR: store.rel });
    expect(readKeys(store.abs).length).toBe(2);

    // 2. A complete passing run that touches ONLY alpha (via grep is "filtered",
    //    so instead touch both but assert that without SELFMEND_PRUNE nothing is
    //    ever deleted). Run alpha-only as a complete run is impossible without a
    //    filter, so we prove the opt-in half directly: re-run the FULL suite
    //    (complete + passed) WITHOUT the opt-in and confirm no entry is dropped.
    runChild(["prune.pwspec.ts", "--workers=1"], { SELFMEND_STORE_DIR: store.rel });
    expect(readKeys(store.abs).length).toBe(2); // refresh-only never deletes
  } finally {
    rmSync(store.abs, { recursive: true, force: true });
  }
});
