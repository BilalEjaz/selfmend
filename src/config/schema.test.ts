import { describe, it, expect } from "vitest";
import { configSchema } from "./schema.js";
import { defaultConfig } from "./defaults.js";

describe("configSchema", () => {
  it("parses an empty object to on-by-default conservative defaults", () => {
    // D-08: healing is ON by default. D-09: conservative threshold ~0.9.
    const cfg = configSchema.parse({});
    expect(cfg.enabled).toBe(true);
    expect(cfg.threshold).toBeGreaterThanOrEqual(0.85);
    expect(cfg.threshold).toBeLessThanOrEqual(0.95);
    expect(cfg.testIdAttr).toBe("data-testid");
  });

  it("parses { enabled: false } to a disabled config (CFG-01 toggle off)", () => {
    const cfg = configSchema.parse({ enabled: false });
    expect(cfg.enabled).toBe(false);
  });

  it("accepts an in-range threshold and overrides the default", () => {
    const cfg = configSchema.parse({ threshold: 0.75 });
    expect(cfg.threshold).toBe(0.75);
  });

  it("accepts the boundary threshold values 0 and 1", () => {
    expect(configSchema.parse({ threshold: 0 }).threshold).toBe(0);
    expect(configSchema.parse({ threshold: 1 }).threshold).toBe(1);
  });

  it("rejects a threshold above 1", () => {
    expect(() => configSchema.parse({ threshold: 1.5 })).toThrowError();
  });

  it("rejects a threshold below 0", () => {
    expect(() => configSchema.parse({ threshold: -0.1 })).toThrowError();
  });

  it("rejects a non-boolean enabled value", () => {
    expect(() => configSchema.parse({ enabled: "yes" })).toThrowError();
  });

  it("rejects a non-numeric threshold value", () => {
    expect(() => configSchema.parse({ threshold: "high" })).toThrowError();
  });

  it("rejects a non-string testIdAttr value", () => {
    expect(() => configSchema.parse({ testIdAttr: 123 })).toThrowError();
  });

  // --- margin gate config (CFG-02, D-01, D-07 global-only, D-08) ---

  it("defaults margin to 0.05 while leaving threshold at 0.9 (D-08, threshold not renamed)", () => {
    const cfg = configSchema.parse({});
    expect(cfg.margin).toBe(0.05);
    // D-08: the floor key keeps its name and conservative default.
    expect(cfg.threshold).toBe(0.9);
  });

  it("accepts an in-range margin and overrides the default", () => {
    expect(configSchema.parse({ margin: 0.1 }).margin).toBe(0.1);
  });

  it("accepts the boundary margin values 0 and 1", () => {
    expect(configSchema.parse({ margin: 0 }).margin).toBe(0);
    expect(configSchema.parse({ margin: 1 }).margin).toBe(1);
  });

  it("rejects a margin below 0 with a readable message (ASVS V5)", () => {
    expect(() => configSchema.parse({ margin: -0.1 })).toThrowError(
      /margin must be >= 0/,
    );
  });

  it("rejects a margin above 1 with a readable message (ASVS V5)", () => {
    expect(() => configSchema.parse({ margin: 1.5 })).toThrowError(
      /margin must be <= 1/,
    );
  });

  it("rejects a non-numeric margin with a readable message", () => {
    expect(() => configSchema.parse({ margin: "high" })).toThrowError(
      /margin must be a number/,
    );
  });
});

describe("defaultConfig", () => {
  it("round-trips through configSchema without modification", () => {
    expect(() => configSchema.parse(defaultConfig)).not.toThrow();
    expect(configSchema.parse(defaultConfig)).toEqual(defaultConfig);
  });

  it("is on-by-default with a conservative threshold (D-08, D-09)", () => {
    expect(defaultConfig.enabled).toBe(true);
    expect(defaultConfig.threshold).toBeGreaterThanOrEqual(0.85);
    expect(defaultConfig.threshold).toBeLessThanOrEqual(0.95);
    expect(defaultConfig.testIdAttr).toBe("data-testid");
  });
});
