import { defineConfig } from "tsdown";

// Dual ESM + CJS build with type declarations.
// Offline-only: no network access in any build step (security property, T-01-02).
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  outDir: "dist",
  target: "node22",
  // @playwright/test is a peerDependency — never bundle it (T-01-03).
  deps: {
    neverBundle: ["@playwright/test"],
  },
});
