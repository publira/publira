/**
 * Shared zod pieces for web-admin Server Action forms that are not
 * auth-specific. Resource schemas compose these and keep the screen's own
 * messages / limits at the call site.
 */

import { z } from "zod";

import { MAX_CREDIT_SHARE_BPS } from "./credit-share";
import type { CropRect } from "./crop-rect";
import { isCropRectField, parseCropRect } from "./crop-rect";

/**
 * Decimal integers and fractions only. `Number()` alone would also accept
 * `0x10`, `1e3`, and `Infinity`.
 */
const NUMBER_RE = /^[+-]?\d+(?:\.\d+)?$/u;

/**
 * `tooLongMessage` defaults to `message`, which is right wherever the length
 * bound is a backstop the UI already keeps a field inside. Pass it where the
 * bound is small enough for an editor to reach on purpose: "… is required." is
 * not an answer to a name that was typed and is merely too long.
 */
export const requiredTrimmedString = (
  message: string,
  maxLength = 255,
  tooLongMessage = message
): z.ZodType<string, unknown> =>
  z
    .string({ error: message })
    .trim()
    .min(1, message)
    .max(maxLength, tooLongMessage);

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

const PAGE_NUMBER_RE = /^\d+$/u;

/** The largest page an `int32` index can name. */
const MAX_SPREAD_START_PAGE = 2 ** 31;

/**
 * The page spreads start at, posted as the page number an operator counts in
 * and parsed to the zero-based index the API stores. Unlike
 * {@link nonNegativeIntFormSchema} a blank field is an error: a save that read
 * it as a value would move the series' spreads.
 */
export const spreadStartPageFormSchema = (
  message: string
): z.ZodType<number, unknown> =>
  z.preprocess(
    (value) => {
      const raw = typeof value === "string" ? value.trim() : "";
      return PAGE_NUMBER_RE.test(raw) ? Number(raw) : undefined;
    },
    z
      .number({ error: message })
      .int(message)
      .min(1, message)
      .max(MAX_SPREAD_START_PAGE, message)
      .transform((page) => page - 1)
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

/**
 * The rectangle a crop control posts beside its image. An absent or empty
 * field is no rectangle at all, which leaves the cut in the centre of the
 * upload — what every upload did before a console could frame one. Anything
 * else has to be a whole rectangle: a half-written one would cut somewhere the
 * editor never framed, and saying so is more use than silently re-centring.
 */
export const optionalCropRectFormSchema = (
  message: string
): z.ZodType<CropRect | undefined, unknown> =>
  z.preprocess(
    (value) => (typeof value === "string" ? value : ""),
    z.string().refine(isCropRectField, message).transform(parseCropRect)
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

/**
 * A credit's share inside a posted credit list, already in basis points.
 * Required rather than defaulted: the list replaces every credit, and a
 * missing share read as 0 would stop paying the person without anyone
 * choosing to.
 */
export const creditShareBpsSchema = (message: string) =>
  z
    .number({ error: message })
    .int(message)
    .min(0, message)
    .max(MAX_CREDIT_SHARE_BPS, message);
