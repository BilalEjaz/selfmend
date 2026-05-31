import { describe, it, expect } from "vitest";
import pc from "picocolors";

import SelfmendReporter, {
  stripAnsi,
  isComplete,
  shouldPrune,
} from "./reporter.js";
import { mergeShards, refresh, prune } from "../store/merge.js";
import { STORE_FORMAT_VERSION, type ShardFile } from "../store/schema.js";
import type { Fingerprint } from "../matching/types.js";
import {
  HEAL_ATTACHMENT_NAME,
  type HealEvent,
  type SelfmendEvent,
} from "../integration/events.js";

/** A minimal valid fingerprint for the merge/prune gate tests. */
function fp(text: string): Fingerprint {
  return {
    tag: "button",
    role: "button",
    text,
    testId: "",
    attrs: {},
    ordinal: 0,
    parentTag: "form",
    neighbourSignature: "",
  };
}

/** A FullConfig-shaped stub carrying only the fields isComplete reads. */
function cfg(over: Partial<{ grep: unknown; grepInvert: unknown; shard: unknown }>) {
  return {
    grep: over.grep ?? /.*/,
    grepInvert: "grepInvert" in over ? over.grepInvert : null,
    shard: "shard" in over ? over.shard : null,
  } as never;
}

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

/**
 * Like {@link resultWith} but accepts any wire payload (healed, refused, a
 * raw missing-`kind` object, or a malformed string) so the back-compat /
 * defensive-skip / two-section cases can feed mixed attachments.
 */
function resultWithRaw(payloads: unknown[]) {
  return {
    attachments: payloads.map((p) => {
      const json = typeof p === "string" ? p : JSON.stringify(p);
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

describe("stripAnsi removes the full escape sequence incl. ESC byte (MD-01)", () => {
  it("leaves no stray ESC byte and yields the true visible string", () => {
    const colored = pc.createColors(true);
    const s = colored.red("x") + colored.green("yz");
    const plain = stripAnsi(s);
    // The full ANSI sequence (incl. the leading \x1b ESC byte) is gone — no
    // stray control byte over-counts the visible width.
    expect(plain).not.toMatch(/\x1b/); // eslint-disable-line no-control-regex
    expect(plain).toBe("xyz");
  });

  it("matches the reference width stripper so the symmetry assumption is gone", () => {
    const colored = pc.createColors(true);
    const s = colored.red("red-selector");
    // The reporter's own stripper and the test's reference stripper must agree.
    expect(stripAnsi(s)).toBe(visible(s));
    expect(stripAnsi(s).length).toBe("red-selector".length);
  });
});

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

describe("SelfmendReporter could-not-heal section (REP-02, D-04)", () => {
  it("renders the healed box first, then a SEPARATE could-not-heal section listing locator/reason/best-score", () => {
    const reporter = new SelfmendReporter();
    const healed: SelfmendEvent = {
      kind: "healed",
      testName: "a heal that stuck",
      originalSelector: ".btn-primary",
      healedTarget: '[data-testid="submit-btn"]',
      score: 0.97,
    };
    const refusedAmbiguous: SelfmendEvent = {
      kind: "refused",
      testName: "an ambiguous duplicate",
      originalSelector: '[data-testid="delete-row"]',
      reason: "ambiguous",
      bestScore: 0.95,
    };
    const refusedBelowFloor: SelfmendEvent = {
      kind: "refused",
      testName: "a vaguely-similar miss",
      originalSelector: ".gone",
      reason: "below-floor",
      bestScore: 0.42,
    };
    const refusedNoCandidates: SelfmendEvent = {
      kind: "refused",
      testName: "nothing to match",
      originalSelector: ".vanished",
      reason: "no-candidates",
      bestScore: null,
    };
    reporter.onTestEnd(
      {} as never,
      resultWithRaw([
        healed,
        refusedAmbiguous,
        refusedBelowFloor,
        refusedNoCandidates,
      ]) as never,
    );
    const out = visible(reporter.render());

    // Healed box still rendered first (back-compat).
    expect(out).toContain("selfmend: 1 locator healed");
    expect(out).toContain(".btn-primary");

    // Separate could-not-heal section with a count of 3.
    expect(out).toContain("could NOT heal");
    expect(out).toMatch(/3 locators? could NOT heal/);

    // The healed section comes BEFORE the could-not-heal section.
    expect(out.indexOf("locator healed")).toBeLessThan(out.indexOf("could NOT heal"));

    // Each refusal lists its locator, reason, and best score.
    expect(out).toContain('[data-testid="delete-row"]');
    expect(out).toContain("ambiguous");
    expect(out).toContain("0.95");

    expect(out).toContain(".gone");
    expect(out).toContain("below-floor");
    expect(out).toContain("0.42");

    // A null bestScore renders as a dash, never "null".
    expect(out).toContain(".vanished");
    expect(out).toContain("no-candidates");
    expect(out).not.toContain("null");
    expect(out).toMatch(/—|-/);
  });

  it("treats a missing-`kind` attachment as a healed event (back-compat, Pitfall 4)", () => {
    const reporter = new SelfmendReporter();
    reporter.onTestEnd(
      {} as never,
      // No `kind` field at all — an in-flight Phase-1 healed payload.
      resultWithRaw([
        {
          testName: "a legacy heal",
          originalSelector: ".legacy",
          healedTarget: '[data-testid="legacy"]',
          score: 0.93,
        },
      ]) as never,
    );
    const out = visible(reporter.render());
    expect(out).toContain("selfmend: 1 locator healed");
    expect(out).toContain(".legacy");
    // No refused section for a healed-only run.
    expect(out).not.toContain("could NOT heal");
  });

  it("skips a malformed attachment rather than crashing (T-02-05 defensive parse)", () => {
    const reporter = new SelfmendReporter();
    expect(() =>
      reporter.onTestEnd(
        {} as never,
        resultWithRaw([
          "not-json-at-all",
          { kind: "refused", testName: "x" }, // missing required refused fields
          {
            kind: "refused",
            testName: "valid one",
            originalSelector: ".ok",
            reason: "ambiguous",
            bestScore: 0.95,
          },
        ]) as never,
      ),
    ).not.toThrow();
    const out = visible(reporter.render());
    // Only the one valid refusal survives.
    expect(out).toMatch(/1 locator could NOT heal/);
    expect(out).toContain(".ok");
  });

  it("prints NO could-not-heal section when there are zero refusals (mirrors the N=0 healed guard)", () => {
    const reporter = new SelfmendReporter();
    reporter.onTestEnd(
      {} as never,
      resultWith([
        {
          testName: "only a heal",
          originalSelector: ".a",
          healedTarget: ".b",
          score: 0.99,
        },
      ]) as never,
    );
    const out = visible(reporter.render());
    expect(out).toContain("selfmend: 1 locator healed");
    expect(out).not.toContain("could NOT heal");
  });

  it("rejects a refused event carrying an unknown reason (defensive parse)", () => {
    const reporter = new SelfmendReporter();
    reporter.onTestEnd(
      {} as never,
      resultWithRaw([
        {
          kind: "refused",
          testName: "bogus reason",
          originalSelector: ".x",
          reason: "no-fingerprint", // not one of the three post-scoring reasons
          bestScore: 0.5,
        },
      ]) as never,
    );
    const out = visible(reporter.render());
    expect(out).not.toContain("could NOT heal");
  });
});

describe("isComplete completeness predicate (D-09, Open Q2/A3)", () => {
  it("is TRUE for the default match-all run (grep /.*/ , null grepInvert, null shard)", () => {
    expect(isComplete(cfg({ grep: /.*/ }))).toBe(true);
  });

  it("handles BOTH the /.*/ RegExp and an empty-array grep default (Open Q2/A3)", () => {
    // The 1.60 default is /.*/, but the predicate must be robust to either
    // representation so completeness detection does not silently break.
    expect(isComplete(cfg({ grep: [] }))).toBe(true);
    expect(isComplete(cfg({ grep: [/.*/] }))).toBe(true);
  });

  it("is FALSE when --grep narrows the run", () => {
    expect(isComplete(cfg({ grep: /@smoke/ }))).toBe(false);
    expect(isComplete(cfg({ grep: [/@smoke/] }))).toBe(false);
  });

  it("is FALSE when grepInvert is set (--grep-invert)", () => {
    expect(isComplete(cfg({ grep: /.*/, grepInvert: /@slow/ }))).toBe(false);
  });

  it("is FALSE when shard is set (--shard)", () => {
    expect(isComplete(cfg({ grep: /.*/, shard: { total: 2, current: 1 } }))).toBe(
      false,
    );
  });
});

describe("shouldPrune gate (D-08 refresh always / D-09 prune opt-in + complete-run-only)", () => {
  it("prunes ONLY when complete AND passed AND SELFMEND_PRUNE is set", () => {
    expect(shouldPrune(true, "passed", "1")).toBe(true);
  });

  it("does NOT prune on an incomplete (filtered) run even if passed + opted in", () => {
    expect(shouldPrune(false, "passed", "1")).toBe(false);
  });

  it("does NOT prune when the run did not pass", () => {
    expect(shouldPrune(true, "failed", "1")).toBe(false);
    expect(shouldPrune(true, "timedout", "1")).toBe(false);
    expect(shouldPrune(true, "interrupted", "1")).toBe(false);
  });

  it("does NOT prune when SELFMEND_PRUNE is unset/empty (opt-in gate)", () => {
    expect(shouldPrune(true, "passed", undefined)).toBe(false);
    expect(shouldPrune(true, "passed", "")).toBe(false);
  });
});

describe("merge -> refresh -> (gated prune) decision over the pure layer (D-08/D-09)", () => {
  const baseline = {
    version: STORE_FORMAT_VERSION,
    entries: { "k-old": fp("OldButton") },
  };
  // One worker shard captured a NEW key but did NOT see the old key this run.
  const shards: ShardFile[] = [
    {
      version: STORE_FORMAT_VERSION,
      captures: { "k-new": fp("NewButton") },
      seen: ["k-new"],
    },
  ];

  it("refresh-only (prune NOT applied): retains the unseen old key (D-08)", () => {
    const merged = mergeShards(shards);
    const next = refresh(baseline, merged);
    // No prune: both keys survive.
    expect(Object.keys(next.entries).sort()).toEqual(["k-new", "k-old"]);
  });

  it("prune applied (complete+passed+opt-in): drops the unseen old key (D-09)", () => {
    const merged = mergeShards(shards);
    let next = refresh(baseline, merged);
    if (shouldPrune(true, "passed", "1")) {
      next = prune(next, merged.seen);
    }
    // Old key was not seen this run -> pruned; only the captured key remains.
    expect(Object.keys(next.entries)).toEqual(["k-new"]);
  });

  it("filtered run refreshes but does NOT prune (Pitfall 2): old key retained", () => {
    const merged = mergeShards(shards);
    let next = refresh(baseline, merged);
    // complete=false -> gate closed even though passed + opt-in.
    if (shouldPrune(false, "passed", "1")) {
      next = prune(next, merged.seen);
    }
    expect(Object.keys(next.entries).sort()).toEqual(["k-new", "k-old"]);
  });
});
