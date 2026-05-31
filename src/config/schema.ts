import { z } from "zod";

/**
 * Conservative default heal-confidence threshold (D-09).
 *
 * Posture: "lean safe" — heal only when very confident, and prefer leaving a
 * locator unhealed over healing to the wrong element. The exact number is a
 * documented default (assumption A2); calibration against the literature
 * (Similo, Healenium) and benchmarks happens in Phase 2.
 */
export const DEFAULT_THRESHOLD = 0.9;

/** Default attribute used to read a test-id signal from elements. */
export const DEFAULT_TEST_ID_ATTR = "data-testid";

/** Inclusive confidence bounds: a heal score is a probability in [0, 1]. */
const thresholdSchema = z
  .number({ message: "threshold must be a number" })
  .min(0, { message: "threshold must be >= 0" })
  .max(1, { message: "threshold must be <= 1" });

/**
 * The single source of truth for `selfmend` plugin configuration.
 *
 * All user-supplied config crosses a trust boundary (T-01-01) and is validated
 * here: out-of-range thresholds and wrong types are rejected with readable zod
 * messages rather than silently coerced (ASVS V5 input validation).
 */
export const configSchema = z.object({
  /** D-08: healing is ON by default; set to false to disable (CFG-01). */
  enabled: z
    .boolean({ message: "enabled must be a boolean" })
    .default(true),
  /** D-09: conservative heal-confidence floor in [0, 1]. */
  threshold: thresholdSchema.default(DEFAULT_THRESHOLD),
  /** Attribute name read for the test-id fingerprint signal. */
  testIdAttr: z
    .string({ message: "testIdAttr must be a string" })
    .default(DEFAULT_TEST_ID_ATTR),
});

/** Fully-resolved config after defaults are applied. */
export type SelfmendConfig = z.infer<typeof configSchema>;
