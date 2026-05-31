/**
 * REP-01 proof: the summary-only reporter renders a boxed end-of-run block that
 * lists a real heal (test name, original selector, healed target, score), and
 * does so WITHOUT any healing of its own (D-05).
 *
 * Two layers of proof:
 *  1. A live healing test (reusing the plan-04 broken-selector scenario) drives
 *     a real heal and attaches a real `selfmend-heal` event. This is the same
 *     attachment the wired reporter consumes during the full e2e run (Task 3).
 *  2. A deterministic, runner-free assertion feeds that exact HealEvent shape
 *     through the reporter's `onTestEnd`/`render` and asserts the boxed D-06
 *     output: the `selfmend: N locators healed` header plus a row carrying the
 *     original selector, the healed target, and the confidence score. It also
 *     asserts the reporter has no page/DOM surface (T-05-01) and renders N=0
 *     quietly without crashing.
 */
import { expect } from "@playwright/test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

import { healingFixture as test } from "../src/integration/fixture.js";
import {
  HEAL_ATTACHMENT_NAME,
  type HealEvent,
} from "../src/integration/events.js";
import SelfmendReporter from "../src/reporter/reporter.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const INDEX_URL = pathToFileURL(resolve(HERE, "./fixture-app/index.html")).href;
const BROKEN_URL = pathToFileURL(resolve(HERE, "./fixture-app/broken.html")).href;

/** Build a TestResult-like object carrying one heal attachment. */
function resultWith(events: HealEvent[]) {
  return {
    attachments: events.map((e) => ({
      name: HEAL_ATTACHMENT_NAME,
      contentType: "application/json",
      body: Buffer.from(JSON.stringify(e)),
    })),
  };
}

test("REP-01: a real heal produces a selfmend-heal attachment the reporter can read", async ({
  page,
}, testInfo) => {
  // Drive a real heal (identical mechanism to heal.spec.ts): capture on the
  // good page, then break the class selector on broken.html and heal.
  await page.goto(INDEX_URL);
  // Reuse one wrapped locator for capture + heal so its baseline key is stable
  // across both calls (CR-01).
  const submit = page.locator(".btn-primary");
  await submit.waitFor();
  await page.goto(BROKEN_URL);
  await submit.click({ timeout: 1200 });

  // The reporter reads exactly this attachment shape in onTestEnd.
  const healAttachments = testInfo.attachments.filter(
    (a) => a.name === HEAL_ATTACHMENT_NAME,
  );
  expect(healAttachments).toHaveLength(1);

  // Feed the REAL attachment through the reporter and assert the boxed summary.
  const reporter = new SelfmendReporter();
  const event = JSON.parse(
    healAttachments[0]!.body!.toString(),
  ) as HealEvent;

  // The reporter has no page/DOM access — it cannot heal (D-05 / T-05-01).
  expect((reporter as unknown as { page?: unknown }).page).toBeUndefined();
  expect(typeof (reporter as { onEnd?: unknown }).onEnd).toBe("function");

  // onTestEnd takes (TestCase, TestResult); only `result.attachments` is read.
  reporter.onTestEnd({} as never, resultWith([event]) as never);
  const output = reporter.render();

  // D-06 header attributable to the plugin.
  expect(output).toContain("selfmend: 1 locator healed");
  // A row with the original (broken) selector, healed target, and score.
  expect(output).toContain(event.testName);
  expect(output).toContain(".btn-primary");
  expect(output).toContain("submit-btn");
  expect(output).toContain(event.score.toFixed(2));
  // It is a BOXED block (D-06).
  expect(output).toContain("┌");
  expect(output).toContain("└");
});

test("REP-01: reporter pluralizes, lists multiple heals, and is quiet at N=0 (no crash)", async () => {
  const empty = new SelfmendReporter();
  // N=0: a single quiet line, no box, no throw (D-06 N=0).
  const emptyOut = empty.render();
  expect(emptyOut).toContain("selfmend: 0 locators healed");
  expect(emptyOut).not.toContain("┌");

  const reporter = new SelfmendReporter();
  reporter.onTestEnd(
    {} as never,
    resultWith([
      {
        testName: "checkout flow heals",
        originalSelector: ".pay-btn",
        healedTarget: '[data-testid="pay"]',
        score: 0.97,
      },
      {
        testName: "login flow heals",
        originalSelector: "#old-login",
        healedTarget: '[data-testid="login"]',
        score: 0.91,
      },
    ]) as never,
  );
  const out = reporter.render();
  expect(out).toContain("selfmend: 2 locators healed");
  expect(out).toContain("checkout flow heals");
  expect(out).toContain("login flow heals");
  expect(out).toContain(".pay-btn");
  expect(out).toContain("0.97");
});

test("REP-01: a malformed selfmend-heal attachment is skipped, not fatal (T-05-02)", async () => {
  const reporter = new SelfmendReporter();
  reporter.onTestEnd(
    {} as never,
    {
      attachments: [
        // Not JSON.
        {
          name: HEAL_ATTACHMENT_NAME,
          contentType: "application/json",
          body: Buffer.from("{not json"),
        },
        // Missing required fields.
        {
          name: HEAL_ATTACHMENT_NAME,
          contentType: "application/json",
          body: Buffer.from(JSON.stringify({ testName: "x" })),
        },
        // A valid one survives.
        {
          name: HEAL_ATTACHMENT_NAME,
          contentType: "application/json",
          body: Buffer.from(
            JSON.stringify({
              testName: "good",
              originalSelector: ".a",
              healedTarget: ".b",
              score: 0.95,
            }),
          ),
        },
      ],
    } as never,
  );
  const out = reporter.render();
  // Only the one valid heal is counted; the malformed entries were skipped.
  expect(out).toContain("selfmend: 1 locator healed");
  expect(out).toContain("good");
});
