import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  atomicWrite,
  baselinePath,
  deleteShards,
  loadBaseline,
  loadCommittedBaseline,
  readShards,
  saveBaseline,
  shardPath,
  shardsDir,
  writeShard,
} from "./persistence.js";
import { STORE_FORMAT_VERSION, type ShardFile } from "./schema.js";
import { BaselineStore } from "./store.js";
import type { Fingerprint } from "../matching/types.js";

/** A minimal, schema-valid fingerprint for round-trip assertions. */
function fp(overrides: Partial<Fingerprint> = {}): Fingerprint {
  return {
    tag: "button",
    role: "button",
    text: "Save",
    testId: "save-btn",
    attrs: { type: "submit" },
    ordinal: 0,
    parentTag: "form",
    neighbourSignature: "input,button",
    ...overrides,
  };
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "selfmend-persist-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("path helpers resolve UNDER rootDir (no traversal escape)", () => {
  it("baselinePath/shardsDir/shardPath stay inside rootDir", () => {
    const root = path.resolve(dir);
    const bp = baselinePath(root);
    const sd = shardsDir(root);
    const sp = shardPath(root, 3);

    // Containment: every derived path must be the rootDir or below it.
    for (const p of [bp, sd, sp]) {
      const rel = path.relative(root, p);
      expect(rel.startsWith("..")).toBe(false);
      expect(path.isAbsolute(rel)).toBe(false);
    }
    expect(bp).toBe(path.join(root, ".selfmend", "baseline.json"));
    expect(sd).toBe(path.join(root, ".selfmend", "shards"));
    expect(sp).toBe(path.join(root, ".selfmend", "shards", "shard-3.json"));
  });

  it("a SELFMEND_STORE_DIR override is still resolved under rootDir", () => {
    const root = path.resolve(dir);
    // A traversal attempt in the override must not escape rootDir.
    const bp = baselinePath(root, "../../../etc/evil");
    const rel = path.relative(root, bp);
    expect(rel.startsWith("..")).toBe(false);
  });
});

describe("writeShard / readShards round-trip", () => {
  it("writeShard then readShards returns the written shard", async () => {
    const root = path.resolve(dir);
    const sd = shardsDir(root);
    const shard: ShardFile = {
      version: STORE_FORMAT_VERSION,
      captures: { "spec.ts t page.locator(button) 0": fp() },
      seen: ["spec.ts t page.locator(button) 0"],
    };
    await writeShard(shardPath(root, 0), shard);

    const shards = await readShards(sd);
    expect(shards).toHaveLength(1);
    expect(shards[0]!.captures["spec.ts t page.locator(button) 0"]).toEqual(fp());
    expect(shards[0]!.seen).toEqual(["spec.ts t page.locator(button) 0"]);
  });

  it("readShards over a dir with N shard files returns N parsed shards", async () => {
    const root = path.resolve(dir);
    const sd = shardsDir(root);
    for (const idx of [0, 1, 2]) {
      await writeShard(shardPath(root, idx), {
        version: STORE_FORMAT_VERSION,
        captures: { [`k${idx}`]: fp({ text: `T${idx}` }) },
        seen: [`k${idx}`],
      });
    }
    const shards = await readShards(sd);
    expect(shards).toHaveLength(3);
  });

  it("readShards skips a malformed/foreign shard file (never throws)", async () => {
    const root = path.resolve(dir);
    const sd = shardsDir(root);
    await mkdir(sd, { recursive: true });
    // One good shard, one non-JSON, one wrong-version: only the good one survives.
    await writeShard(shardPath(root, 0), {
      version: STORE_FORMAT_VERSION,
      captures: { good: fp() },
      seen: ["good"],
    });
    await writeFile(path.join(sd, "shard-1.json"), "}{ not json", "utf8");
    await writeFile(
      path.join(sd, "shard-2.json"),
      JSON.stringify({ version: 999, captures: {}, seen: [] }),
      "utf8",
    );

    const shards = await readShards(sd);
    // Bad files parse to the EMPTY shard, not a throw; the good capture is intact.
    const allCaptures = shards.flatMap((s) => Object.keys(s.captures));
    expect(allCaptures).toContain("good");
    // No throw was the assertion; we got an array back.
    expect(Array.isArray(shards)).toBe(true);
  });

  it("readShards on a missing shards dir returns [] (never throws)", async () => {
    const root = path.resolve(dir);
    const shards = await readShards(shardsDir(root));
    expect(shards).toEqual([]);
  });
});

describe("atomicWrite + loadCommittedBaseline round-trip (CAP-02)", () => {
  it("atomicWrite then read returns exactly the bytes; no leftover .tmp", async () => {
    const root = path.resolve(dir);
    const bp = baselinePath(root);
    await mkdir(path.dirname(bp), { recursive: true });
    const data = JSON.stringify({ hello: "world" }) + "\n";

    await atomicWrite(bp, data);

    expect(await readFile(bp, "utf8")).toBe(data);
    // No temp sibling left behind.
    const siblings = await readdir(path.dirname(bp));
    expect(siblings.some((f: string) => f.includes(".tmp"))).toBe(false);
  });

  it("a store written via atomicWrite reloads via loadCommittedBaseline with fingerprints intact", async () => {
    const root = path.resolve(dir);
    const { serialize } = await import("./serialize.js");
    const key = "spec.ts t > case page.locator(button) 0";
    const baseline = {
      version: STORE_FORMAT_VERSION as typeof STORE_FORMAT_VERSION,
      entries: { [key]: fp() },
    } satisfies import("./schema.js").BaselineFile;
    const bp = baselinePath(root);
    await mkdir(path.dirname(bp), { recursive: true });
    await atomicWrite(bp, serialize(baseline));

    const store = await loadCommittedBaseline(root);
    expect(store.has(key)).toBe(true);
    expect(store.get(key)).toEqual(fp());
  });
});

describe("loadCommittedBaseline fail-soft (Pitfall 5)", () => {
  it("missing baseline file loads as the EMPTY store, never throws", async () => {
    const root = path.resolve(dir);
    const store = await loadCommittedBaseline(root);
    expect(store.size).toBe(0);
  });

  it("non-JSON / version-mismatched baseline loads as the EMPTY store", async () => {
    const root = path.resolve(dir);
    const bp = baselinePath(root);
    await mkdir(path.dirname(bp), { recursive: true });
    await writeFile(bp, "}{ not json at all", "utf8");
    expect((await loadCommittedBaseline(root)).size).toBe(0);

    await writeFile(
      bp,
      JSON.stringify({ version: 999, entries: {} }),
      "utf8",
    );
    expect((await loadCommittedBaseline(root)).size).toBe(0);
  });
});

describe("atomicWrite Windows retry path (Pitfall 1)", () => {
  it("retries on a transient EPERM/EBUSY rename and ultimately writes the target", async () => {
    const root = path.resolve(dir);
    const bp = baselinePath(root);
    await mkdir(path.dirname(bp), { recursive: true });
    const data = "retried-content\n";

    let attempts = 0;
    const flakyRename = async (from: string, to: string): Promise<void> => {
      attempts++;
      if (attempts <= 2) {
        const err = new Error("EPERM: operation not permitted, rename") as NodeJS.ErrnoException;
        err.code = "EPERM";
        throw err;
      }
      // Succeed on the 3rd attempt by delegating to the real rename.
      const { rename } = await import("node:fs/promises");
      await rename(from, to);
    };

    await atomicWrite(bp, data, { rename: flakyRename, backoffMs: 1 });

    expect(attempts).toBe(3);
    expect(await readFile(bp, "utf8")).toBe(data);
    const siblings = await readdir(path.dirname(bp));
    expect(siblings.some((f: string) => f.includes(".tmp"))).toBe(false);
  });

  it("on EXHAUSTED retries removes the temp file and rethrows (no half-written target)", async () => {
    const root = path.resolve(dir);
    const bp = baselinePath(root);
    await mkdir(path.dirname(bp), { recursive: true });

    const alwaysFail = async (): Promise<void> => {
      const err = new Error("EBUSY: resource busy or locked, rename") as NodeJS.ErrnoException;
      err.code = "EBUSY";
      throw err;
    };

    await expect(
      atomicWrite(bp, "never-lands\n", {
        rename: alwaysFail,
        maxAttempts: 4,
        backoffMs: 1,
      }),
    ).rejects.toThrow(/EBUSY/);

    // Target never created; no temp left behind.
    const siblings = await readdir(path.dirname(bp));
    expect(siblings.some((f: string) => f.includes(".tmp"))).toBe(false);
    expect(siblings.includes("baseline.json")).toBe(false);
  });
});

describe("deleteShards (D-12 transient cleanup)", () => {
  it("removes the shards dir; ignores a missing dir", async () => {
    const root = path.resolve(dir);
    const sd = shardsDir(root);
    await writeShard(shardPath(root, 0), {
      version: STORE_FORMAT_VERSION,
      captures: {},
      seen: [],
    });
    await deleteShards(sd);
    await expect(readdir(sd)).rejects.toThrow();
    // Second delete on a now-missing dir is a no-op (never throws).
    await deleteShards(sd);
  });
});

/**
 * STORE-01 / STORE-02: the standalone, path-based public loadBaseline(path) and
 * saveBaseline(path, store), decoupled from the reporter and shards. These take
 * a LITERAL file path the consumer owns (no .selfmend containment clamp), wrap
 * atomicWrite + serialize + parseBaseline, and save REFRESH-AND-ADD only (never
 * prune), so a key captured before a later save that did not recapture it
 * survives.
 */
describe("saveBaseline / loadBaseline (path-based, STORE-01)", () => {
  /** Seed a one-key store with a stable identity key. */
  function storeWith(key: string, fingerprint: Fingerprint): BaselineStore {
    const store = new BaselineStore();
    store.set(key, fingerprint);
    return store;
  }

  it("saveBaseline over a fresh path creates the file; loadBaseline reads it back", async () => {
    const target = path.join(dir, "custom", "my-baseline.json");
    const store = storeWith("k1", fp({ text: "first" }));
    await saveBaseline(target, store);

    // The file exists at the literal caller path (no .selfmend subdir injected).
    const reloaded = await loadBaseline(target);
    expect(reloaded.has("k1")).toBe(true);
    expect(reloaded.get("k1")).toEqual(fp({ text: "first" }));
  });

  it("round-trips byte-stable serialize() output (2-space, trailing newline)", async () => {
    const { serialize } = await import("./serialize.js");
    const target = path.join(dir, "rt.json");
    const store = storeWith("k1", fp({ text: "rt" }));
    await saveBaseline(target, store);

    const onDisk = await readFile(target, "utf8");
    const expected = serialize({
      version: STORE_FORMAT_VERSION,
      entries: { k1: fp({ text: "rt" }) },
    });
    expect(onDisk).toBe(expected);
    expect(onDisk.endsWith("\n")).toBe(true);
  });

  it("a missing file passed to loadBaseline yields an EMPTY store, never throws", async () => {
    const store = await loadBaseline(path.join(dir, "does-not-exist.json"));
    expect(store.size).toBe(0);
  });

  it("a malformed file passed to loadBaseline yields an EMPTY store, never throws", async () => {
    const target = path.join(dir, "bad.json");
    await writeFile(target, "}{ not json at all", "utf8");
    expect((await loadBaseline(target)).size).toBe(0);
  });
});

describe("saveBaseline survival invariant (STORE-02, refresh-only never prune)", () => {
  it("a key saved earlier survives a later save that captured nothing for it", async () => {
    const target = path.join(dir, "survive.json");

    // Run 1: capture K1 and save.
    const first = new BaselineStore();
    first.set("K1", fp({ text: "k1-value" }));
    await saveBaseline(target, first);

    // Run 2: a SECOND store that captured only K2, nothing for K1. Saving it must
    // ADD K2 while LEAVING K1 in place (refresh-and-add, never auto-prune).
    const second = new BaselineStore();
    second.set("K2", fp({ text: "k2-value" }));
    await saveBaseline(target, second);

    const merged = await loadBaseline(target);
    expect(merged.has("K1")).toBe(true);
    expect(merged.has("K2")).toBe(true);
    expect(merged.get("K1")).toEqual(fp({ text: "k1-value" }));
    expect(merged.get("K2")).toEqual(fp({ text: "k2-value" }));
  });
});
