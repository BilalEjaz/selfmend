/**
 * CAP-03 (parallel merge) + CAP-02 (cross-run persist-then-heal) DRIVER specs.
 *
 * These run under the DEFAULT config (workers:1). Each spawns a CHILD
 * `playwright test` against `playwright.parallel.config.ts` with a fresh
 * SELFMEND_STORE_DIR temp dir, so the child's worker fixtures flush real shards
 * and the child's selfmend reporter performs its end-of-run merge into ONE
 * baseline.json. The driver then inspects that committed file.
 *
 * SELFMEND_STORE_DIR is passed as a path RELATIVE to the repo root: persistence
 * resolves the override under rootDir (stripping any escape), so a relative
 * `.tmp-...` dir lands at `<repo>/.tmp-...` and never touches the repo's real
 * `.selfmend/baseline.json`. The driver removes the temp dir afterwards.
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

// The inner parallel config's FullConfig.rootDir is its testDir (tests/parallel),
// and persistence resolves SELFMEND_STORE_DIR relative to that rootDir. So the
// temp store dir is created UNDER tests/parallel and the child is handed its
// basename; the resolved store is `tests/parallel/<basename>` for both the
// worker shard flush and the reporter merge.
const PARALLEL_ROOT = join(REPO_ROOT, "tests", "parallel");

// Resolve the Playwright CLI JS entry and drive it with the SAME node binary
// (process.execPath). Avoids the Windows `npx.cmd` spawnSync EINVAL (a .cmd
// needs a shell) and any PATH ambiguity — fully deterministic, offline.
const require = createRequire(import.meta.url);
const PW_CLI = require.resolve("@playwright/test/cli");

/** Make a fresh temp store dir under the inner rootDir; return abs + basename. */
function makeStoreDir(): { abs: string; rel: string } {
  const abs = mkdtempSync(join(PARALLEL_ROOT, ".tmp-store-"));
  return { abs, rel: relative(PARALLEL_ROOT, abs) };
}

/** Run the inner parallel config as a child process; throws on non-zero exit. */
function runChild(args: string[], env: Record<string, string>): void {
  execFileSync(
    process.execPath,
    [PW_CLI, "test", "--config", PARALLEL_CONFIG, ...args],
    {
      cwd: REPO_ROOT,
      env: { ...process.env, ...env },
      stdio: "pipe",
      timeout: 120_000,
    },
  );
}

test("CAP-03: a real workers>1 run merges every worker's capture into one valid baseline", () => {
  const store = makeStoreDir();
  try {
    // Real concurrency: 4 capture tests across 4 workers, each flushing its own
    // parallelIndex shard; the child reporter merges them into baseline.json.
    runChild(["capture.pwspec.ts", "--workers=4"], {
      SELFMEND_STORE_DIR: store.rel,
    });

    const baselineFile = join(store.abs, "baseline.json");
    expect(existsSync(baselineFile)).toBe(true);

    const raw = JSON.parse(readFileSync(baselineFile, "utf8"));
    const parsed = parseBaseline(raw);
    // A non-empty parse means the file is valid against the committed schema
    // (version + derived-signals-only entries). Corruption / partial writes
    // would fail the schema and parse to EMPTY.
    const keys = Object.keys(parsed.entries);
    // capture.pwspec.ts captures 4 distinct targets -> 4 distinct keys, no loss.
    expect(keys.length).toBe(4);

    // The merged file carries no raw DOM (derived signals only, D-02): the
    // strict schema would have rejected any innerHTML/outerHTML leak to EMPTY.
    expect(raw.version).toBe(1);
    for (const fp of Object.values(parsed.entries)) {
      expect(typeof fp.testId).toBe("string");
      expect(fp).not.toHaveProperty("innerHTML");
      expect(fp).not.toHaveProperty("outerHTML");
    }
  } finally {
    rmSync(store.abs, { recursive: true, force: true });
  }
});

test("CAP-02: a fingerprint captured in run N heals in run N+1 from the committed file alone", () => {
  const store = makeStoreDir();
  try {
    // Run N: capture .btn-primary on index.html -> persisted to baseline.json.
    runChild(["crossrun.pwspec.ts", "--workers=1"], {
      SELFMEND_STORE_DIR: store.rel,
      SELFMEND_CROSSRUN_PHASE: "capture",
    });

    const baselineFile = join(store.abs, "baseline.json");
    expect(existsSync(baselineFile)).toBe(true);
    const afterCapture = parseBaseline(JSON.parse(readFileSync(baselineFile, "utf8")));
    expect(Object.keys(afterCapture.entries).length).toBeGreaterThanOrEqual(1);

    // Run N+1: a FRESH process. The worker loads ONLY baseline.json; the broken
    // .btn-primary click heals from the loaded fingerprint. If the child exits
    // 0, every assertion in the heal-phase test passed (heal occurred, score
    // >= floor, healed target is the Submit button) -> CAP-02 proven.
    runChild(["crossrun.pwspec.ts", "--workers=1"], {
      SELFMEND_STORE_DIR: store.rel,
      SELFMEND_CROSSRUN_PHASE: "heal",
    });
  } finally {
    rmSync(store.abs, { recursive: true, force: true });
  }
});
