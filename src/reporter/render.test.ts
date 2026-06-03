import { describe, it, expect } from "vitest";

import SelfmendReporter from "./reporter.js";
import { renderHealSummary } from "./render.js";
import { HEAL_ATTACHMENT_NAME, type SelfmendEvent } from "../integration/events.js";

/**
 * The OUT-02 byte-identical guarantee. `renderHealSummary(events)` MUST be the
 * single shared pure renderer the reporter also calls, so the standalone export
 * and the @playwright/test reporter print byte-identical boxes for the same
 * events. These tests feed the SAME flat SelfmendEvent[] to a real
 * SelfmendReporter (via its onTestEnd attachment path) and to renderHealSummary,
 * then assert FULL string equality (toBe), not toContain — a toContain pass with
 * an equality fail is exactly the renderer-drift warning sign (Pitfall 2).
 *
 * Both paths run through the same `picocolors` module, so the color mode is
 * identical between them with no forcing needed (A4); the equality is over the
 * exact bytes either path would print.
 */

/**
 * Build a TestResult-like object carrying heal attachments, exactly as
 * reporter.test.ts does (a tiny `toString()` stub so this stays a node-free src
 * unit test). Drives the reporter's real onTestEnd parse path.
 */
function resultWith(events: SelfmendEvent[]) {
  return {
    attachments: events.map((e) => {
      const json = JSON.stringify(e);
      return {
        name: HEAL_ATTACHMENT_NAME,
        contentType: "application/json",
        body: { toString: () => json },
      };
    }),
  };
}

/** Render the SAME events through a real reporter instance (the canonical path). */
function reporterRender(events: SelfmendEvent[]): string {
  const reporter = new SelfmendReporter();
  reporter.onTestEnd({} as never, resultWith(events) as never);
  return reporter.render();
}

const HEALED: SelfmendEvent = {
  kind: "healed",
  testName: "a heal that stuck",
  originalSelector: ".btn-primary",
  healedTarget: '[data-testid="submit-btn"]',
  score: 0.97,
};

const HEALED_TWO: SelfmendEvent = {
  kind: "healed",
  testName: "another heal",
  originalSelector: ".old",
  healedTarget: ".new",
  score: 0.91,
};

const REFUSED_AMBIGUOUS: SelfmendEvent = {
  kind: "refused",
  testName: "an ambiguous duplicate",
  originalSelector: '[data-testid="delete-row"]',
  reason: "ambiguous",
  bestScore: 0.95,
};

const REFUSED_BELOW_FLOOR: SelfmendEvent = {
  kind: "refused",
  testName: "a vaguely-similar miss",
  originalSelector: ".gone",
  reason: "below-floor",
  bestScore: 0.42,
};

const REFUSED_NO_CANDIDATES: SelfmendEvent = {
  kind: "refused",
  testName: "nothing to match",
  originalSelector: ".vanished",
  reason: "no-candidates",
  bestScore: null,
};

describe("renderHealSummary is byte-identical to the reporter (OUT-02)", () => {
  it("matches the reporter for a mixed healed + refused event sequence (full string equality)", () => {
    const events: SelfmendEvent[] = [
      HEALED,
      HEALED_TWO,
      REFUSED_AMBIGUOUS,
      REFUSED_BELOW_FLOOR,
      REFUSED_NO_CANDIDATES,
    ];
    expect(renderHealSummary(events)).toBe(reporterRender(events));
  });

  it("matches the reporter for healed-only input (no trailing refused section)", () => {
    const events: SelfmendEvent[] = [HEALED, HEALED_TWO];
    const out = renderHealSummary(events);
    expect(out).toBe(reporterRender(events));
    expect(out).not.toContain("could NOT heal");
  });

  it("matches the reporter for refused-only input (yellow could-not-heal box)", () => {
    const events: SelfmendEvent[] = [
      REFUSED_AMBIGUOUS,
      REFUSED_BELOW_FLOOR,
      REFUSED_NO_CANDIDATES,
    ];
    const out = renderHealSummary(events);
    expect(out).toBe(reporterRender(events));
    expect(out).toContain("could NOT heal");
  });

  it("matches the reporter for the N=0 empty-events quiet line", () => {
    const events: SelfmendEvent[] = [];
    const out = renderHealSummary(events);
    expect(out).toBe(reporterRender(events));
    // The single quiet dim line, no box.
    expect(out).not.toContain("┌");
  });

  it("renders the singular '1 locator healed' header exactly as the reporter", () => {
    const events: SelfmendEvent[] = [HEALED];
    expect(renderHealSummary(events)).toBe(reporterRender(events));
  });

  it("renders a null bestScore as n/a (never the literal 'null'), matching the reporter", () => {
    const events: SelfmendEvent[] = [REFUSED_NO_CANDIDATES];
    const out = renderHealSummary(events);
    expect(out).toBe(reporterRender(events));
    expect(out).not.toContain("null");
    expect(out).toMatch(/n.a/);
  });

  it("treats a missing-kind event as healed (events.ts:34), byte-identical to the reporter", () => {
    // A missing `kind` decodes as healed in BOTH paths.
    const legacy = {
      testName: "a legacy heal",
      originalSelector: ".legacy",
      healedTarget: '[data-testid="legacy"]',
      score: 0.93,
    } as unknown as SelfmendEvent;
    const events: SelfmendEvent[] = [legacy];
    const out = renderHealSummary(events);
    expect(out).toBe(reporterRender(events));
    expect(out).toContain("1 locator healed");
  });
});
