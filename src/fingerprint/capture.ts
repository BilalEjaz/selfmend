import type { Locator } from "@playwright/test";
import type { Fingerprint } from "../matching/types.js";

/**
 * Fingerprint capture on the success path (CAP-01).
 *
 * `captureFingerprint` performs ONE batched `locator.evaluate(el => ({...}))`
 * round-trip and returns a {@link Fingerprint} of derived/normalized signals.
 * Doing it in a single in-browser evaluate (rather than many `getAttribute` /
 * `textContent` calls) keeps the green hot path fast; the caller deduplicates
 * per locator key per run so a second resolve does not pay the round-trip again.
 *
 * Security (T-04-02 / ASVS V10/V14): the payload is a fixed, flat set of
 * DERIVED signals only — normalized text, role, test-id, a filtered attribute
 * map, ordinal, parent tag, and a compact neighbour signature. It NEVER returns
 * raw `innerText`/`innerHTML`/`outerHTML` or the DOM subtree, so no PII or
 * secret markup is persisted.
 */

/**
 * Attributes worth keeping as identity/semantic signals. Volatile or generated
 * attributes (class, style, inline event handlers, framework data hooks) are
 * deliberately excluded so the stored fingerprint stays stable across cosmetic
 * churn and does not balloon with noise.
 */
const STABLE_ATTRS = new Set([
  "name",
  "type",
  "value",
  "placeholder",
  "title",
  "alt",
  "href",
  "for",
  "aria-label",
]);

/**
 * Capture the CAP-01 signal set for the element the locator currently resolves
 * to. Assumes the locator has already resolved (call after a successful action
 * or `waitFor`).
 *
 * @param locator A resolved Playwright Locator.
 * @param testIdAttr The configured test-id attribute name (e.g. `data-testid`).
 * @returns A {@link Fingerprint} of derived signals only.
 */
export async function captureFingerprint(
  locator: Locator,
  testIdAttr: string,
): Promise<Fingerprint> {
  const raw = await locator.evaluate(
    (el: Element, args: { testIdAttr: string; stableAttrs: string[] }) => {
      const stable = new Set(args.stableAttrs);
      const attrs: Record<string, string> = {};
      for (const name of el.getAttributeNames()) {
        if (stable.has(name)) attrs[name] = el.getAttribute(name) ?? "";
      }

      const parent = el.parentElement;
      const ordinal = parent ? Array.prototype.indexOf.call(parent.children, el) : -1;

      // Compact neighbour signature: the lowercased tags of the immediate
      // previous and next element siblings. A weak structural signal only —
      // never the siblings' text/content (PII-minimization).
      const prevTag = el.previousElementSibling?.tagName.toLowerCase() ?? "";
      const nextTag = el.nextElementSibling?.tagName.toLowerCase() ?? "";
      const neighbourSignature = `${prevTag}|${nextTag}`;

      return {
        tag: el.tagName.toLowerCase(),
        // Explicit role attribute; computed-role inference stays simple in
        // Phase 1 (the scorer treats role as one weighted signal among many).
        role: el.getAttribute("role") ?? "",
        // DERIVED, NORMALIZED text only: collapse whitespace + trim. Never the
        // raw multi-line innerText blob.
        text: (el.textContent ?? "").replace(/\s+/g, " ").trim(),
        testId: el.getAttribute(args.testIdAttr) ?? "",
        attrs,
        ordinal,
        parentTag: parent?.tagName.toLowerCase() ?? "",
        neighbourSignature,
      };
    },
    { testIdAttr, stableAttrs: Array.from(STABLE_ATTRS) },
  );

  return raw satisfies Fingerprint;
}
