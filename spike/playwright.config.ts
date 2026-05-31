/**
 * THROWAWAY SPIKE CONFIG — DELETE with the rest of spike/ after plan 04.
 *
 * The root playwright.config.ts pins testDir: "tests" (the real integration suite lives there),
 * which excludes spike/. Rather than pollute the production config, the spike carries its own
 * config so the proof harness is fully self-contained.
 *
 * Run: npx playwright test --config=spike/playwright.config.ts
 */
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  workers: 1,
  fullyParallel: false,
  reporter: "list",
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
