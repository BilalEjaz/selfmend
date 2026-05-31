import type { Page } from "@playwright/test";
import type { CandidateDescriptor, Fingerprint } from "./types.js";

/**
 * Candidate enumeration on the failure path (MATCH-01 wiring).
 *
 * `findCandidates` runs ONE scoped `page.evaluate` at heal time that walks the
 * plausible elements (scoped by the fingerprint's tag/role to avoid scoring the
 * whole DOM) and returns lightweight {@link CandidateDescriptor}[]. Each
 * descriptor carries a `uniqueSelector` that the in-browser pass has VERIFIED
 * resolves to exactly one element, so rebind can pass it straight to
 * `page.locator()` (an ElementHandle cannot become a Locator, issue #10571).
 *
 * Security:
 *  - T-04-01 (selector injection): selectors are built from controlled signal
 *    values, preferring test-id then a small set of stable attributes then a
 *    scoped structural `nth`. Attribute VALUES are CSS-escaped via
 *    `CSS.escape` before interpolation, so DOM-derived text cannot break out of
 *    the selector. Free visible text is never interpolated into a selector.
 *  - T-04-02 (PII): descriptors carry derived signals only (normalized text,
 *    role, test-id, a filtered attribute map, ordinal, neighbour tags) — never
 *    raw innerHTML/outerHTML.
 *  - T-04-05 (offline): pure DOM enumeration; zero network.
 */

/** Attributes considered stable enough to anchor a unique selector on. */
const STABLE_ATTRS = ["name", "type", "placeholder", "aria-label", "title", "alt"];

/**
 * Enumerate scored-ready candidates for a broken locator's fingerprint.
 *
 * @param page The live page at the moment of failure.
 * @param fingerprint The broken locator's stored fingerprint (scopes the scan).
 * @param testIdAttr The configured test-id attribute name.
 * @returns Candidate descriptors, each with a verified-unique selector.
 */
export async function findCandidates(
  page: Page,
  fingerprint: Fingerprint,
  testIdAttr: string,
): Promise<CandidateDescriptor[]> {
  return page.evaluate(
    (args: {
      fp: Fingerprint;
      testIdAttr: string;
      stableAttrs: string[];
    }): CandidateDescriptor[] => {
      const { fp, testIdAttr, stableAttrs } = args;

      // --- in-browser helpers (kept inside evaluate; no closure over Node) ---
      const esc = (v: string): string =>
        typeof CSS !== "undefined" && typeof CSS.escape === "function"
          ? CSS.escape(v)
          : v.replace(/["\\\]]/g, "\\$&");

      const isUnique = (selector: string): boolean => {
        try {
          return document.querySelectorAll(selector).length === 1;
        } catch {
          return false;
        }
      };

      // Scope the scan: same tag if known, else elements that carry the role,
      // else fall back to the tag. Avoids scoring the entire DOM.
      const scopeSelectors: string[] = [];
      if (fp.tag) scopeSelectors.push(fp.tag);
      if (fp.role) scopeSelectors.push(`[role="${esc(fp.role)}"]`);
      const scopeSelector = scopeSelectors.length > 0 ? scopeSelectors.join(",") : "*";

      const elements = Array.from(document.querySelectorAll(scopeSelector));

      // Build the preferred uniquely-resolving selector for one element:
      // test-id -> stable attribute -> scoped nth-of-type. Each candidate is
      // verified unique before acceptance.
      const buildUniqueSelector = (el: Element): string | null => {
        const tag = el.tagName.toLowerCase();

        // 1. test-id (strongest, controlled value).
        const testId = el.getAttribute(testIdAttr);
        if (testId) {
          const sel = `[${testIdAttr}="${esc(testId)}"]`;
          if (isUnique(sel)) return sel;
        }

        // 2. a stable attribute, scoped by tag for specificity.
        for (const attr of stableAttrs) {
          const val = el.getAttribute(attr);
          if (val) {
            const sel = `${tag}[${attr}="${esc(val)}"]`;
            if (isUnique(sel)) return sel;
          }
        }

        // 3. scoped nth-of-type within the parent (structural fallback).
        const parent = el.parentElement;
        if (parent) {
          const sameTag = Array.from(parent.children).filter(
            (c) => c.tagName === el.tagName,
          );
          const idx = sameTag.indexOf(el);
          if (idx >= 0) {
            const parentTag = parent.tagName.toLowerCase();
            const parentId = parent.getAttribute("id");
            const parentScope = parentId
              ? `#${esc(parentId)}`
              : parentTag;
            const sel = `${parentScope} > ${tag}:nth-of-type(${idx + 1})`;
            if (isUnique(sel)) return sel;
          }
        }

        return null;
      };

      const out: CandidateDescriptor[] = [];
      for (const el of elements) {
        const uniqueSelector = buildUniqueSelector(el);
        if (!uniqueSelector) continue; // cannot address it uniquely -> skip

        const attrs: Record<string, string> = {};
        for (const name of el.getAttributeNames()) {
          if (stableAttrs.includes(name) || name === "type" || name === "name") {
            attrs[name] = el.getAttribute(name) ?? "";
          }
        }

        const parent = el.parentElement;
        const ordinal = parent
          ? Array.prototype.indexOf.call(parent.children, el)
          : -1;
        const prevTag = el.previousElementSibling?.tagName.toLowerCase() ?? "";
        const nextTag = el.nextElementSibling?.tagName.toLowerCase() ?? "";

        out.push({
          tag: el.tagName.toLowerCase(),
          role: el.getAttribute("role") ?? "",
          text: (el.textContent ?? "").replace(/\s+/g, " ").trim(),
          testId: el.getAttribute(testIdAttr) ?? "",
          attrs,
          ordinal,
          parentTag: parent?.tagName.toLowerCase() ?? "",
          neighbourSignature: `${prevTag}|${nextTag}`,
          uniqueSelector,
        });
      }

      return out;
    },
    { fp: fingerprint, testIdAttr, stableAttrs: STABLE_ATTRS },
  );
}
