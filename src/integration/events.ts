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
 */
export interface HealEvent {
  /** The test in which the heal occurred (for the report's per-test grouping). */
  testName: string;
  /** The selector that broke (the original, now-stale locator). */
  originalSelector: string;
  /** The healed-to selector that resolved and replayed green. */
  healedTarget: string;
  /** The winning candidate's confidence score in `[0, 1]`. */
  score: number;
}

/**
 * Serialize a {@link HealEvent} onto the current test's attachments as JSON.
 *
 * @param testInfo The active `TestInfo` (from the fixture / worker).
 * @param event The heal to record.
 */
export async function attachHealEvent(
  testInfo: TestInfo,
  event: HealEvent,
): Promise<void> {
  await testInfo.attach(HEAL_ATTACHMENT_NAME, {
    body: JSON.stringify(event),
    contentType: "application/json",
  });
}
