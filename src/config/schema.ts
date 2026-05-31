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

/**
 * Conservative default second-best margin gate (D-01, MATCH-03).
 *
 * The margin is the ABSOLUTE gap (same 0..1 score units as `threshold`) the top
 * candidate must beat the runner-up by before a heal is accepted; two
 * look-alike candidates within `margin` of each other are refused as ambiguous
 * rather than guessed at. `0.05` sits at the midpoint of the headroom above the
 * 0.9 floor: large enough to refuse genuine duplicates, small enough that a
 * sole survivor that beats structural also-rans still heals.
 *
 * Posture (same warning the threshold carries): RAISING the margin is safer
 * (refuses more); LOWERING it trades safety for green-ness. Global only (D-07).
 */
export const DEFAULT_MARGIN = 0.05;

/** Default attribute used to read a test-id signal from elements. */
export const DEFAULT_TEST_ID_ATTR = "data-testid";

/** Inclusive confidence bounds: a heal score is a probability in [0, 1]. */
const thresholdSchema = z
  .number({ message: "threshold must be a number" })
  .min(0, { message: "threshold must be >= 0" })
  .max(1, { message: "threshold must be <= 1" });

/** Inclusive margin bounds: the second-best gap is in the same [0, 1] units. */
const marginSchema = z
  .number({ message: "margin must be a number" })
  .min(0, { message: "margin must be >= 0" })
  .max(1, { message: "margin must be <= 1" });

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
  /**
   * D-01/D-07: global second-best margin gate in [0, 1]. The top candidate must
   * beat the runner-up by at least this absolute gap to heal (MATCH-03).
   */
  margin: marginSchema.default(DEFAULT_MARGIN),
  /** Attribute name read for the test-id fingerprint signal. */
  testIdAttr: z
    .string({ message: "testIdAttr must be a string" })
    .default(DEFAULT_TEST_ID_ATTR),
});

/** Fully-resolved config after defaults are applied. */
export type SelfmendConfig = z.infer<typeof configSchema>;
