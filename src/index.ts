// Public entry point for the `selfmend` package (import path per D-02).
// The healing test fixture + reporter are wired in later plans of this phase.
// For now we export the validated config surface (built test-first in 01-01).
export {
  configSchema,
  type SelfmendConfig,
} from "./config/schema.js";
export { defaultConfig } from "./config/defaults.js";
