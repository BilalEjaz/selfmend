import { describe, it, expect } from "vitest";
import { serialize } from "./serialize.js";
import { parseBaseline, STORE_FORMAT_VERSION } from "./schema.js";
import type { BaselineFile } from "./schema.js";
import type { Fingerprint } from "../matching/types.js";

function fp(over: Partial<Fingerprint> = {}): Fingerprint {
  return {
    tag: "button",
    role: "button",
    text: "Submit",
    testId: "submit-btn",
    attrs: { type: "button", name: "submit" },
    ordinal: 1,
    parentTag: "form",
    neighbourSignature: "input>button",
    ...over,
  };
}

describe("serialize (D-03 deterministic)", () => {
  it("is byte-identical for the same logical store regardless of entry-key insertion order", () => {
    const a: BaselineFile = {
      version: STORE_FORMAT_VERSION,
      entries: {},
    };
    a.entries["z-key"] = fp({ text: "Z" });
    a.entries["a-key"] = fp({ text: "A" });
    a.entries["m-key"] = fp({ text: "M" });

    const b: BaselineFile = {
      version: STORE_FORMAT_VERSION,
      entries: {},
    };
    b.entries["a-key"] = fp({ text: "A" });
    b.entries["m-key"] = fp({ text: "M" });
    b.entries["z-key"] = fp({ text: "Z" });

    expect(serialize(a)).toBe(serialize(b));
  });

  it("is byte-identical regardless of attrs-key insertion order", () => {
    const a: BaselineFile = {
      version: STORE_FORMAT_VERSION,
      entries: { k: fp({ attrs: { type: "button", name: "submit", id: "x" } }) },
    };
    const b: BaselineFile = {
      version: STORE_FORMAT_VERSION,
      entries: { k: fp({ attrs: { id: "x", name: "submit", type: "button" } }) },
    };
    expect(serialize(a)).toBe(serialize(b));
  });

  it("is idempotent: serialize(store) === serialize(store)", () => {
    const store: BaselineFile = {
      version: STORE_FORMAT_VERSION,
      entries: { k: fp() },
    };
    expect(serialize(store)).toBe(serialize(store));
  });

  it("emits valid JSON that round-trips through parseBaseline to the same entries", () => {
    const store: BaselineFile = {
      version: STORE_FORMAT_VERSION,
      entries: { "a 0": fp({ text: "A" }), "b 0": fp({ text: "B" }) },
    };
    const text = serialize(store);
    const reloaded = parseBaseline(JSON.parse(text));
    expect(reloaded.entries).toEqual(store.entries);
  });

  it("carries version: STORE_FORMAT_VERSION", () => {
    const store: BaselineFile = {
      version: STORE_FORMAT_VERSION,
      entries: { k: fp() },
    };
    expect(JSON.parse(serialize(store)).version).toBe(STORE_FORMAT_VERSION);
  });

  it("ends with a trailing newline (POSIX-friendly committed file)", () => {
    const store: BaselineFile = {
      version: STORE_FORMAT_VERSION,
      entries: { k: fp() },
    };
    expect(serialize(store).endsWith("\n")).toBe(true);
  });

  it("contains no field name outside the eight derived signals + version/entries (no raw-DOM leak, D-02)", () => {
    const store: BaselineFile = {
      version: STORE_FORMAT_VERSION,
      entries: { k: fp() },
    };
    const text = serialize(store);
    for (const banned of ["innerHTML", "outerHTML", "html", "innerText"]) {
      expect(text).not.toContain(banned);
    }
    // Only the known scaffolding + signal keys may appear as JSON keys.
    const keys = new Set<string>();
    JSON.parse(text, (k, v) => {
      if (k) keys.add(k);
      return v;
    });
    const allowed = new Set([
      "version",
      "entries",
      "tag",
      "role",
      "text",
      "testId",
      "attrs",
      "ordinal",
      "parentTag",
      "neighbourSignature",
      // attrs keys (data values) are arbitrary names; allow the ones we used
      "type",
      "name",
      "k",
    ]);
    for (const key of keys) {
      expect(allowed.has(key)).toBe(true);
    }
  });
});
