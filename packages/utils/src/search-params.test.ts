import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  searchParamBoolean,
  searchParamDate,
  searchParamEnum,
  searchParamNumber,
  searchParamString,
  searchParamStringArray,
} from "./search-params";

describe("searchParamString", () => {
  it("trims and passes a single value through", () => {
    expect(searchParamString().parse("  hello  ")).toBe("hello");
  });

  it("unwraps a single-entry array", () => {
    expect(searchParamString().parse(["only"])).toBe("only");
  });

  it("falls back for a conflicting repeated key rather than guessing which value won", () => {
    expect(searchParamString({ fallback: "" }).parse(["first", "second"])).toBe(
      ""
    );
  });

  it("accepts a repeated key that carries the same value every time", () => {
    expect(searchParamString().parse(["same", "same", "same"])).toBe("same");
  });

  it("falls back when a repeated key mixes a string with a non-string", () => {
    const schema = searchParamString({ fallback: "" });
    expect(schema.parse(["same", 42])).toBe("");
    expect(schema.parse([42, "same"])).toBe("");
  });

  it("falls back for absent, empty, and non-string values", () => {
    const schema = searchParamString({ fallback: "" });
    expect(z.object({ q: schema }).parse({})).toEqual({ q: "" });
    expect(schema.parse("   ")).toBe("");
    expect(schema.parse([])).toBe("");
    expect(schema.parse(42)).toBe("");
  });

  it("fails instead of falling back when no fallback is given", () => {
    expect(z.object({ q: searchParamString() }).safeParse({}).success).toBe(
      false
    );
  });

  it("rejects an over-long value", () => {
    const schema = searchParamString({ maxLength: 4 });
    expect(schema.safeParse("abcde").success).toBe(false);
    expect(
      searchParamString({ fallback: "", maxLength: 4 }).parse("abcde")
    ).toBe("");
  });

  it("truncates instead when asked to", () => {
    expect(
      searchParamString({ maxLength: 4, truncate: true }).parse("abcdef")
    ).toBe("abcd");
  });

  it("does not leave a lone surrogate behind when truncating", () => {
    // "𝒜" is one astral character, i.e. two UTF-16 code units: cutting at 2
    // would split it, and cutting at 3 keeps the whole pair.
    expect(
      searchParamString({ maxLength: 2, truncate: true }).parse("a𝒜b")
    ).toBe("a");
    expect(
      searchParamString({ maxLength: 3, truncate: true }).parse("a𝒜b")
    ).toBe("a𝒜");
  });
});

describe("searchParamStringArray", () => {
  it("normalizes a single value into a one-entry list", () => {
    expect(searchParamStringArray().parse("a")).toEqual(["a"]);
  });

  it("trims entries and drops empty ones, keeping duplicates", () => {
    expect(searchParamStringArray().parse([" a ", "", "  ", "a"])).toEqual([
      "a",
      "a",
    ]);
  });

  it("falls back for a non-array, non-string value, and for an absent key", () => {
    const schema = searchParamStringArray({ fallback: [] });
    expect(schema.parse(42)).toEqual([]);
    expect(z.object({ tags: schema }).parse({})).toEqual({ tags: [] });
  });

  it("rejects too many entries but truncates when asked to", () => {
    expect(
      searchParamStringArray({ maxItems: 2 }).safeParse(["a", "b", "c"]).success
    ).toBe(false);
    expect(
      searchParamStringArray({ maxItems: 2, truncate: true }).parse([
        "a",
        "b",
        "c",
      ])
    ).toEqual(["a", "b"]);
  });
});

describe("searchParamEnum", () => {
  const schema = searchParamEnum(["asc", "desc"], { fallback: "asc" as const });

  it("keeps an allowed value", () => {
    expect(schema.parse("desc")).toBe("desc");
  });

  it("falls back for a value outside the set, and for an absent key", () => {
    expect(schema.parse("sideways")).toBe("asc");
    expect(z.object({ sort: schema }).parse({})).toEqual({ sort: "asc" });
  });

  it("accepts a set built at runtime", () => {
    const allowed: ReadonlySet<string> = new Set(["created", "updated"]);
    expect(searchParamEnum(allowed, { fallback: "" }).parse("updated")).toBe(
      "updated"
    );
    expect(searchParamEnum(allowed, { fallback: "" }).parse("deleted")).toBe(
      ""
    );
  });

  it("fails without a fallback", () => {
    expect(searchParamEnum(["asc"]).safeParse("desc").success).toBe(false);
  });
});

describe("searchParamNumber", () => {
  it("parses a decimal integer", () => {
    expect(searchParamNumber().parse("42")).toBe(42);
  });

  it("rejects the shapes Number() would silently accept", () => {
    const schema = searchParamNumber({ fallback: 0 });
    expect(schema.parse("abc")).toBe(0);
    expect(schema.parse("0x10")).toBe(0);
    expect(schema.parse("1e3")).toBe(0);
    expect(schema.parse("Infinity")).toBe(0);
    expect(schema.parse("")).toBe(0);
  });

  it("rejects a fraction unless integer is turned off", () => {
    expect(searchParamNumber({ fallback: 0 }).parse("1.5")).toBe(0);
    expect(searchParamNumber({ integer: false }).parse("1.5")).toBe(1.5);
  });

  it("falls back for an out-of-range value", () => {
    expect(
      searchParamNumber({ fallback: 20, max: 50, min: 1 }).parse("99999999")
    ).toBe(20);
  });

  it("clamps into range when asked to", () => {
    const schema = searchParamNumber({
      clamp: true,
      fallback: 20,
      max: 50,
      min: 1,
    });
    expect(schema.parse("99999999")).toBe(50);
    expect(schema.parse("-5")).toBe(1);
    expect(schema.parse("abc")).toBe(20);
  });
});

describe("searchParamBoolean", () => {
  it("reads the affirmative spellings, including a checkbox's on", () => {
    const schema = searchParamBoolean({ fallback: false });
    expect(schema.parse("1")).toBe(true);
    expect(schema.parse("true")).toBe(true);
    expect(schema.parse("On")).toBe(true);
    expect(schema.parse("yes")).toBe(true);
  });

  it("reads the negative spellings", () => {
    const schema = searchParamBoolean({ fallback: true });
    expect(schema.parse("0")).toBe(false);
    expect(schema.parse("false")).toBe(false);
    expect(schema.parse("off")).toBe(false);
  });

  it("falls back for an unrecognized value, and for an absent key", () => {
    const schema = searchParamBoolean({ fallback: false });
    expect(schema.parse("maybe")).toBe(false);
    expect(z.object({ archived: schema }).parse({})).toEqual({
      archived: false,
    });
  });
});

describe("searchParamDate", () => {
  it("keeps a real calendar day", () => {
    expect(searchParamDate().parse("2024-03-10")).toBe("2024-03-10");
  });

  it("rejects a day the calendar does not have instead of constraining it", () => {
    const schema = searchParamDate({ fallback: "" });
    expect(schema.parse("2024-02-30")).toBe("");
    expect(schema.parse("2023-02-29")).toBe("");
    expect(schema.parse("2024-13-01")).toBe("");
  });

  it("rejects other date-ish shapes", () => {
    const schema = searchParamDate({ fallback: "" });
    expect(schema.parse("2024/03/10")).toBe("");
    expect(schema.parse("2024-3-1")).toBe("");
    expect(schema.parse("2024-03-10T00:00:00Z")).toBe("");
  });
});

describe("composed page filters", () => {
  it("validates a whole searchParams object in one pass", () => {
    const schema = z.object({
      from: searchParamDate({ fallback: "" }),
      limit: searchParamNumber({ clamp: true, fallback: 20, max: 50, min: 1 }),
      q: searchParamString({ fallback: "" }),
      sort: searchParamEnum(["asc", "desc"], { fallback: "desc" as const }),
    });

    expect(
      schema.parse({
        from: "2024-02-30",
        limit: ["999"],
        q: ["  needle  "],
        sort: "nope",
      })
    ).toEqual({ from: "", limit: 50, q: "needle", sort: "desc" });
  });

  it("returns the defaults for a bare URL, where every key is absent", () => {
    const schema = z.object({
      from: searchParamDate({ fallback: "" }),
      limit: searchParamNumber({ clamp: true, fallback: 20, max: 50, min: 1 }),
      q: searchParamString({ fallback: "" }),
      sort: searchParamEnum(["asc", "desc"], { fallback: "desc" as const }),
    });

    expect(schema.parse({})).toEqual({
      from: "",
      limit: 20,
      q: "",
      sort: "desc",
    });
  });
});
