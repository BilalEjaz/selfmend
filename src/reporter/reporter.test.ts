import { describe, it, expect } from "vitest";
import pc from "picocolors";

import SelfmendReporter from "./reporter.js";
import { HEAL_ATTACHMENT_NAME, type HealEvent } from "../integration/events.js";

/**
 * Build a TestResult-like object carrying heal attachments. The body is a tiny
 * stub exposing `toString()` (all the reporter reads) so this stays a pure src
 * unit test with no `@types/node`/`Buffer` dependency (CLAUDE.md: src stays
 * node-free; Buffer-bearing reporter tests live in the Playwright runner).
 */
function resultWith(events: HealEvent[]) {
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

// Reference stripper that includes the ESC byte, used to measure the true
// visible width of each rendered line in the assertions below.
// eslint-disable-next-line no-control-regex
const ANSI_ALL = /\x1b\[[0-9;]*m/g;
function visible(s: string): string {
  return s.replace(ANSI_ALL, "");
}

describe("SelfmendReporter box alignment with color enabled (WR-02)", () => {
  it("keeps the box aligned when content is colored (full ANSI incl. ESC stripped for width)", () => {
    // Render colored content (selector/target carry real picocolors ANSI
    // sequences, exactly as in a color-enabled CI/TTY). The reporter must
    // measure visible width by stripping the FULL escape sequence — including
    // the leading ESC byte — or the right border drifts. We INJECT colored
    // field values so the assertion does not depend on the host TTY's
    // color-support detection (picocolors no-ops when color is unsupported).
    const colored = pc.createColors(true);
    const reporter = new SelfmendReporter();
    reporter.onTestEnd(
      {} as never,
      resultWith([
        {
          testName: "a colored heal row",
          originalSelector: colored.red("red-selector"),
          healedTarget: colored.green("new-target"),
          score: 0.97,
        },
      ]) as never,
    );
    const out = reporter.render();
    const lines = out.split("\n");

    // The top/bottom borders and every framed content row must share the same
    // TRUE visible width. A regex missing the ESC byte over-counts the colored
    // rows and the ` │` right border misaligns.
    const topWidth = visible(lines[0]!).length;
    const bottomWidth = visible(lines[lines.length - 1]!).length;
    expect(bottomWidth).toBe(topWidth);
    for (const line of lines.slice(1, -1)) {
      expect(visible(line).length).toBe(topWidth);
      expect(visible(line).startsWith("│ ")).toBe(true);
      expect(visible(line).endsWith(" │")).toBe(true);
    }
  });
});
