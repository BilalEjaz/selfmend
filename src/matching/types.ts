/**
 * Pure, Playwright-free contracts shared by the scorer (`scoring.ts`), the
 * heal decision (`decision.ts`), and the capture + candidate-finder modules
 * planned for plan 04.
 *
 * Nothing in this file imports from `@playwright/test`, `playwright-core`, or
 * `node:fs`. These are plain data shapes: the live browser serializes a
 * {@link Fingerprint} on a passing run and a {@link CandidateDescriptor}[] at
 * heal time, then hands them to the pure scoring + decision core. Keeping the
 * contracts dependency-free is what lets the core IP be unit-tested offline
 * (T-02-02) and reused across tiers without dragging a browser into the tests.
 */

/**
 * The minimal observable signals captured from an element when its locator
 * resolved successfully. Stored (single-worker, in-process for Phase 1) keyed
 * by locator identity and later matched against live candidates.
 *
 * Only derived / normalized signals are recorded, never raw DOM, to avoid
 * persisting PII or secrets (T-02-03; PII-minimization is enforced at capture
 * in plan 04, but the contract here already favours normalized fields).
 */
export interface Fingerprint {
  /** Lowercased tag name, e.g. `"button"`. */
  tag: string;
  /** Computed or explicit ARIA role, e.g. `"button"`; empty string if none. */
  role: string;
  /** Accessible name / normalized text content (whitespace-collapsed). */
  text: string;
  /** Value of the configured test-id attribute; empty string if absent. */
  testId: string;
  /**
   * Stable, observable attributes keyed by name (e.g. `name`, `type`, `id`).
   * Volatile / generated values should be filtered out at capture time.
   */
  attrs: Readonly<Record<string, string>>;
  /** Zero-based index among the element's siblings; `-1` if no parent. */
  ordinal: number;
  /** Lowercased tag of the parent element; empty string if no parent. */
  parentTag: string;
  /**
   * A compact signature of the immediate neighbourhood (e.g. sibling tags /
   * roles) used as a weak structural signal. Empty string if not captured.
   */
  neighbourSignature: string;
}

/**
 * A live element observed during candidate enumeration at heal time. Carries
 * the same observable signals as a {@link Fingerprint} PLUS a
 * {@link uniqueSelector}: the uniquely-resolving selector string that rebind
 * (plan 04) will pass to `page.locator()`.
 *
 * Producing a fresh selector string (not an `ElementHandle`) is mandatory:
 * Playwright cannot build a Locator from an ElementHandle (issue #10571), so
 * rebind must re-resolve via `page.locator(uniqueSelector)`.
 */
export interface CandidateDescriptor {
  /** Lowercased tag name. */
  tag: string;
  /** Computed or explicit ARIA role; empty string if none. */
  role: string;
  /** Accessible name / normalized text content (whitespace-collapsed). */
  text: string;
  /** Value of the configured test-id attribute; empty string if absent. */
  testId: string;
  /** Stable, observable attributes keyed by name. */
  attrs: Readonly<Record<string, string>>;
  /** Zero-based index among the element's siblings; `-1` if no parent. */
  ordinal: number;
  /** Lowercased tag of the parent element; empty string if no parent. */
  parentTag: string;
  /** Compact neighbourhood signature; empty string if not captured. */
  neighbourSignature: string;
  /**
   * A selector that uniquely resolves to this candidate (verified to match
   * exactly one element by the candidate-finder). Rebind passes this to
   * `page.locator()` to replay the original action.
   */
  uniqueSelector: string;
}

/**
 * A candidate paired with its scorer output. `score` is bounded to `[0, 1]`,
 * where higher means a stronger match to the fingerprint.
 */
export interface ScoredCandidate {
  /** The candidate that was scored. */
  candidate: CandidateDescriptor;
  /** Match confidence in `[0, 1]`. */
  score: number;
}

/**
 * Why a heal was refused. Enumerated so the reporter and tests can assert the
 * exact refusal cause rather than a generic failure.
 *
 * - `no-fingerprint`: no stored fingerprint for the broken locator key, so
 *   there is nothing to match against (never heal an unseen locator).
 * - `no-candidates`: enumeration produced no candidates to score.
 * - `below-floor`: the best candidate scored under the conservative floor
 *   (this is the genuinely-gone / false-green guard, D-09 / T-02-01).
 * - `ambiguous`: the second-best margin gate refused (D-01); the top two
 *   candidates are within `margin` of each other, so a single winner cannot be
 *   confidently chosen (the look-alike / duplicate-element guard, MATCH-03).
 */
export type NoHealReason =
  | "no-fingerprint"
  | "no-candidates"
  | "below-floor"
  | "ambiguous";

/**
 * The structured outcome of the heal decision: a discriminated union on the
 * `heal` field.
 *
 * On `heal: true` the caller rebinds via `page.locator(newSelector)` and
 * replays the original action, and `event` carries the audit payload the
 * worker attaches for the end-of-run report. On `heal: false` the caller
 * re-throws the original error so the test fails normally (no false green),
 * and `reason` says why.
 */
export type Decision =
  | {
      heal: true;
      /** Uniquely-resolving selector of the winning candidate. */
      newSelector: string;
      /** Audit payload describing the heal (for the reporter). */
      event: HealEvent;
    }
  | {
      heal: false;
      /** Why the heal was refused. */
      reason: NoHealReason;
      /**
       * The top score seen across the scored candidates, surfaced on every
       * refusal so the reporter can show how close the best match came (D-04).
       * `null` when there were no candidates to score (`no-candidates`).
       */
      bestScore: number | null;
    };

/**
 * The audit record of an accepted heal, surfaced in the end-of-run console
 * summary (REP-01). Kept here (pure) so the decision module can build it
 * without touching Playwright; the worker is responsible only for transporting
 * it via `testInfo.attach`.
 */
export interface HealEvent {
  /** The selector that resolved to the winning candidate. */
  newSelector: string;
  /** The winning candidate's match confidence in `[0, 1]`. */
  score: number;
  /**
   * The runner-up's score, when a second candidate existed. Retained so the
   * Phase 2 margin gate and report can use it without reworking this contract.
   */
  runnerUpScore?: number;
}
