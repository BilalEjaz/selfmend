import { defineConfig, devices } from "@playwright/test";

// Phase 1: single worker for the thinnest real heal on a simple case.
// Fully offline — fixtures are served from the local filesystem via file://.
// No dev server, no network. This offline guarantee is a security property.
export default defineConfig({
  testDir: "tests",
  // Pure-logic unit tests live in Vitest; keep them out of the Playwright runner.
  testIgnore: ["**/*.unit.test.ts"],
  workers: 1,
  fullyParallel: false,
  reporter: "list",
  // selfmend reporter slot — wired in plan 01-05:
  // reporter: [["list"], ["selfmend/reporter"]],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
