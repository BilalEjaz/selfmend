import { defineConfig } from "tsdown";

// Dual ESM + CJS build with type declarations.
// Offline-only: no network access in any build step (security property, T-01-02).
export default defineConfig({
  // Main entry (the import-swap surface) + the reporter subpath. The reporter
  // is a separate entry so `"selfmend/reporter"` resolves to a default-exporting
  // module (Playwright's reporter list expects `default`), while the main entry
  // stays named-only. Named keys flatten the output to `dist/index.*` and
  // `dist/reporter.*` (matching the package.json `exports` map).
  entry: { index: "src/index.ts", reporter: "src/reporter/reporter.ts" },
  format: ["esm", "cjs"],
  dts: true,
  // Publish build emits NO source maps: `files:[dist]` ships only `dist/`, so a
  // `.map` referencing un-shipped `src/` is dead weight (~130 kB) and a minor
  // source-path leak. publint/attw/pack stay green without them (Pitfall 5).
  sourcemap: false,
  clean: true,
  outDir: "dist",
  target: "node22",
  // @playwright/test is a peerDependency — never bundle it (T-01-03).
  deps: {
    neverBundle: ["@playwright/test"],
  },
});
