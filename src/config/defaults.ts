import { configSchema, type SelfmendConfig } from "./schema.js";

/**
 * The default `selfmend` configuration, produced by parsing an empty object
 * through {@link configSchema}. Deriving it from the schema (rather than
 * hand-writing the values) guarantees the defaults always satisfy the schema
 * and stay in sync with it.
 *
 * Posture: on-by-default (D-08) with a conservative threshold (D-09).
 */
export const defaultConfig: SelfmendConfig = configSchema.parse({});
