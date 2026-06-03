/**
 * selfmend live demo.
 *
 * Run it with:   npm run demo
 *
 * It tells a small, true story in three acts, using a real Chromium browser and
 * the SAME public selfmend API a team would use in their own framework:
 *
 *   Act 1  RECORD     A passing test clicks the "Place order" button on the
 *                     current build. selfmend records what that button looks
 *                     like (offline, into a plain local JSON file).
 *   Act 2  HEAL       The front-end team ships a redesign that renames the
 *                     button's CSS class. The test, pinned to the old class,
 *                     would normally fail. selfmend recognises the button by
 *                     its identity and heals the test live. It stays green.
 *   Act 3  TRUST      Another test looks for a promo link that was genuinely
 *                     REMOVED. selfmend refuses to fake a pass. The test fails,
 *                     honestly, exactly as it should.
 *
 * Nothing here talks to a network. The whole thing runs on your machine.
 */

import { chromium } from "@playwright/test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { rm } from "node:fs/promises";

// The public selfmend API (the exact surface a real adopter imports).
import {
  wrapPage,
  BaselineStore,
  loadBaseline,
  saveBaseline,
  renderHealSummary,
} from "../dist/index.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BEFORE = pathToFileURL(resolve(HERE, "./pages/checkout-before.html")).href;
const AFTER = pathToFileURL(resolve(HERE, "./pages/checkout-after.html")).href;
const BASELINE_FILE = resolve(HERE, "./baseline.demo.json");

// Identity for the baseline keys. In a real suite this comes from your test
// runner (the feature + scenario name). Here we hard-code one logical test.
const scope = () => ({ suite: "demo", test: "checkout" });

const line = (s = "") => console.log(s);
const rule = () => line("-".repeat(64));
const heading = (s) => {
  line();
  rule();
  line(s);
  rule();
};

async function main() {
  const browser = await chromium.launch();

  heading("selfmend live demo");
  line("A real browser. The real public API. No network, ever.");

  // ----------------------------------------------------------------------
  // ACT 1: RECORD a passing test on the CURRENT build.
  // ----------------------------------------------------------------------
  heading("Act 1  RECORD   the test passes today, selfmend takes notes");
  {
    const store = new BaselineStore();
    const context = await browser.newContext();
    const page = wrapPage(await context.newPage(), { store, scope });

    await page.goto(BEFORE);
    line('Test step: click the "Place order" button, found via .btn-primary');
    await page.locator(".btn-primary").click();
    line("  -> button clicked, test passes");
    line('Test step: confirm the "Limited time offer" promo link is present');
    await page.locator(".promo-link").click();
    line("  -> promo link present, test passes");

    // saveBaseline flushes any in-flight capture, then writes a plain JSON file.
    await saveBaseline(BASELINE_FILE, store);
    line("");
    line("selfmend recorded the identity of both elements to a local file:");
    line("  " + BASELINE_FILE);
    line("(open it in any editor, it is just derived signals: text, role,");
    line(" test-id, position. No screenshots, no secrets, nothing leaves CI.)");

    await context.close();
  }

  // ----------------------------------------------------------------------
  // ACT 2: a redesign renames the class. The test would break. selfmend heals.
  // ----------------------------------------------------------------------
  heading("Act 2  HEAL    a redesign renamed .btn-primary to .cta");
  const events = [];
  {
    // Load the baseline we just saved (this is what a later CI run does).
    const store = await loadBaseline(BASELINE_FILE);
    const context = await browser.newContext();
    const page = wrapPage(await context.newPage(), {
      store,
      scope,
      // onHeal receives every heal decision (healed AND refused). We collect
      // them to print the same summary a CI run would show at the end.
      onHeal: (e) => events.push(e),
    });

    await page.goto(AFTER);
    line("The SAME test still looks for .btn-primary (it does not exist now).");
    line("Without selfmend this fails. With selfmend, watch:");
    line("");
    await page.locator(".btn-primary").click({ timeout: 2500 });
    line('  -> selfmend recognised the renamed button and clicked it. GREEN.');

    // ----------------------------------------------------------------------
    // ACT 3: the trust check. A genuinely-removed element must NOT heal.
    // ----------------------------------------------------------------------
    heading("Act 3  TRUST   the promo link was genuinely removed");
    line("A test still looks for .promo-link. It is really gone. selfmend must");
    line("NOT invent a replacement. Watch it refuse and let the test fail:");
    line("");
    try {
      await page.locator(".promo-link").click({ timeout: 2500 });
      line("  -> UNEXPECTED: it healed. (This should never happen.)");
    } catch {
      line("  -> selfmend refused to heal. The test FAILED, honestly. No false green.");
    }

    await context.close();
  }

  // ----------------------------------------------------------------------
  // The end-of-run summary, byte-identical to what the CI reporter prints.
  // ----------------------------------------------------------------------
  heading("The report selfmend would print in your CI");
  line(renderHealSummary(events));

  heading("What just happened");
  line("1. A selector changed (not the app). selfmend kept the test green and");
  line("   told you exactly what it healed and how confident it was.");
  line("2. An element was truly removed. selfmend refused to fake a pass.");
  line("That second point is the whole product: it never lies about a green.");
  line("");

  await browser.close();
  await rm(BASELINE_FILE, { force: true });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
