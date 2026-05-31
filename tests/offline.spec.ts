/**
 * PRIV-01 proof: the entire capture + heal cycle runs fully offline.
 *
 * The product's headline privacy guarantee is that NOTHING leaves the user's
 * CI during healing — no network calls, no API key, no telemetry (D-03/D-04).
 * This test proves that mechanically rather than asserting it: it installs a
 * throw-on-egress block over the common Node-process outbound APIs
 * (net / http / https / http2 / tls / dns + global fetch), then runs the same
 * real capture->heal cycle as tests/heal.spec.ts and asserts ZERO outbound
 * attempts.
 *
 * WHAT IS BLOCKED (precisely): the connection-establishing entry points of
 * net (connect / createConnection / Socket.prototype.connect), http and https
 * (request / get), http2 (connect), tls (connect), dns (lookup / resolve and
 * their promises variants), and global fetch. This is the set of APIs through
 * which a Node process opens a NEW outbound connection.
 *
 * WHAT IS NOT BLOCKED (known boundaries, by design): a socket that is ALREADY
 * connected and then reused (HTTP keep-alive `Agent` pooling, or a raw
 * `net.Socket` obtained by some path other than the three patched entry points
 * and then `.write()`-en), and UDP/dgram. Patching `Socket.prototype.write`
 * would break unrelated stdio (stdout is a Socket on some platforms), so it is
 * deliberately not patched. These gaps are acceptable because the REAL offline
 * guarantee is structural, not behavioural: the package is offline BY
 * CONSTRUCTION — `src/` imports none of node:net/http/https/http2/tls/dns
 * (enforced by the nul-guard CI workflow) and the only runtime deps are `zod`
 * and `picocolors` (neither makes network calls). This egress block is a
 * belt-and-braces runtime proof on top of that structural guarantee, not the
 * sole line of defence.
 *
 * SELF-VALIDATION (the load-bearing design): a test that only asserts
 * `egress === 0` is worthless if nothing ever tried to connect — it would pass
 * even if the block were a no-op. So the first test PROVES the harness genuinely
 * trips: with the block installed it makes a real outbound attempt against
 * EVERY patched surface and asserts each one THROWS an OfflineViolationError AND
 * increments the egress counter. If a future refactor silently turns any patch
 * into a no-op, that test fails. Only then does the second test assert the heal
 * cycle keeps that counter at 0.
 *
 * WHY a blanket throw is safe for the browser (VERIFIED in research, instrumented
 * in this repo): a real Chromium launch+page+click+evaluate makes ZERO calls to
 * net.connect / net.Socket.connect / http.request / https.request / http2.connect
 * / dns.* / tls.connect / fetch. Chromium's CDP transport is a
 * child_process.spawn + stdio pipe, NOT a Node TCP socket — so blocking the Node
 * net layer never breaks it. No loopback allowlist is required.
 *
 * SCOPE: the block is installed PER-TEST (beforeEach) and fully restored
 * (afterEach), NEVER in globalSetup — globalSetup would also block the CI
 * browser download / bootstrap (Pitfall 1). The store/merge path is proven
 * network-free statically by the Task 3 CI guard (src/ imports no node:net/dns/
 * tls/http/https/http2), so this file is the canonical heal-cycle proof only.
 */
import { expect } from "@playwright/test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import net from "node:net";
import http from "node:http";
import https from "node:https";
import http2 from "node:http2";
import dns from "node:dns";
import tls from "node:tls";

import { healingFixture as test } from "../src/integration/fixture.js";
import { HEAL_ATTACHMENT_NAME } from "../src/integration/events.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const INDEX_URL = pathToFileURL(resolve(HERE, "./fixture-app/index.html")).href;
const BROKEN_URL = pathToFileURL(resolve(HERE, "./fixture-app/broken.html")).href;

/** Thrown by every patched egress API; distinct type so the trip is unambiguous. */
class OfflineViolationError extends Error {
  constructor(label: string) {
    super(`offline violation: ${label} attempted an outbound connection`);
    this.name = "OfflineViolationError";
  }
}

/** Mutable egress tally shared with the test body. */
interface EgressCounter {
  n: number;
}

/**
 * Number of distinct surfaces patched by {@link installEgressBlock}. Set on the
 * first install and used by the self-validation test to assert the probe list
 * stays in lockstep with the patch list (a patch added without a probe, or vice
 * versa, makes the self-validation fail). `-1` until the block has been
 * installed at least once.
 */
let PATCHED_SURFACE_COUNT = -1;

/**
 * Patch the common Node-process outbound connection APIs to increment
 * `counter.n` and throw an {@link OfflineViolationError}. Returns a `restore()`
 * that reverts every patch in reverse so the block never leaks to another test.
 */
function installEgressBlock(counter: EgressCounter): () => void {
  const restores: Array<() => void> = [];

  const block =
    (label: string) =>
    (..._args: unknown[]): never => {
      counter.n++;
      throw new OfflineViolationError(label);
    };

  const patch = <T extends object>(obj: T, key: keyof T, label: string): void => {
    const orig = obj[key];
    (obj as Record<PropertyKey, unknown>)[key as PropertyKey] = block(label);
    restores.push(() => {
      (obj as Record<PropertyKey, unknown>)[key as PropertyKey] = orig;
    });
  };

  patch(net, "connect", "net.connect");
  patch(net, "createConnection", "net.createConnection");
  patch(net.Socket.prototype, "connect", "net.Socket.connect");
  patch(http, "request", "http.request");
  patch(http, "get", "http.get");
  patch(https, "request", "https.request");
  patch(https, "get", "https.get");
  patch(http2, "connect", "http2.connect");
  patch(dns, "lookup", "dns.lookup");
  patch(dns, "resolve", "dns.resolve");
  patch(dns.promises, "lookup", "dns.promises.lookup");
  patch(dns.promises, "resolve", "dns.promises.resolve");
  patch(tls, "connect", "tls.connect");

  const origFetch = globalThis.fetch;
  globalThis.fetch = block("fetch") as typeof fetch;
  restores.push(() => {
    globalThis.fetch = origFetch;
  });

  // Record how many surfaces were patched so the self-validation test can
  // assert its probe list covers exactly this many (no silent drift).
  PATCHED_SURFACE_COUNT = restores.length;

  return () => {
    // Restore in reverse install order.
    for (let i = restores.length - 1; i >= 0; i--) restores[i]!();
  };
}

// Per-test install + restore so the block is local and never leaks. NOT in
// globalSetup (that would also block the CI browser download — Pitfall 1).
const counter: EgressCounter = { n: 0 };
let restore: () => void = () => {};

test.beforeEach(() => {
  counter.n = 0;
  restore = installEgressBlock(counter);
});

test.afterEach(() => {
  restore();
  restore = () => {};
});

/**
 * One probe per patched surface. Each `attempt` makes a REAL outbound call
 * against the corresponding patched API; with the block installed every one
 * must throw {@link OfflineViolationError} AND bump the egress counter. Keeping
 * this list in lockstep with the patches in {@link installEgressBlock} is what
 * makes the self-validation load-bearing: if a future refactor leaves any
 * surface unpatched (or turns a patch into a no-op), its probe stops throwing /
 * stops incrementing and this test fails. Adding a new patched surface without
 * adding its probe here also fails (the count assertion below).
 */
const EGRESS_PROBES: ReadonlyArray<{ label: string; attempt: () => unknown }> = [
  { label: "fetch", attempt: () => globalThis.fetch("http://example.com") },
  { label: "net.connect", attempt: () => net.connect(80, "example.com") },
  {
    label: "net.createConnection",
    attempt: () => net.createConnection({ port: 80, host: "example.com" }),
  },
  {
    label: "net.Socket.connect",
    // A bare Socket whose connect() is the patched prototype method.
    attempt: () => new net.Socket().connect(80, "example.com"),
  },
  { label: "http.request", attempt: () => http.request("http://example.com") },
  { label: "http.get", attempt: () => http.get("http://example.com") },
  { label: "https.request", attempt: () => https.request("https://example.com") },
  { label: "https.get", attempt: () => https.get("https://example.com") },
  { label: "http2.connect", attempt: () => http2.connect("http://example.com") },
  { label: "dns.lookup", attempt: () => dns.lookup("example.com", () => {}) },
  { label: "dns.resolve", attempt: () => dns.resolve("example.com", () => {}) },
  { label: "dns.promises.lookup", attempt: () => dns.promises.lookup("example.com") },
  { label: "dns.promises.resolve", attempt: () => dns.promises.resolve("example.com") },
  { label: "tls.connect", attempt: () => tls.connect({ port: 443, host: "example.com" }) },
];

test("PRIV-01 self-validation: EVERY patched egress surface genuinely trips", () => {
  // If any probe fails to throw OR fails to increment the counter, the harness
  // for that surface is a no-op and the zero-egress proof is invalid for it.
  for (const { label, attempt } of EGRESS_PROBES) {
    const before = counter.n;
    expect(attempt, `${label} must throw OfflineViolationError`).toThrow(
      OfflineViolationError,
    );
    expect(counter.n, `${label} must increment the egress counter`).toBe(before + 1);
  }

  // Lockstep guard: the number of trips must equal the number of probes, AND
  // both must equal the number of patches installed by installEgressBlock. If
  // a patch is added without a probe (or vice versa), this fails loudly.
  expect(counter.n).toBe(EGRESS_PROBES.length);
  expect(counter.n).toBe(PATCHED_SURFACE_COUNT);
});

test("PRIV-01: a full capture+heal cycle completes with zero network egress", async ({
  page,
}, testInfo) => {
  // The egress block is already installed by beforeEach and the counter reset.
  // 1. Capture on the good page: resolve the submit button via its class
  //    selector (records the fingerprint, incl. the stable test-id). Reuse the
  //    SAME wrapped locator for capture AND heal so its baseline key is stable.
  await page.goto(INDEX_URL);
  const submit = page.locator(".btn-primary");
  await submit.waitFor();

  // 2. The class is renamed in broken.html; the SAME locator keeps the same
  //    baseline key, so the heal loop has a fingerprint to match against.
  await page.goto(BROKEN_URL);

  // The real attempt auto-waits to timeout (.btn-primary is gone), throws
  // TimeoutError, the scorer matches the surviving Submit button, and the
  // action replays green — all inside the browser + in-process scorer.
  await submit.click({ timeout: 1200 });

  // The healed element is the same semantic Submit button.
  const healed = page.locator('[data-testid="submit-btn"]');
  await expect(healed).toHaveText("Submit");

  // A heal event was attached (so the cycle genuinely healed, did not no-op).
  const healAttachments = testInfo.attachments.filter(
    (a) => a.name === HEAL_ATTACHMENT_NAME,
  );
  expect(healAttachments).toHaveLength(1);
  const event = JSON.parse(healAttachments[0]!.body!.toString());
  expect(event.originalSelector).toContain(".btn-primary");
  expect(event.healedTarget).toContain("submit-btn");
  expect(event.score).toBeGreaterThanOrEqual(0.9);

  // THE LOAD-BEARING PRIV-01 ASSERTION: the entire offline capture+heal path
  // attempted ZERO outbound connections. Self-validated above to be non-trivial.
  expect(counter.n).toBe(0);
});
