// Public entry point for the `selfmend` package (import path per D-02).
//
// The one-line import swap (D-03): a consumer changes
//
//     import { test, expect } from "@playwright/test";
// to
//     import { test, expect } from "selfmend";
//
// and every test using this `test` becomes healing-aware — no test rewrites,
// existing `page`/locator/`expect` usage is unchanged (INST-01/INST-02). This
// is the package `exports` entry (package.json) for both `import` and `require`.

// `test` = the base @playwright/test test extended with the healing fixture.
// `healingFixture` IS that extended test object; re-exporting it as `test` makes
// the import swap a true drop-in. (D-03)
export { healingFixture as test } from "./integration/fixture.js";

// Composable fixture export (D-04): teams that already maintain their own
// `test.extend` can merge selfmend's healing into their fixtures instead of
// adopting the bare re-exported `test`.
export { healingFixture } from "./integration/fixture.js";
export type { SelfmendWorkerFixtures } from "./integration/fixture.js";

// `expect` is re-exported unchanged so the swap is truly one line. Assertions
// are NOT routed through the heal path (action-method partition, plan 04) —
// `expect` here is exactly @playwright/test's `expect`.
export { expect } from "@playwright/test";

// The summary-only reporter (REP-01). Consumers add it to their Playwright
// config's `reporter` list (see README) to get the end-of-run boxed heal
// summary. Exposed as a NAMED export only — a mixed default+named entry forces
// CJS consumers onto `.default`, so we keep the entry named-only for clean
// `import`/`require` ergonomics. Playwright's reporter list resolves the class
// via the package subpath `"selfmend/reporter"` (see package.json exports).
export { default as SelfmendReporter } from "./reporter/reporter.js";

// Config surface (CFG-01): the validated schema, its resolved type, and the
// on-by-default defaults (D-08/D-09). `SelfmendConfig` is the type a consumer
// uses with `test.use({ selfmendConfig })`.
export { configSchema, type SelfmendConfig } from "./config/schema.js";
export { defaultConfig } from "./config/defaults.js";

// Heal-event transport shape, for consumers building their own reporting on top
// of the `selfmend-heal` attachments. The union + both arms are PUBLIC so a
// consumer can type `onHeal` (the wrapPage opt below takes a SelfmendEvent).
export {
  HEAL_ATTACHMENT_NAME,
  type HealEvent,
  type HealedEvent,
  type RefusedEvent,
  type SelfmendEvent,
  attachHealEvent,
} from "./integration/events.js";

// The standalone boxed-summary renderer (OUT-02): render the SAME boxed heal
// summary the @playwright/test reporter prints, from a flat array of collected
// SelfmendEvents, with no reporter. Byte-identical to the reporter because both
// call this one shared pure function. It is the output counterpart to onHeal
// (OUT-01): collect events off onHeal, then renderHealSummary(events).
export { renderHealSummary } from "./reporter/render.js";

// The runner-agnostic core (WRAP-01/02/03, D-01/D-02): wrap ANY Playwright Page
// outside the @playwright/test fixture (Cucumber, Mocha, a plain script). The
// fixture is one adapter on the same seam.
//
//   import { wrapPage, resetScope } from "selfmend";
//   this.page = wrapPage(rawPage, { store, scope: () => ({ suite, test }) });
//
// `wrapPage` returns the BARE wrapped Page (drop-in, D-01); `resetScope(page)`
// forces an occurrence reset for same-scope retries (WeakMap-backed, D-06).
export {
  wrapPage,
  resetScope,
  type WrapPageOptions,
  type Scope,
  type ScopeSource,
} from "./integration/wrap-page.js";

// The store type a consumer constructs and passes to `wrapPage({ store })`.
export { BaselineStore } from "./store/store.js";

// Standalone persistence building blocks (STORE-01/02/03): persist + reload a
// baseline at a LITERAL file path the consumer owns, and merge per-worker
// baselines deterministically, all decoupled from the reporter and shard
// machinery. `saveBaseline` is refresh-and-add only (never auto-prunes);
// `mergeBaselines` is order-independent over overlapping and disjoint inputs.
export { loadBaseline, saveBaseline } from "./store/persistence.js";
export { mergeBaselines } from "./store/merge.js";
