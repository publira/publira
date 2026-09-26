import { describe, expect, it } from "vitest";

import {
  boundedIntFormSchema,
  commaOrNewlineStringListFormSchema,
  intFormSchema,
  optionalTrimmedString,
  requiredTrimmedString,
  revisionFormSchema,
} from "./form-schemas";

describe("requiredTrimmedString", () => {
  const schema = requiredTrimmedString("Name is required.");

  it("trims and accepts a non-empty value", () => {
    expect(schema.parse("  Ito  ")).toBe("Ito");
  });

  it("rejects empty or missing values with the given message", () => {
    expect(schema.safeParse("").error?.issues[0]?.message).toBe(
      "Name is required."
    );
    expect(schema.safeParse(null).error?.issues[0]?.message).toBe(
      "Name is required."
    );
  });
});

describe("optionalTrimmedString", () => {
  it("turns a missing or non-string value into an empty string", () => {
    expect(optionalTrimmedString().parse(null)).toBe("");
    expect(optionalTrimmedString().parse("  note  ")).toBe("note");
  });

  it("uses the given message when the value is too long", () => {
    expect(
      optionalTrimmedString(4, "Use 4 characters or fewer.").safeParse("12345")
        .error?.issues[0]?.message
    ).toBe("Use 4 characters or fewer.");
  });
});

describe("intFormSchema", () => {
  const schema = intFormSchema(
    "Enter the port as an integer between 1 and 65535.",
    {
      fallback: 587,
      max: 65_535,
      min: 1,
    }
  );

  it("uses the fallback for a blank field", () => {
    expect(schema.parse("")).toBe(587);
    expect(schema.parse(null)).toBe(587);
  });

  it("clamps an out-of-range value", () => {
    expect(schema.parse("0")).toBe(1);
    expect(schema.parse("70000")).toBe(65_535);
  });

  it("rejects a non-number", () => {
    expect(schema.safeParse("abc").success).toBe(false);
    expect(schema.safeParse("0x10").success).toBe(false);
  });

  it("rejects a fraction instead of truncating it", () => {
    expect(schema.safeParse("1.5").success).toBe(false);
    expect(schema.safeParse("587.9").success).toBe(false);
  });
});

describe("commaOrNewlineStringListFormSchema", () => {
  it("splits on commas and newlines and drops empty entries", () => {
    expect(
      commaOrNewlineStringListFormSchema.parse(
        " a@example.com, \nb@example.com,\n  "
      )
    ).toEqual(["a@example.com", "b@example.com"]);
  });

  it("turns a missing value into an empty list", () => {
    expect(commaOrNewlineStringListFormSchema.parse(null)).toEqual([]);
  });
});

describe("boundedIntFormSchema", () => {
  const schema = boundedIntFormSchema("Enter a whole number of at least 1.", {
    max: 100,
    maxMessage: "Enter 100 or less.",
    min: 1,
  });

  it("accepts a whole number within the range", () => {
    expect(schema.parse(" 42 ")).toBe(42);
    expect(schema.parse("1")).toBe(1);
    expect(schema.parse("100")).toBe(100);
  });

  it("rejects a blank or missing value instead of defaulting it", () => {
    expect(schema.safeParse("").error?.issues[0]?.message).toBe(
      "Enter a whole number of at least 1."
    );
    expect(schema.safeParse(null).error?.issues[0]?.message).toBe(
      "Enter a whole number of at least 1."
    );
  });

  it("rejects a value below the range instead of clamping it", () => {
    expect(schema.safeParse("0").error?.issues[0]?.message).toBe(
      "Enter a whole number of at least 1."
    );
  });

  it("words a value above the range with the max message", () => {
    expect(schema.safeParse("101").error?.issues[0]?.message).toBe(
      "Enter 100 or less."
    );
  });

  it("rejects fractions and non-decimal notation", () => {
    expect(schema.safeParse("1.5").success).toBe(false);
    expect(schema.safeParse("1e2").success).toBe(false);
    expect(schema.safeParse("0x10").success).toBe(false);
  });
});

describe("revisionFormSchema", () => {
  const schema = revisionFormSchema("Reload the screen.");

  it("reads the revision as a bigint", () => {
    expect(schema.parse(" 42 ")).toBe(42n);
  });

  it.each(["", "-1", "1.5", "12345678901234567890"])("refuses %j", (value) => {
    const result = schema.safeParse(value);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Reload the screen.");
  });
});
