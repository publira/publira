/**
 * Shared zod pieces for web-admin Server Action forms that are not
 * auth-specific. Resource schemas compose these and keep the screen's own
 * messages / limits at the call site.
 */

import { z } from "zod";

/**
 * Decimal integers and fractions only. `Number()` alone would also accept
 * `0x10`, `1e3`, and `Infinity`.
 */
const NUMBER_RE = /^[+-]?\d+(?:\.\d+)?$/u;

export const requiredTrimmedString = (
  message: string,
  maxLength = 255
): z.ZodType<string, unknown> =>
  z.string({ error: message }).trim().min(1, message).max(maxLength, message);

export const optionalTrimmedString = (
  maxLength = 255,
  message?: string
): z.ZodType<string, unknown> =>
  z.preprocess(
    (value) => {
      if (typeof value !== "string") {
        return "";
      }

      return value.trim();
    },
    z.string().max(maxLength, message)
  );

/**
 * Empty / missing becomes `0`. Existing number inputs treat a blank field
 * as zero rather than as an error.
 */
export const nonNegativeIntFormSchema = (
  message: string
): z.ZodType<number, unknown> =>
  z.preprocess(
    (value) => {
      const raw = typeof value === "string" ? value.trim() : "";
      if (raw === "") {
        return 0;
      }
      if (!NUMBER_RE.test(raw)) {
        return;
      }

      const parsed = Math.trunc(Number(raw));
      return Number.isFinite(parsed) ? parsed : undefined;
    },
    z.number({ error: message }).int(message).min(0, message)
  );

/** Checkbox that posts `"on"` when checked and is absent otherwise. */
export const checkboxOnFormSchema = z.preprocess(
  (value) => value === "on",
  z.boolean()
);

/** Hidden / flag field that posts `"1"` when set. */
export const flagOneFormSchema = z.preprocess(
  (value) => value === "1",
  z.boolean()
);

export const optionalFileFormSchema = z.custom<File | undefined>(
  (value) => value === undefined || value instanceof File
);

export const fileListFormSchema = z.array(z.instanceof(File));

export const trimmedStringListFormSchema = z
  .array(z.string())
  .transform((values) =>
    values.flatMap((value) => {
      const trimmed = value.trim();
      return trimmed.length > 0 ? [trimmed] : [];
    })
  );

/** Hidden JSON array of strings (reorder payloads). Invalid JSON becomes []. */
export const jsonStringArrayFormSchema = z.preprocess((value): string[] => {
  if (typeof value !== "string" || value.trim() === "") {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}, z.array(z.string()));
