import type {
  Reporter,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";
import pc from "picocolors";

import { HEAL_ATTACHMENT_NAME, type HealEvent } from "../integration/events.js";

/**
 * The summary-only selfmend Reporter (REP-01, D-05, D-06, D-07).
 *
 * This reporter is SUMMARY-ONLY by construction (D-05): it has no `page`/DOM
 * access, never rebinds a locator, and cannot heal. All live healing happens in
 * the worker via the fixture (plan 04). The reporter's sole job is to read the
 * `selfmend-heal` attachments the fixture wrote (the sanctioned worker -> main
 * channel, issue #31559) and render a single boxed audit block at end of run.
 *
 * Output (D-06): a boxed block whose header reads `selfmend: N locators healed`,
 * followed by one indented row per heal showing the test name, the original
 * (broken) selector, the healed target, and the confidence score. Phase 1 does
 * NOT show the runner-up margin column (D-07 — that is Phase 2 / REP-02).
 *
 * Threats mitigated:
 *  - T-05-01 (reporter healing): no DOM/page handle is ever held here.
 *  - T-05-02 (malformed attachment): {@link parseHealEvent} validates every
 *    field and skips bad entries rather than crashing the run.
 *  - T-05-03 (info disclosure): only derived signals (selectors + score) are
 *    printed; raw DOM content never reaches the reporter.
 */
export default class SelfmendReporter implements Reporter {
  /** All accepted heals across the run, in test-completion order. */
  private readonly heals: HealEvent[] = [];

  onTestEnd(_test: TestCase, result: TestResult): void {
    for (const attachment of result.attachments) {
      if (attachment.name !== HEAL_ATTACHMENT_NAME) continue;
      const event = parseHealEvent(attachment.body);
      if (event) this.heals.push(event);
    }
  }

  onEnd(): void {
    const out = this.render();
    // Print so it interleaves with the run summary and is captured by tests /
    // CI logs. Plain when colors are unsupported (picocolors no-ops). `console`
    // keeps the library src free of `@types/node` (this runs in the main
    // process where `console` is always present).
    // eslint-disable-next-line no-console
    console.log(out);
  }

  /**
   * Build the boxed summary string. Exposed (not just inlined in `onEnd`) so it
   * can be unit-tested without a runner. With zero heals it prints one quiet
   * line and no box (D-06 N=0: do not crash, do not draw an empty box).
   */
  render(): string {
    const n = this.heals.length;
    if (n === 0) {
      return pc.dim("selfmend: 0 locators healed");
    }

    const header = `selfmend: ${n} locator${n === 1 ? "" : "s"} healed`;
    const rows = this.heals.map((h) => this.renderRow(h));

    // Box sized to the widest line. Plain ASCII frame; picocolors only adds
    // color, so the layout survives no-color terminals and log capture.
    const lines = [header, ...rows.flat()];
    const width = Math.max(...lines.map(visibleLength));
    const top = "┌" + "─".repeat(width + 2) + "┐";
    const bottom = "└" + "─".repeat(width + 2) + "┘";
    const boxed = [
      top,
      this.boxLine(pc.bold(pc.cyan(header)), header, width),
      ...rows.flatMap((row) =>
        row.map((line, i) =>
          this.boxLine(
            i === 0 ? pc.bold(line) : line,
            stripAnsi(line),
            width,
          ),
        ),
      ),
      bottom,
    ];
    return boxed.join("\n");
  }

  /**
   * Render one heal as a (possibly multi-line) indented block:
   *   <test name>
   *     <original>  ->  <healed>  (score)
   */
  private renderRow(h: HealEvent): string[] {
    const arrow = pc.dim("->");
    const orig = pc.red(h.originalSelector);
    const healed = pc.green(h.healedTarget);
    const score = pc.yellow(formatScore(h.score));
    return [
      `${pc.bold(h.testName)}`,
      `  ${orig} ${arrow} ${healed}  ${pc.dim("(")}${score}${pc.dim(")")}`,
    ];
  }

  /** Frame a single line inside the box, padded to `width` visible columns. */
  private boxLine(colored: string, plain: string, width: number): string {
    const pad = " ".repeat(Math.max(0, width - plain.length));
    return `│ ${colored}${pad} │`;
  }
}

/** The attachment body type exactly as Playwright's reporter API declares it. */
type AttachmentBody = TestResult["attachments"][number]["body"];

/**
 * Parse a heal attachment body into a {@link HealEvent}, defensively (T-05-02).
 * Returns `null` for any missing/malformed body so a corrupt attachment is
 * skipped rather than crashing the whole reporter (and thus the run).
 */
export function parseHealEvent(body: AttachmentBody): HealEvent | null {
  if (!body) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(body.toString("utf8"));
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (
    typeof o.testName !== "string" ||
    typeof o.originalSelector !== "string" ||
    typeof o.healedTarget !== "string" ||
    typeof o.score !== "number" ||
    !Number.isFinite(o.score)
  ) {
    return null;
  }
  return {
    testName: o.testName,
    originalSelector: o.originalSelector,
    healedTarget: o.healedTarget,
    score: o.score,
  };
}

/** Format a confidence score in `[0, 1]` as a fixed 2-decimal string. */
function formatScore(score: number): string {
  return score.toFixed(2);
}

// eslint-disable-next-line no-control-regex
const ANSI = /\[[0-9;]*m/g;

/** Strip ANSI color codes so we can measure true visible width. */
function stripAnsi(s: string): string {
  return s.replace(ANSI, "");
}
// (ANSI defined above with an explicit ESC byte; see top of file.)

/** Visible (color-stripped) length of a line, for box sizing. */
function visibleLength(s: string): number {
  return stripAnsi(s).length;
}
