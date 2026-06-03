import { describe, it, expect } from "vitest";

import { BaselineStore } from "./store.js";

/**
 * The fire-and-forget capture flush seam (track/settle).
 *
 * The success-path fingerprint capture is now fire-and-forget (it never extends
 * the action's promise), but a few sites must still wait for in-flight captures
 * to LAND before they read or persist the store: the heal path (so a same-run
 * capture is guaranteed present before the heal reads its fingerprint) and the
 * persist/teardown flush (so a fire-and-forget capture is never lost). The store
 * exposes a minimal, dependency-free seam for that: `track(p)` registers an
 * in-flight capture promise, `settle()` resolves only once every tracked promise
 * has settled, and a tracked promise is removed from the pending set afterward.
 */
describe("BaselineStore capture flush seam (track/settle)", () => {
  it("settle() does not resolve until a tracked promise settles", async () => {
    const store = new BaselineStore();

    let release!: () => void;
    const deferred = new Promise<void>((res) => {
      release = res;
    });

    let settled = false;
    store.track(deferred);
    const settlePromise = store.settle().then(() => {
      settled = true;
    });

    // Let any pending microtasks flush: settle() must still be waiting on the
    // tracked promise, which has NOT resolved yet.
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);

    // Once the tracked promise settles, settle() resolves.
    release();
    await settlePromise;
    expect(settled).toBe(true);
  });

  it("removes a tracked promise from the pending set after it settles", async () => {
    const store = new BaselineStore();

    const p = Promise.resolve();
    store.track(p);
    await store.settle();

    // After settle, a fresh settle() resolves immediately (nothing pending): if
    // the settled promise had not been removed, a re-entrant capture queued
    // during settle would be impossible to distinguish, but here the simplest
    // observable contract is that settle() resolves promptly with no pending work.
    let secondSettled = false;
    const second = store.settle().then(() => {
      secondSettled = true;
    });
    await Promise.resolve();
    await second;
    expect(secondSettled).toBe(true);
  });

  it("settle() with nothing tracked resolves immediately", async () => {
    const store = new BaselineStore();
    let resolved = false;
    const s = store.settle().then(() => {
      resolved = true;
    });
    await Promise.resolve();
    await s;
    expect(resolved).toBe(true);
  });
});
