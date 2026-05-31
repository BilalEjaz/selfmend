import { defineConfig, devices } from "@playwright/test";

/**
 * Dedicated config for the INNER integration specs under `tests/parallel/`
 * (CAP-02 cross-run, CAP-03 parallel merge, D-09 prune gate). The repo default
 * config (`playwright.config.ts`) stays workers:1 per project memory; this
 * config exists so the driver specs can spawn a child run with REAL concurrency
 * (`--workers=N`) and the selfmend reporter performs its end-of-run merge into
 * the SELFMEND_STORE_DIR temp dir the driver sets.
 *
 * Match `.pwspec.ts` (not `.spec.ts`) so the driver specs themselves (which live
 * in tests/ and would otherwise recurse) are never picked up here.
 */
export default defineConfig({
  testDir: "tests/parallel",
  testMatch: ["**/*.pwspec.ts"],
  // fullyParallel so each test can land on its own worker under --workers=N.
  fullyParallel: true,
  // The selfmend reporter (its onEnd merges all worker shards into the single
  // baseline.json under SELFMEND_STORE_DIR). list reporter for child-run logs.
  reporter: [["list"], ["./src/reporter/reporter.ts"]],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
