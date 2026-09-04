import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  toFieldErrors,
  toFormErrorMessage,
  validationErrorMessage,
} from "./field-errors";

const schema = z.object({
  port: z.number().int().min(1, "Enter 1 or more."),
  title: z.string().min(1, "Title is required.").max(5, "Too long."),
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
      port: "Enter 1 or more.",
      title: "Title is required.",
    });
  });

  it("omits fields that passed", () => {
    expect(toFieldErrors(parseFailure({ port: 587, title: "" }))).toEqual({
      title: "Title is required.",
    });
  });

  it("keeps only the first message when a field breaks several rules", () => {
    const multiRule = z.object({
      code: z
        .string()
        .startsWith("#", "Must start with #.")
        .length(7, "Must be 7 characters."),
    });
    const parsed = multiRule.safeParse({ code: "abc" });
    if (parsed.success) {
      throw new Error("expected the schema to reject this input");
    }

    expect(toFieldErrors(parsed.error)).toEqual({ code: "Must start with #." });
  });
});

describe("toFormErrorMessage", () => {
  it("prefers a form-level issue, which no field control would show", () => {
    const rangeSchema = z
      .object({ from: z.string(), to: z.string() })
      .refine((value) => value.from <= value.to, {
        message: "The end date must not precede the start date.",
      });
    const parsed = rangeSchema.safeParse({
      from: "2024-03-10",
      to: "2024-03-01",
    });
    if (parsed.success) {
      throw new Error("expected the schema to reject this input");
    }

    expect(toFormErrorMessage(parsed.error, { locale: "en" })).toBe(
      "The end date must not precede the start date."
    );
  });

  it("falls back to the first field message", () => {
    expect(
      toFormErrorMessage(parseFailure({ port: 587, title: "" }), {
        locale: "en",
      })
    ).toBe("Title is required.");
  });

  it("uses the shared wording when nothing else is available", () => {
    const error = new z.ZodError([]);

    expect(toFormErrorMessage(error, { locale: "ja" })).toBe(
      validationErrorMessage("ja")
    );
    expect(
      toFormErrorMessage(error, {
        fallback: "Cannot save.",
        locale: "ja",
      })
    ).toBe("Cannot save.");
  });

  it("uses the locale-specific shared wording when asked", () => {
    const error = new z.ZodError([]);

    expect(toFormErrorMessage(error, { locale: "en" })).toBe(
      validationErrorMessage("en")
    );
  });
});

describe("validationErrorMessage", () => {
  it("returns Japanese when locale is ja", () => {
    expect(validationErrorMessage("ja")).toBe("入力内容を確認してください。");
  });

  it("returns English when locale is en", () => {
    expect(validationErrorMessage("en")).toBe(
      "Please check the information you entered."
    );
  });
});
