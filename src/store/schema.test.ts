import { describe, it, expect } from "vitest";
import {
  STORE_FORMAT_VERSION,
  parseBaseline,
  parseShard,
  fingerprintSchema,
} from "./schema.js";
import type { Fingerprint } from "../matching/types.js";

/** A well-formed derived-signals-only fingerprint used across cases. */
const fp: Fingerprint = {
  tag: "button",
  role: "button",
  text: "Submit",
  testId: "submit-btn",
  attrs: { name: "submit", type: "button" },
  ordinal: 2,
  parentTag: "form",
  neighbourSignature: "input>button",
};

describe("STORE_FORMAT_VERSION", () => {
  it("is a numeric literal (public semver contract, D-10)", () => {
    expect(typeof STORE_FORMAT_VERSION).toBe("number");
  });
});

describe("parseBaseline (D-10 safe-parse-or-ignore)", () => {
  it("round-trips a well-formed baseline file to the same entries", () => {
    const raw = {
      version: STORE_FORMAT_VERSION,
      entries: { "a.spec.ts > t > #x 0": fp },
    };
    const out = parseBaseline(raw);
    expect(out.version).toBe(STORE_FORMAT_VERSION);
    expect(out.entries).toEqual({ "a.spec.ts > t > #x 0": fp });
  });

  it("decodes a version-mismatched file to the EMPTY store without throwing (D-10)", () => {
    const raw = { version: STORE_FORMAT_VERSION + 99, entries: { k: fp } };
    let out;
    expect(() => {
      out = parseBaseline(raw);
    }).not.toThrow();
    expect(out).toEqual({ version: STORE_FORMAT_VERSION, entries: {} });
  });

  it("decodes an older-version file to the EMPTY store without throwing (D-10)", () => {
    const raw = { version: 0, entries: { k: fp } };
    expect(parseBaseline(raw)).toEqual({
      version: STORE_FORMAT_VERSION,
      entries: {},
    });
  });

  it("decodes a structurally malformed object (missing entries) to EMPTY, never throws", () => {
    expect(() => parseBaseline({ version: STORE_FORMAT_VERSION })).not.toThrow();
    expect(parseBaseline({ version: STORE_FORMAT_VERSION })).toEqual({
      version: STORE_FORMAT_VERSION,
      entries: {},
    });
  });

  it("decodes a fingerprint missing a required field to EMPTY, never throws", () => {
    const raw = {
      version: STORE_FORMAT_VERSION,
      entries: { k: { tag: "button" } },
    };
    expect(parseBaseline(raw)).toEqual({
      version: STORE_FORMAT_VERSION,
      entries: {},
    });
  });

  it("decodes a non-string attr value to EMPTY, never throws", () => {
    const raw = {
      version: STORE_FORMAT_VERSION,
      entries: { k: { ...fp, attrs: { name: 123 } } },
    };
    expect(parseBaseline(raw)).toEqual({
      version: STORE_FORMAT_VERSION,
      entries: {},
    });
  });

  it("decodes a non-object / null input to EMPTY, never throws", () => {
    expect(parseBaseline(null)).toEqual({
      version: STORE_FORMAT_VERSION,
      entries: {},
    });
    expect(parseBaseline("not json")).toEqual({
      version: STORE_FORMAT_VERSION,
      entries: {},
    });
    expect(parseBaseline(undefined)).toEqual({
      version: STORE_FORMAT_VERSION,
      entries: {},
    });
  });
});

describe("parseShard (Open Q3 shard shape)", () => {
  it("validates a well-formed shard { version, captures, seen }", () => {
    const raw = {
      version: STORE_FORMAT_VERSION,
      captures: { "a.spec.ts > t > #x 0": fp },
      seen: ["a.spec.ts > t > #x 0", "a.spec.ts > t > #y 0"],
    };
    const out = parseShard(raw);
    expect(out.captures).toEqual({ "a.spec.ts > t > #x 0": fp });
    expect(out.seen).toEqual([
      "a.spec.ts > t > #x 0",
      "a.spec.ts > t > #y 0",
    ]);
  });

  it("decodes a version-mismatched shard to EMPTY, never throws (D-10)", () => {
    const raw = {
      version: STORE_FORMAT_VERSION + 1,
      captures: { k: fp },
      seen: ["k"],
    };
    expect(parseShard(raw)).toEqual({
      version: STORE_FORMAT_VERSION,
      captures: {},
      seen: [],
    });
  });

  it("decodes a malformed shard (seen not an array) to EMPTY, never throws", () => {
    const raw = {
      version: STORE_FORMAT_VERSION,
      captures: { k: fp },
      seen: "k",
    };
    expect(parseShard(raw)).toEqual({
      version: STORE_FORMAT_VERSION,
      captures: {},
      seen: [],
    });
  });
});

describe("fingerprintSchema (D-02 derived-signals-only, strict)", () => {
  it("has exactly the eight derived-signal keys, no raw-DOM field", () => {
    const known = Object.keys(fingerprintSchema.shape).sort();
    expect(known).toEqual(
      [
        "attrs",
        "neighbourSignature",
        "ordinal",
        "parentTag",
        "role",
        "tag",
        "testId",
        "text",
      ].sort(),
    );
  });

  it("rejects an object carrying innerHTML/outerHTML/html (strict, D-02 / V8)", () => {
    for (const leak of ["innerHTML", "outerHTML", "html", "innerText"]) {
      const dirty = { ...fp, [leak]: "<div>secret</div>" };
      expect(fingerprintSchema.safeParse(dirty).success).toBe(false);
    }
  });

  it("accepts a clean derived-signals-only fingerprint", () => {
    expect(fingerprintSchema.safeParse(fp).success).toBe(true);
  });

  it("rejects a fingerprint with a raw-DOM field embedded in a baseline entry (no leak persists)", () => {
    const raw = {
      version: STORE_FORMAT_VERSION,
      entries: { k: { ...fp, innerHTML: "<div>secret</div>" } },
    };
    // strict schema -> unknown key fails -> ignore-and-recapture, no raw DOM persisted
    expect(parseBaseline(raw)).toEqual({
      version: STORE_FORMAT_VERSION,
      entries: {},
    });
  });
});
