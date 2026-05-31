import { describe, it, expect } from "vitest";
import { mergeShards, refresh, prune } from "./merge.js";
import { STORE_FORMAT_VERSION } from "./schema.js";
import type { BaselineFile, ShardFile } from "./schema.js";
import type { Fingerprint } from "../matching/types.js";

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
