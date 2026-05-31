import { defineConfig } from "vitest/config";

// Vitest covers pure-logic only (scoring, config parsing, fingerprint diff).
// Browser-dependent tests live in the Playwright runner, not here.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
