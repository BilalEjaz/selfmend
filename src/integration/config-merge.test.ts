import { describe, it, expect } from "vitest";

import { resolveConfig } from "./wrap-page.js";
import { defaultConfig } from "../config/defaults.js";

/**
 * The config merge (Claude's discretion, CONTEXT): a `Partial<SelfmendConfig>`
 * supplied to `wrapPage` is resolved over `defaultConfig` THROUGH `configSchema`
 * so other keys default and out-of-range values are rejected with the schema's
 * readable error (T-05-03 / ASVS V5 input validation). An empty/absent partial
 * yields exactly `defaultConfig` (no silent drift).
 */
describe("config merge (resolveConfig, T-05-03)", () => {
  it("an empty partial yields exactly defaultConfig", () => {
    expect(resolveConfig({})).toEqual(defaultConfig);
  });

  it("an absent partial yields exactly defaultConfig", () => {
    expect(resolveConfig()).toEqual(defaultConfig);
  });

  it("a partial merges over defaults, defaulting the other keys", () => {
    const merged = resolveConfig({ threshold: 0.5 });
    expect(merged.threshold).toBe(0.5);
    // Untouched keys fall back to the defaults.
    expect(merged.enabled).toBe(defaultConfig.enabled);
    expect(merged.margin).toBe(defaultConfig.margin);
    expect(merged.testIdAttr).toBe(defaultConfig.testIdAttr);
  });

  it("validates through the schema: an out-of-range value is rejected", () => {
    // 1.5 is above the [0,1] threshold bound -> the schema throws its readable
    // error rather than silently coercing (no false confidence floor).
    expect(() => resolveConfig({ threshold: 1.5 })).toThrow();
  });

  it("validates through the schema: a wrong-typed value is rejected", () => {
    // A non-number threshold crosses the validation boundary and is rejected.
    expect(() =>
      resolveConfig({ threshold: "high" as unknown as number }),
    ).toThrow();
  });
});
