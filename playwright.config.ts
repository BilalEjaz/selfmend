import { defineConfig, devices } from "@playwright/test";

// Phase 1: single worker for the thinnest real heal on a simple case.
// Fully offline — fixtures are served from the local filesystem via file://.
// No dev server, no network. This offline guarantee is a security property.
export default defineConfig({
  testDir: "tests",
  // Pure-logic unit tests live in Vitest; keep them out of the Playwright runner.
  // The INNER integration specs under tests/parallel/ are driven by the
  // parallel-store / prune driver specs via a child run against
  // playwright.parallel.config.ts, so the default suite must NOT pick them up.
  testIgnore: ["**/*.unit.test.ts", "parallel/**"],
  workers: 1,
  fullyParallel: false,
  // selfmend's summary-only reporter (REP-01) runs alongside the list reporter:
  // it reads `selfmend-heal` attachments and prints the boxed heal summary at
  // end of run. Pointed at the local source here; consumers add the published
  // reporter export (see README) to their own config.
  reporter: [["list"], ["./src/reporter/reporter.ts"]],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
