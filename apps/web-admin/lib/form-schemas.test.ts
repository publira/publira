import { describe, expect, it } from "vitest";

import {
  boundedIntFormSchema,
  checkboxOnFormSchema,
  flagOneFormSchema,
  jsonStringArrayFormSchema,
  nonNegativeIntFormSchema,
  optionalBoundedIntFormSchema,
  optionalCropRectFormSchema,
  optionalHttpsUrlFormSchema,
  optionalTrimmedString,
  requiredTrimmedString,
  trimmedStringListFormSchema,
} from "./form-schemas";

describe("requiredTrimmedString", () => {
  const schema = requiredTrimmedString("Name is required.");

  it("trims and accepts a non-empty value", () => {
    expect(schema.parse("  Jane Doe  ")).toBe("Jane Doe");
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
      optionalTrimmedString(4, "Enter at most 4 characters.").safeParse("12345")
        .error?.issues[0]?.message
    ).toBe("Enter at most 4 characters.");
  });
});

describe("optionalHttpsUrlFormSchema", () => {
  // Assembled rather than written out, because lint refuses these literals
  // even in the test that proves they are refused here too.
  const insecureUrl = `${"http"}://apps.apple.com/app/id1`;
  const scriptUrl = `java${"script"}:alert(1)`;
  const schema = optionalHttpsUrlFormSchema("Enter an https:// address.");

  it("accepts an empty value and trims a filled one", () => {
    expect(schema.parse(null)).toBe("");
    expect(schema.parse("   ")).toBe("");
    expect(
      schema.parse(" https://play.google.com/store/apps/details?id=a.b ")
    ).toBe("https://play.google.com/store/apps/details?id=a.b");
  });

  it.each([
    insecureUrl,
    "apps.apple.com/app/id1",
    "https:/apps.apple.com",
    "https://",
    "https://apps.apple.com/app/my app",
    scriptUrl,
  ])("rejects %s with the given message", (value) => {
    expect(schema.safeParse(value).error?.issues[0]?.message).toBe(
      "Enter an https:// address."
    );
  });
});

describe("jsonStringArrayFormSchema", () => {
  it("parses a JSON string array and drops invalid payloads", () => {
    expect(jsonStringArrayFormSchema.parse(JSON.stringify(["a", "b"]))).toEqual(
      ["a", "b"]
    );
    expect(jsonStringArrayFormSchema.parse("not-json")).toEqual([]);
    expect(jsonStringArrayFormSchema.parse(null)).toEqual([]);
  });
});

describe("nonNegativeIntFormSchema", () => {
  const schema = nonNegativeIntFormSchema(
    "Reading period must be a non-negative integer."
  );

  it("treats a blank field as zero", () => {
    expect(schema.parse("")).toBe(0);
    expect(schema.parse(null)).toBe(0);
  });

  it("truncates a decimal toward zero", () => {
    expect(schema.parse("24.9")).toBe(24);
  });

  it("rejects a non-number or a negative value", () => {
    expect(schema.safeParse("abc").success).toBe(false);
    expect(schema.safeParse("-1").success).toBe(false);
    expect(schema.safeParse("0x10").success).toBe(false);
  });
});

describe("checkbox and flag schemas", () => {
  it("reads the posted checkbox / flag tokens", () => {
    expect(checkboxOnFormSchema.parse("on")).toBe(true);
    expect(checkboxOnFormSchema.parse(null)).toBe(false);
    expect(flagOneFormSchema.parse("1")).toBe(true);
    expect(flagOneFormSchema.parse("0")).toBe(false);
  });
});

describe("trimmedStringListFormSchema", () => {
  it("drops empty entries after trim", () => {
    expect(trimmedStringListFormSchema.parse([" a ", "", "b"])).toEqual([
      "a",
      "b",
    ]);
  });
});

describe("optionalCropRectFormSchema", () => {
  const schema = optionalCropRectFormSchema("Check the framed area.");

  it("reads the rectangle a crop control posted", () => {
    expect(schema.parse("0,925,2400,1350")).toEqual({
      height: 1350,
      width: 2400,
      x: 0,
      y: 925,
    });
  });

  it("reads no rectangle from a form that framed nothing", () => {
    expect(schema.parse("")).toBeUndefined();
    expect(schema.parse(null)).toBeUndefined();
  });

  it("rejects a rectangle that lost a side rather than re-centring the cut", () => {
    expect(schema.safeParse("0,925,2400").success).toBe(false);
    expect(schema.safeParse("0,925,2400,0").success).toBe(false);
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

  it("rejects a blank value instead of defaulting it", () => {
    expect(schema.safeParse("").error?.issues[0]?.message).toBe(
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

describe("optionalBoundedIntFormSchema", () => {
  const schema = optionalBoundedIntFormSchema(
    "Enter a whole number of at least 1.",
    { max: 100, min: 1 }
  );

  it("reads a control the form did not submit as no value at all", () => {
    const notSubmitted: unknown = undefined;

    expect(schema.parse(notSubmitted)).toBeUndefined();
    expect(schema.parse("")).toBeUndefined();
    expect(schema.parse("  ")).toBeUndefined();
  });

  it("still checks a value that was submitted", () => {
    expect(schema.parse("42")).toBe(42);
    expect(schema.safeParse("0").success).toBe(false);
    expect(schema.safeParse("101").success).toBe(false);
    expect(schema.safeParse("abc").success).toBe(false);
  });
});
