import type { TestInfo } from "@playwright/test";

/**
 * Heal-event transport (the sanctioned worker -> main channel).
 *
 * Custom worker<->main IPC is unavailable in Playwright (issue #31559), so the
 * heal loop serializes each accepted heal as a `testInfo.attach` attachment.
 * The Phase-1 reporter (plan 05) reads these attachments off `TestResult` in
 * `onTestEnd` and renders the boxed end-of-run summary (REP-01).
 *
 * This module is intentionally thin: it owns the on-the-wire {@link HealEvent}
 * shape and the single `attach` call. It carries derived audit fields only
 * (selectors + score), never DOM content, so nothing sensitive crosses the
 * process boundary (T-04-02).
 */

/** The attachment name the reporter looks for. Part of the wire contract. */
export const HEAL_ATTACHMENT_NAME = "selfmend-heal";

/**
 * One accepted heal, as it crosses the worker -> main boundary. This is the
 * transport/report view (test name + before/after selector + confidence), as
 * distinct from the pure `HealEvent` the decision module emits (which carries
 * the winner's score and runner-up score for the Phase 2 margin gate).
 *
 * Phase 2 (D-05) widens the wire into a tagged union {@link SelfmendEvent}
 * carried on the SAME `selfmend-heal` attachment. A `HealEvent` gains an
 * optional `kind: "healed"` discriminant: a missing `kind` is treated as
 * `"healed"` by the reporter so any in-flight / Phase-1 attachment still parses
 * (back-compat, Pitfall 4). The historic name `HealEvent` is retained (= the
 * healed arm) so existing imports keep working; `HealedEvent` is its alias.
 */
export interface HealEvent {
  /** Discriminant; absence === `"healed"` for Phase-1 back-compat (D-05). */
  kind?: "healed";
  /** The test in which the heal occurred (for the report's per-test grouping). */
  testName: string;
  /** The selector that broke (the original, now-stale locator). */
  originalSelector: string;
  /** The healed-to selector that resolved and replayed green. */
  healedTarget: string;
  /** The winning candidate's confidence score in `[0, 1]`. */
  score: number;
}

/** Canonical name for the healed arm of the {@link SelfmendEvent} union. */
export type HealedEvent = HealEvent;

/**
 * The three POST-SCORING refusal reasons surfaced to the report (D-04). This is
 * the {@link import("../matching/types.js").NoHealReason} subset MINUS
 * `no-fingerprint`: an uncaptured locator is re-thrown BEFORE scoring and is
 * deliberately not surfaced as a refused row (RESEARCH Open Question 1 / A3 —
 * it would fire for every never-captured failing locator, i.e. noise).
 */
export type RefusedReason = "no-candidates" | "below-floor" | "ambiguous";

/**
 * One REFUSED heal, as it crosses the worker -> main boundary (REP-02, D-04).
 *
 * Emitted when `decide()` returns `heal: false` for one of the three
 * post-scoring reasons. Carries DERIVED audit fields only (selectors, a reason
 * string, a number) — never raw DOM content (T-02-06), so nothing sensitive
 * crosses the process boundary.
 */
export interface RefusedEvent {
  /** Discriminant marking this as a refused (not healed) attempt. */
  kind: "refused";
  /** The test in which the refusal occurred (for per-test grouping). */
  testName: string;
  /** The selector that broke and could NOT be confidently healed. */
  originalSelector: string;
  /** Why the heal was refused (one of the three post-scoring reasons). */
  reason: RefusedReason;
  /**
   * The best candidate score seen, or `null` when there were no candidates to
   * score (`no-candidates`). Lets the report show how close the best match came.
   */
  bestScore: number | null;
}

/**
 * The full worker -> main wire contract: a tagged union on `kind`, carried on
 * the single {@link HEAL_ATTACHMENT_NAME} attachment (D-05). One wire name, one
 * parser path. A missing `kind` decodes as a {@link HealedEvent} (back-compat).
 */
export type SelfmendEvent = HealedEvent | RefusedEvent;

/**
 * Serialize a {@link HealedEvent} onto the current test's attachments as JSON.
 * Stamps `kind: "healed"` so new healed attachments are explicitly tagged while
 * old/missing-kind ones still decode as healed (back-compat, Pitfall 4).
 *
 * @param testInfo The active `TestInfo` (from the fixture / worker).
 * @param event The heal to record.
 */
export async function attachHealEvent(
  testInfo: TestInfo,
  event: HealEvent,
): Promise<void> {
  await testInfo.attach(HEAL_ATTACHMENT_NAME, {
    body: JSON.stringify({ kind: "healed", ...event }),
    contentType: "application/json",
  });
}

/**
 * Serialize a {@link RefusedEvent} onto the current test's attachments as JSON,
 * mirroring {@link attachHealEvent} (same wire name, same content type).
 *
 * The caller (the locator proxy) attaches a refused event THEN unconditionally
 * re-throws the original error: this attach is additive observability and must
 * NEVER suppress the failure (D-06, Pitfall 2).
 *
 * @param testInfo The active `TestInfo` (from the fixture / worker).
 * @param event The refused attempt to record.
 */
export async function attachRefusedEvent(
  testInfo: TestInfo,
  event: RefusedEvent,
): Promise<void> {
  await testInfo.attach(HEAL_ATTACHMENT_NAME, {
    body: JSON.stringify(event),
    contentType: "application/json",
  });
}
