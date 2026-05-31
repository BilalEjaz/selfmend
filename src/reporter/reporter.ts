import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";
import pc from "picocolors";

import {
  HEAL_ATTACHMENT_NAME,
  type HealEvent,
  type RefusedEvent,
  type RefusedReason,
  type SelfmendEvent,
} from "../integration/events.js";
import { mergeShards, refresh, prune } from "../store/merge.js";
import { serialize } from "../store/serialize.js";
import {
  atomicWrite,
  baselinePath,
  deleteShards,
  loadBaseline,
  readShards,
  shardsDir,
} from "../store/persistence.js";

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
  /** All REFUSED attempts across the run (REP-02, D-04), in completion order. */
  private readonly refused: RefusedEvent[] = [];

  /**
   * rootDir the store is anchored under, captured in {@link onBegin} from
   * `FullConfig.rootDir`. The teardown merge in {@link onEnd} resolves the
   * baseline + shards paths under it (honoring SELFMEND_STORE_DIR via
   * persistence.ts). Empty until onBegin runs (a unit-rendered reporter that
   * never calls onBegin/onEnd does no IO).
   */
  private rootDir = "";

  /**
   * Whether THIS run is a complete, unfiltered run (the D-09 prune gate's
   * completeness half). Captured in {@link onBegin} from the FullConfig filters
   * and combined in {@link onEnd} with the run status + the SELFMEND_PRUNE
   * opt-in. Defaults to `false` so a reporter that never sees onBegin can never
   * prune.
   */
  private complete = false;

  /** The post-filter planned test count (diagnostics only, D-09 Open Q2). */
  private plannedTestCount = 0;

  /**
   * Capture the run-completeness signal (REP-01, D-09). The reporter is the only
   * component holding BOTH the post-filter planned {@link Suite} and (later, in
   * onEnd) the {@link FullResult}, so the prune gate lives here, not in
   * globalTeardown (which sees neither). This does NOT touch a page/DOM, so the
   * summary-only invariant (D-05) is preserved.
   */
  onBegin(config: FullConfig, suite: Suite): void {
    this.rootDir = config.rootDir;
    this.complete = isComplete(config);
    this.plannedTestCount = suite.allTests().length;
    // Open Q2/A3 empirical confirm: log the real 1.60 default grep
    // representation once, behind a debug flag, so completeness detection can be
    // verified against the live runner without noise in normal runs.
    if (process.env.SELFMEND_DEBUG) {
      // eslint-disable-next-line no-console
      console.log(
        `[selfmend] onBegin grep=${describeGrep(config.grep)} grepInvert=${
          config.grepInvert === null ? "null" : describeGrep(config.grepInvert)
        } shard=${config.shard === null ? "null" : JSON.stringify(config.shard)} complete=${this.complete} planned=${this.plannedTestCount}`,
      );
    }
  }

  onTestEnd(_test: TestCase, result: TestResult): void {
    for (const attachment of result.attachments) {
      if (attachment.name !== HEAL_ATTACHMENT_NAME) continue;
      const event = parseEvent(attachment.body);
      if (!event) continue; // malformed -> skip, never crash (T-02-05)
      if (event.kind === "refused") this.refused.push(event);
      else this.heals.push(event);
    }
  }

  async onEnd(result: FullResult): Promise<void> {
    // 1. Render the boxed summary EXACTLY as before. The reporter's primary,
    //    user-facing job is unchanged (D-05/D-06). Print first so the summary
    //    shows even if the teardown merge below warns.
    const out = this.render();
    // eslint-disable-next-line no-console
    console.log(out);

    // 2. Teardown-time merge side effect (D-08/D-09/D-11/D-12). The reporter is
    //    the single main-process writer of the committed baseline: it merges all
    //    worker shards, refreshes (always, non-destructive), conditionally
    //    prunes (opt-in + complete-run-only), atomically writes the single
    //    baseline.json, and deletes the transient shards. Wrapped so a merge/IO
    //    failure NEVER crashes the user's run on teardown (T-03-08, Pitfall 5):
    //    a warning is logged and the run is left untouched.
    try {
      await this.mergeAndPersist(result);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[selfmend] baseline merge skipped (run unaffected): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * The teardown merge: shards -> merge -> refresh -> (gated prune) -> serialize
   * -> atomic single-writer baseline.json -> delete shards. Reads shard FILES
   * only; holds no page/DOM (D-05). Skips silently when no rootDir was captured
   * (a unit-rendered reporter that never ran onBegin).
   */
  private async mergeAndPersist(result: FullResult): Promise<void> {
    if (this.rootDir === "") return;
    const dir = shardsDir(this.rootDir);
    const shards = await readShards(dir);
    const merged = mergeShards(shards);

    // Load the existing committed baseline (fail-soft) and refresh it (D-08,
    // always, overwrite-on-recapture, never destructive).
    const baselineStore = await loadBaseline(this.rootDir);
    let next = refresh(baselineStore.toBaselineFile(), merged);

    // Destructive prune is gated: complete unfiltered run AND passed AND the
    // explicit SELFMEND_PRUNE opt-in (D-09, Pitfall 2, Open Q1).
    if (shouldPrune(this.complete, result.status, process.env.SELFMEND_PRUNE)) {
      next = prune(next, merged.seen);
    }

    // Single atomic write of the one committed artifact (D-03/D-11), then drop
    // the transient shards (D-12).
    await atomicWrite(baselinePath(this.rootDir), serialize(next));
    await deleteShards(dir);
  }

  /**
   * Build the boxed summary string. Exposed (not just inlined in `onEnd`) so it
   * can be unit-tested without a runner. With zero heals AND zero refusals it
   * prints one quiet line and no box (D-06 N=0: do not crash, do not draw an
   * empty box). The healed box is always rendered first (back-compat); the
   * could-not-heal section follows ONLY when there are refusals (REP-02, D-04).
   */
  render(): string {
    const healedBlock = this.renderHealedBox();
    const refusedBlock = this.renderRefusedSection();
    if (refusedBlock === null) return healedBlock;
    return `${healedBlock}\n${refusedBlock}`;
  }

  /** The Phase-1 healed box, unchanged (back-compat); quiet line when N=0. */
  private renderHealedBox(): string {
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
   * The separate could-not-heal section (REP-02, D-04). Returns `null` when
   * there are zero refusals so no empty section is drawn (mirrors the N=0
   * healed-box guard). Reuses the same box helpers so it survives no-color
   * terminals. Warning-colored header to distinguish it from the healed box.
   */
  private renderRefusedSection(): string | null {
    const n = this.refused.length;
    if (n === 0) return null;

    const header = `selfmend: ${n} locator${n === 1 ? "" : "s"} could NOT heal`;
    const rows = this.refused.map((r) => this.renderRefusedRow(r));

    const lines = [header, ...rows.flat()];
    const width = Math.max(...lines.map(visibleLength));
    const top = "┌" + "─".repeat(width + 2) + "┐";
    const bottom = "└" + "─".repeat(width + 2) + "┘";
    const boxed = [
      top,
      this.boxLine(pc.bold(pc.yellow(header)), header, width),
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

  /**
   * Render one refusal as a (possibly multi-line) indented block:
   *   <test name>
   *     <original>  x  <reason>  (best <score|—>)
   * A `null` bestScore renders as a dash, never the literal "null".
   */
  private renderRefusedRow(r: RefusedEvent): string[] {
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
  private boxLine(colored: string, plain: string, width: number): string {
    const pad = " ".repeat(Math.max(0, width - plain.length));
    return `│ ${colored}${pad} │`;
  }
}

/** The attachment body type exactly as Playwright's reporter API declares it. */
type AttachmentBody = TestResult["attachments"][number]["body"];

/**
 * Parse a `selfmend-heal` attachment body into a {@link SelfmendEvent},
 * defensively (T-02-05). Branches on the `kind` discriminant:
 *
 *  - `kind === "refused"` -> validate the refused fields and return a
 *    {@link RefusedEvent}.
 *  - any other `kind` (including a MISSING `kind`) -> validate the healed fields
 *    and return a {@link HealedEvent} (back-compat with Phase-1 attachments
 *    that predate the discriminant, Pitfall 4).
 *
 * Returns `null` for any missing/malformed body so a corrupt attachment is
 * skipped rather than crashing the whole reporter (and thus the run).
 */
export function parseEvent(body: AttachmentBody): SelfmendEvent | null {
  if (!body) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(body.toString("utf8"));
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;

  if (o.kind === "refused") return parseRefused(o);
  // Missing or "healed" kind -> healed (back-compat).
  return parseHealed(o);
}

/** The valid refused reasons, for defensive membership checks. */
const REFUSED_REASONS = new Set<RefusedReason>([
  "no-candidates",
  "below-floor",
  "ambiguous",
]);

/** Validate the healed arm of {@link parseEvent}; `null` if malformed. */
function parseHealed(o: Record<string, unknown>): HealEvent | null {
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
    kind: "healed",
    testName: o.testName,
    originalSelector: o.originalSelector,
    healedTarget: o.healedTarget,
    score: o.score,
  };
}

/** Validate the refused arm of {@link parseEvent}; `null` if malformed. */
function parseRefused(o: Record<string, unknown>): RefusedEvent | null {
  if (
    typeof o.testName !== "string" ||
    typeof o.originalSelector !== "string" ||
    typeof o.reason !== "string" ||
    !REFUSED_REASONS.has(o.reason as RefusedReason)
  ) {
    return null;
  }
  // bestScore is a finite number or explicitly null.
  const best = o.bestScore;
  let bestScore: number | null;
  if (best === null) {
    bestScore = null;
  } else if (typeof best === "number" && Number.isFinite(best)) {
    bestScore = best;
  } else {
    return null;
  }
  return {
    kind: "refused",
    testName: o.testName,
    originalSelector: o.originalSelector,
    reason: o.reason as RefusedReason,
    bestScore,
  };
}

/**
 * Backward-compatible alias retained for any external caller: parse a healed
 * attachment only. New code should use {@link parseEvent} (the tagged union).
 */
export function parseHealEvent(body: AttachmentBody): HealEvent | null {
  const event = parseEvent(body);
  return event && event.kind !== "refused" ? event : null;
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

/**
 * Stringify a `grep`/`grepInvert` value for the debug log (Open Q2/A3). A
 * RegExp renders via its source; an array renders each element; anything else
 * via `String`. Diagnostics-only, never affects the gate decision.
 */
function describeGrep(g: RegExp | RegExp[]): string {
  if (Array.isArray(g)) return `[${g.map((r) => String(r)).join(", ")}]`;
  return String(g);
}

/**
 * True iff a single RegExp is the match-all default. Playwright's 1.60 default
 * FullConfig.grep is the RegExp whose source is ".*" (VERIFIED against installed
 * type defs; confirm empirically via SELFMEND_DEBUG). We compare the `source` so
 * an equivalent always-matching default (e.g. an empty pattern) also counts.
 */
function isMatchAllRegExp(re: RegExp): boolean {
  return re.source === ".*" || re.source === "(?:)" || re.source === "";
}

/**
 * Whether `grep` represents the match-all default (Open Q2/A3). Robust to BOTH
 * representations the runner might use: a bare match-all RegExp (the 1.60
 * default), OR an array, where an EMPTY array (no grep filter) or an array of
 * only match-all regexes both count as match-all. Any concrete pattern is not
 * match-all.
 */
function isMatchAllGrep(grep: RegExp | RegExp[]): boolean {
  if (Array.isArray(grep)) {
    return grep.length === 0 || grep.every(isMatchAllRegExp);
  }
  return isMatchAllRegExp(grep);
}

/**
 * CLI flags that NARROW a run (Open Q2/A1, empirically confirmed against 1.60).
 *
 * EMPIRICAL FINDING (SELFMEND_DEBUG): in Playwright 1.60 the CLI `--grep`,
 * `--shard`, `--last-failed`, and `--only-changed` filters are applied as a
 * SEPARATE filter layer and are NOT reflected in
 * `FullConfig.grep`/`grepInvert`/`shard` (those keep their config/default
 * values). So FullConfig alone CANNOT see a CLI `--grep` run. The reporter runs
 * in the main process, so the run's own argv is the reliable signal: any of
 * these flags means the run is partial and must NOT prune (D-09 / Pitfall 2).
 *
 * A single-file / test-path / title-substring filter is NOT a flag — it is a
 * BARE POSITIONAL argument (`tests/login.spec.ts`, `tests/login.spec.ts:42`,
 * `login`). Those are detected separately by {@link argvHasPositionalFilter},
 * NOT by this flag list (the prior doc comment wrongly claimed "single-file"
 * was covered here — it was not; see WR-01).
 */
const NARROWING_CLI_FLAGS = [
  "--grep",
  "-g",
  "--grep-invert",
  "--shard",
  "--last-failed",
  "--only-changed",
  "--project", // a project filter narrows the planned suite too (A2)
];

/**
 * Value-taking flags whose NEXT argv token is the flag's value, not a positional
 * filter. Used by {@link argvHasPositionalFilter} so `--workers 4` does not read
 * `4` as a path filter. Long-form `--flag=value` carries its own value inline
 * and never consumes the following token, so it is naturally handled.
 */
const VALUE_FLAGS = new Set<string>([
  "--grep",
  "-g",
  "--grep-invert",
  "--shard",
  "--project",
  "--workers",
  "-j",
  "--retries",
  "--reporter",
  "--config",
  "-c",
  "--timeout",
  "--repeat-each",
  "--max-failures",
  "--output",
  "--trace",
  "--global-timeout",
]);

/**
 * True if argv carries a BARE POSITIONAL argument after the `playwright test`
 * subcommand — i.e. a test-path/file/line/title-substring filter (WR-01). Such
 * a token narrows the run exactly like `--grep`, but is not a flag, so the
 * 1.60 runner applies it as a separate filter layer that FullConfig never
 * reflects. We skip the runner/script tokens (`node` + the script path, the
 * first two argv entries), the `test` subcommand, every recognized flag, and
 * each value-flag's space-separated value. Anything left that does not start
 * with `-` is a genuine positional selector => the run is narrowed.
 */
function argvHasPositionalFilter(argv: readonly string[]): boolean {
  // Skip argv[0] (node) and argv[1] (the playwright/script path).
  for (let i = 2; i < argv.length; i++) {
    const tok = argv[i]!;
    if (tok.startsWith("-")) {
      // A `--flag value` consumes the next token as its value; `--flag=value`
      // is self-contained and consumes nothing.
      if (VALUE_FLAGS.has(tok)) i++;
      continue;
    }
    if (tok === "test") continue; // the playwright subcommand itself
    return true; // a bare positional => path/title filter => narrowed
  }
  return false;
}

/**
 * True if the run's argv carries any run-narrowing signal: a known narrowing
 * flag (long or `=`-inline form) OR a bare positional test-path/title filter
 * (WR-01). A positional filter is the single-file case the doc comment used to
 * claim was covered but was not.
 */
function argvNarrowsRun(argv: readonly string[]): boolean {
  if (argvHasPositionalFilter(argv)) return true;
  return argv.some(
    (a) =>
      NARROWING_CLI_FLAGS.includes(a) ||
      // `--grep=foo` / `--shard=1/2` long-form with an inline value.
      NARROWING_CLI_FLAGS.some((flag) => a.startsWith(`${flag}=`)),
  );
}

/**
 * The run-completeness predicate (D-09). A run is COMPLETE, and eligible for the
 * destructive prune, only when NO filter narrowed it. This requires BOTH:
 *  - the FullConfig filters are unset (`grep` match-all, null `grepInvert`, null
 *    `shard`) — catches config-file-level filtering; AND
 *  - the run's `argv` carries no narrowing CLI flag — catches CLI `--grep`/
 *    `--shard`/`--project`/`--last-failed`/`--only-changed`, which 1.60 does
 *    NOT surface on FullConfig (the empirical Open Q2/A1 finding).
 *
 * `argv` defaults to `process.argv` (the reporter is in the main process); it is
 * a parameter so the gate can be unit-tested without a runner. Conservative by
 * design: an undetectable narrowing at worst leaves stale entries (the file
 * grows slowly), never wrongly deletes a valid baseline. Exported for testing.
 */
export function isComplete(
  config: Pick<FullConfig, "grep" | "grepInvert" | "shard">,
  argv: readonly string[] = process.argv,
): boolean {
  return (
    isMatchAllGrep(config.grep) &&
    config.grepInvert === null &&
    config.shard === null &&
    !argvNarrowsRun(argv)
  );
}

/**
 * The destructive-prune gate (D-09, Open Q1). Returns true ONLY when ALL hold:
 *  - the run was COMPLETE (no grep/grepInvert/shard filter), {@link isComplete};
 *  - the run PASSED (`result.status === 'passed'`); and
 *  - the explicit `SELFMEND_PRUNE` opt-in env is set to a non-empty value.
 *
 * Refresh-on-pass (the non-destructive D-08 write) ALWAYS runs and is NOT gated
 * here; only the destructive prune is. Conservative by design: an
 * undetectable-as-partial run (`--last-failed`, `--only-changed`) at worst
 * leaves stale entries (the file grows slowly), never wrongly deletes a valid
 * baseline. Exported for unit-testing.
 */
export function shouldPrune(
  complete: boolean,
  status: FullResult["status"],
  pruneEnv: string | undefined,
): boolean {
  return complete && status === "passed" && Boolean(pruneEnv);
}
