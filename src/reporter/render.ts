import pc from "picocolors";

import type {
  HealEvent,
  RefusedEvent,
  SelfmendEvent,
} from "../integration/events.js";

/**
 * The single shared, PURE boxed-summary renderer (OUT-02).
 *
 * This is the ONE home of the heal-summary box drawing. The @playwright/test
 * {@link import("./reporter.js").default SelfmendReporter} delegates its
 * `render()` to this function, and the public `renderHealSummary` export lets a
 * raw-framework consumer (collecting {@link SelfmendEvent}s off an `onHeal`
 * callback) print the IDENTICAL box with no Playwright reporter. Because both
 * paths call this one function, their output is byte-identical by construction,
 * not by a copy that could drift.
 *
 * Pure and offline: it depends only on `picocolors` for color and the
 * {@link SelfmendEvent} shape. No `fs`, no Playwright import, no new dependency.
 *
 * It carries derived audit fields only (selectors, score, reason) — never raw
 * DOM content (T-06-08), unchanged from the reporter.
 */

/**
 * Render the boxed heal summary for a flat event sequence (OUT-02).
 *
 * Partitions `events` into healed vs refused by the `kind` discriminant, with a
 * MISSING `kind` treated as healed (events.ts:34, back-compat). Renders the
 * healed box FIRST, then the could-not-heal section, each in input order. With
 * zero healed events the healed box is the single quiet dim line (no box drawn);
 * with zero refusals no could-not-heal section is appended (mirrors the N=0
 * guard). A `null` bestScore renders as a dash, never the literal "null".
 *
 * @param events The collected heal events (healed + refused), in render order.
 * @returns The exact string the reporter would print for the same events.
 */
export function renderHealSummary(events: SelfmendEvent[]): string {
  const heals: HealEvent[] = [];
  const refused: RefusedEvent[] = [];
  for (const event of events) {
    // A missing `kind` decodes as healed (events.ts:34, back-compat).
    if (event.kind === "refused") refused.push(event);
    else heals.push(event);
  }

  const healedBlock = renderHealedBox(heals);
  const refusedBlock = renderRefusedSection(refused);
  if (refusedBlock === null) return healedBlock;
  return `${healedBlock}\n${refusedBlock}`;
}

/** The healed box, unchanged (back-compat); quiet line when N=0. */
function renderHealedBox(heals: HealEvent[]): string {
  const n = heals.length;
  if (n === 0) {
    return pc.dim("selfmend: 0 locators healed");
  }

  const header = `selfmend: ${n} locator${n === 1 ? "" : "s"} healed`;
  const rows = heals.map((h) => renderRow(h));

  // Box sized to the widest line. Plain ASCII frame; picocolors only adds
  // color, so the layout survives no-color terminals and log capture.
  const lines = [header, ...rows.flat()];
  const width = Math.max(...lines.map(visibleLength));
  const top = "┌" + "─".repeat(width + 2) + "┐";
  const bottom = "└" + "─".repeat(width + 2) + "┘";
  const boxed = [
    top,
    boxLine(pc.bold(pc.cyan(header)), header, width),
    ...rows.flatMap((row) =>
      row.map((line, i) =>
        boxLine(i === 0 ? pc.bold(line) : line, stripAnsi(line), width),
      ),
    ),
    bottom,
  ];
  return boxed.join("\n");
}

/**
 * The separate could-not-heal section (REP-02, D-04). Returns `null` when there
 * are zero refusals so no empty section is drawn (mirrors the N=0 healed-box
 * guard). Reuses the same box helpers so it survives no-color terminals.
 * Warning-colored header to distinguish it from the healed box.
 */
function renderRefusedSection(refused: RefusedEvent[]): string | null {
  const n = refused.length;
  if (n === 0) return null;

  const header = `selfmend: ${n} locator${n === 1 ? "" : "s"} could NOT heal`;
  const rows = refused.map((r) => renderRefusedRow(r));

  const lines = [header, ...rows.flat()];
  const width = Math.max(...lines.map(visibleLength));
  const top = "┌" + "─".repeat(width + 2) + "┐";
  const bottom = "└" + "─".repeat(width + 2) + "┘";
  const boxed = [
    top,
    boxLine(pc.bold(pc.yellow(header)), header, width),
    ...rows.flatMap((row) =>
      row.map((line, i) =>
        boxLine(i === 0 ? pc.bold(line) : line, stripAnsi(line), width),
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
function renderRow(h: HealEvent): string[] {
  const arrow = pc.dim("->");
  const orig = pc.red(h.originalSelector);
  const healed = pc.green(h.healedTarget);
  const score = pc.yellow(formatScore(h.score));
  return [
    `${pc.bold(h.testName)}`,
    `  ${orig} ${arrow} ${healed}  ${pc.dim("(")}${score}${pc.dim(")")}`,
  ];
}

/**
 * Render one refusal as a (possibly multi-line) indented block:
 *   <test name>
 *     <original>  x  <reason>  (best <score|—>)
 * A `null` bestScore renders as a dash, never the literal "null".
 */
function renderRefusedRow(r: RefusedEvent): string[] {
  const mark = pc.red("x");
  const orig = pc.red(r.originalSelector);
  const reason = pc.yellow(r.reason);
  const best = r.bestScore === null ? "—" : formatScore(r.bestScore);
  const score = pc.dim("best ") + pc.yellow(best);
  return [
    `${pc.bold(r.testName)}`,
    `  ${orig} ${mark} ${reason}  ${pc.dim("(")}${score}${pc.dim(")")}`,
  ];
}

/** Frame a single line inside the box, padded to `width` visible columns. */
function boxLine(colored: string, plain: string, width: number): string {
  const pad = " ".repeat(Math.max(0, width - plain.length));
  return `│ ${colored}${pad} │`;
}

/** Format a confidence score in `[0, 1]` as a fixed 2-decimal string. */
function formatScore(score: number): string {
  return score.toFixed(2);
}

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g;

/** Strip ANSI color codes so we can measure true visible width. */
export function stripAnsi(s: string): string {
  return s.replace(ANSI, "");
}

/** Visible (color-stripped) length of a line, for box sizing. */
function visibleLength(s: string): number {
  return stripAnsi(s).length;
}
