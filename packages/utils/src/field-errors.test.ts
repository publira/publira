import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  toFieldErrors,
  toFormErrorMessage,
  VALIDATION_ERROR_MESSAGE,
  validationErrorMessage,
} from "./field-errors";

const schema = z.object({
  port: z.number().int().min(1, "1 以上で入力してください。"),
  title: z.string().min(1, "タイトルは必須です。").max(5, "長すぎます。"),
});

const parseFailure = (input: unknown): z.ZodError<z.input<typeof schema>> => {
  const parsed = schema.safeParse(input);
  if (parsed.success) {
    throw new Error("expected the schema to reject this input");
  }

  return parsed.error;
};

describe("toFieldErrors", () => {
  it("maps each field to its first message", () => {
    const errors = toFieldErrors(parseFailure({ port: 0, title: "" }));

    expect(errors).toEqual({
      port: "1 以上で入力してください。",
      title: "タイトルは必須です。",
    });
  });

  it("omits fields that passed", () => {
    expect(toFieldErrors(parseFailure({ port: 587, title: "" }))).toEqual({
      title: "タイトルは必須です。",
    });
  });

  it("keeps only the first message when a field breaks several rules", () => {
    const multiRule = z.object({
      code: z
        .string()
        .startsWith("#", "先頭は # です。")
        .length(7, "7 文字です。"),
    });
    const parsed = multiRule.safeParse({ code: "abc" });
    if (parsed.success) {
      throw new Error("expected the schema to reject this input");
    }

    expect(toFieldErrors(parsed.error)).toEqual({ code: "先頭は # です。" });
  });
});

describe("toFormErrorMessage", () => {
  it("prefers a form-level issue, which no field control would show", () => {
    const rangeSchema = z
      .object({ from: z.string(), to: z.string() })
      .refine((value) => value.from <= value.to, {
        message: "終了日は開始日以降にしてください。",
      });
    const parsed = rangeSchema.safeParse({
      from: "2024-03-10",
      to: "2024-03-01",
    });
    if (parsed.success) {
      throw new Error("expected the schema to reject this input");
    }

    expect(toFormErrorMessage(parsed.error)).toBe(
      "終了日は開始日以降にしてください。"
    );
  });

  it("falls back to the first field message", () => {
    expect(toFormErrorMessage(parseFailure({ port: 587, title: "" }))).toBe(
      "タイトルは必須です。"
    );
  });

  it("uses the shared wording when nothing else is available", () => {
    const error = new z.ZodError([]);

    expect(toFormErrorMessage(error)).toBe(VALIDATION_ERROR_MESSAGE);
    expect(toFormErrorMessage(error, { fallback: "保存できません。" })).toBe(
      "保存できません。"
    );
  });

  it("uses the locale-specific shared wording when asked", () => {
    const error = new z.ZodError([]);

    expect(toFormErrorMessage(error, { locale: "en" })).toBe(
      validationErrorMessage("en")
    );
  });
});

describe("validationErrorMessage", () => {
  it("keeps the Japanese default when locale is omitted", () => {
    expect(validationErrorMessage()).toBe("入力内容を確認してください。");
    expect(VALIDATION_ERROR_MESSAGE).toBe(validationErrorMessage());
  });

  it("returns English when locale is en", () => {
    expect(validationErrorMessage("en")).toBe(
      "Please check the information you entered."
    );
  });
});
