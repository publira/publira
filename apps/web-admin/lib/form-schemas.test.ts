import { describe, expect, it } from "vitest";

import {
  checkboxOnFormSchema,
  flagOneFormSchema,
  jsonStringArrayFormSchema,
  nonNegativeIntFormSchema,
  optionalTrimmedString,
  requiredTrimmedString,
  trimmedStringListFormSchema,
} from "./form-schemas";

describe("requiredTrimmedString", () => {
  const schema = requiredTrimmedString("名前は必須です。");

  it("trims and accepts a non-empty value", () => {
    expect(schema.parse("  山田  ")).toBe("山田");
  });

  it("rejects empty or missing values with the given message", () => {
    expect(schema.safeParse("").error?.issues[0]?.message).toBe(
      "名前は必須です。"
    );
    expect(schema.safeParse(null).error?.issues[0]?.message).toBe(
      "名前は必須です。"
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
      optionalTrimmedString(4, "4文字以内で入力してください。").safeParse(
        "12345"
      ).error?.issues[0]?.message
    ).toBe("4文字以内で入力してください。");
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
    "閲覧可能期間は 0 以上の整数で入力してください。"
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
