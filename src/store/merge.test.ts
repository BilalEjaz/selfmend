import { describe, it, expect } from "vitest";
import { mergeShards, refresh, prune, mergeBaselines } from "./merge.js";
import { STORE_FORMAT_VERSION } from "./schema.js";
import type { BaselineFile, ShardFile } from "./schema.js";
import type { Fingerprint } from "../matching/types.js";
import { BaselineStore } from "./store.js";

function fp(over: Partial<Fingerprint> = {}): Fingerprint {
  return {
    tag: "button",
    role: "button",
    text: "Submit",
    testId: "submit-btn",
    attrs: { type: "button" },
    ordinal: 1,
    parentTag: "form",
    neighbourSignature: "input>button",
    ...over,
  };
}

function shard(
  captures: Record<string, Fingerprint>,
  seen: string[],
): ShardFile {
  return { version: STORE_FORMAT_VERSION, captures, seen };
}

describe("mergeShards (D-13 deterministic)", () => {
  it("is order-independent for disjoint shards (merge([A,B]) deep-equals merge([B,A]))", () => {
    const a = shard({ k1: fp({ text: "one" }) }, ["k1"]);
    const b = shard({ k2: fp({ text: "two" }) }, ["k2"]);

    const ab = mergeShards([a, b]);
    const ba = mergeShards([b, a]);

    expect(ab.captures).toEqual(ba.captures);
    expect([...ab.seen].sort()).toEqual([...ba.seen].sort());
    expect(ab.captures).toEqual({ k1: fp({ text: "one" }), k2: fp({ text: "two" }) });
  });

  it("unions the seen-key sets across shards", () => {
    const a = shard({ k1: fp() }, ["k1", "shared"]);
    const b = shard({ k2: fp() }, ["k2", "shared"]);
    const merged = mergeShards([a, b]);
    expect([...merged.seen].sort()).toEqual(["k2", "k1", "shared"].sort());
    expect(merged.seen instanceof Set).toBe(true);
  });

  it("resolves a same-key conflict by ONE defined precedence, identical regardless of order (D-13)", () => {
    // Distinct shard payloads must merge to a single, order-stable value.
    const a = shard({ dup: fp({ text: "from-A" }) }, ["dup"]);
    const b = shard({ dup: fp({ text: "from-B" }) }, ["dup"]);

    const ab = mergeShards([a, b]);
    const ba = mergeShards([b, a]);

    // Whatever the rule, the result must be identical both ways (deterministic).
    expect(ab.captures).toEqual(ba.captures);
    // And it must have chosen one of the two captured values, not merged fields.
    expect(["from-A", "from-B"]).toContain(ab.captures.dup!.text);
  });

  it("handles an empty shard list -> empty captures + empty seen", () => {
    const merged = mergeShards([]);
    expect(merged.captures).toEqual({});
    expect(merged.seen.size).toBe(0);
  });
});

describe("refresh (D-08 overwrite-on-recapture)", () => {
  it("overwrites a baseline key present in merged, leaves baseline-only keys untouched", () => {
    const baseline: BaselineFile = {
      version: STORE_FORMAT_VERSION,
      entries: {
        recaptured: fp({ text: "old" }),
        untouched: fp({ text: "stays" }),
      },
    };
    const merged = {
      captures: { recaptured: fp({ text: "new" }), fresh: fp({ text: "brand-new" }) },
      seen: new Set(["recaptured", "fresh"]),
    };
    const next = refresh(baseline, merged);

    expect(next.version).toBe(STORE_FORMAT_VERSION);
    expect(next.entries.recaptured!.text).toBe("new");
    expect(next.entries.untouched!.text).toBe("stays");
    expect(next.entries.fresh!.text).toBe("brand-new");
  });

  it("does not mutate the input baseline (returns a new object)", () => {
    const baseline: BaselineFile = {
      version: STORE_FORMAT_VERSION,
      entries: { k: fp({ text: "old" }) },
    };
    refresh(baseline, { captures: { k: fp({ text: "new" }) }, seen: new Set(["k"]) });
    expect(baseline.entries.k!.text).toBe("old");
  });
});

describe("prune (D-09 remove-unseen, separate pure fn)", () => {
  it("keeps only keys present in seenKeys; removes a key absent from seenKeys", () => {
    const store: BaselineFile = {
      version: STORE_FORMAT_VERSION,
      entries: { keep: fp(), drop: fp() },
    };
    const pruned = prune(store, new Set(["keep"]));
    expect(Object.keys(pruned.entries)).toEqual(["keep"]);
    expect(pruned.version).toBe(STORE_FORMAT_VERSION);
  });

  it("returns an empty store given an empty seenKeys set", () => {
    const store: BaselineFile = {
      version: STORE_FORMAT_VERSION,
      entries: { a: fp(), b: fp() },
    };
    expect(prune(store, new Set()).entries).toEqual({});
  });

  it("does not mutate the input store", () => {
    const store: BaselineFile = {
      version: STORE_FORMAT_VERSION,
      entries: { a: fp(), b: fp() },
    };
    prune(store, new Set(["a"]));
    expect(Object.keys(store.entries).sort()).toEqual(["a", "b"]);
  });

  it("takes only (store, seenKeys) — no completeness flag (gating lives at the call site, D-09)", () => {
    // The pure prune signature accepts exactly two args; the COMPLETE-RUN gate
    // + SELFMEND_PRUNE opt-in are the reporter's job (Plan 03-03), not here.
    expect(prune.length).toBe(2);
  });
});

describe("mergeBaselines (STORE-03 deterministic, order-independent)", () => {
  /** Build a one-or-more-key BaselineStore for merge inputs. */
  function storeOf(entries: Record<string, Fingerprint>): BaselineStore {
    const store = new BaselineStore();
    for (const [key, fingerprint] of Object.entries(entries)) {
      store.set(key, fingerprint);
    }
    return store;
  }

  it("combines DISJOINT stores losing no entry from either side", () => {
    const a = storeOf({ k1: fp({ text: "one" }) });
    const b = storeOf({ k2: fp({ text: "two" }) });

    const merged = mergeBaselines(a, b);
    expect(merged.has("k1")).toBe(true);
    expect(merged.has("k2")).toBe(true);
    expect(merged.get("k1")).toEqual(fp({ text: "one" }));
    expect(merged.get("k2")).toEqual(fp({ text: "two" }));
  });

  it("is order-independent over DISJOINT inputs (merge(a,b) deep-equals merge(b,a))", () => {
    const a = storeOf({ k1: fp({ text: "one" }) });
    const b = storeOf({ k2: fp({ text: "two" }) });

    expect(mergeBaselines(a, b).toBaselineFile()).toEqual(
      mergeBaselines(b, a).toBaselineFile(),
    );
  });

  it("resolves a same-key conflict deterministically, identical regardless of order (OVERLAPPING)", () => {
    const a = storeOf({ dup: fp({ text: "from-A" }) });
    const b = storeOf({ dup: fp({ text: "from-B" }) });

    const ab = mergeBaselines(a, b).toBaselineFile();
    const ba = mergeBaselines(b, a).toBaselineFile();

    // Same winner both ways, and it is one of the two captured values (not a field merge).
    expect(ab).toEqual(ba);
    expect(["from-A", "from-B"]).toContain(ab.entries.dup!.text);
    // The deterministic value-derived rule matches mergeShards (max compare key).
    const viaShards = mergeShards([
      shard({ dup: fp({ text: "from-A" }) }, []),
      shard({ dup: fp({ text: "from-B" }) }, []),
    ]);
    expect(ab.entries.dup).toEqual(viaShards.captures.dup);
  });

  it("collapses identical captures for the same key to that one value", () => {
    const a = storeOf({ same: fp({ text: "x" }) });
    const b = storeOf({ same: fp({ text: "x" }) });
    const merged = mergeBaselines(a, b).toBaselineFile();
    expect(merged.entries.same).toEqual(fp({ text: "x" }));
  });

  it("returns an empty store for zero arguments and a passthrough for one", () => {
    expect(mergeBaselines().toBaselineFile().entries).toEqual({});

    const only = storeOf({ k: fp({ text: "solo" }) });
    expect(mergeBaselines(only).toBaselineFile()).toEqual(only.toBaselineFile());
  });
});
