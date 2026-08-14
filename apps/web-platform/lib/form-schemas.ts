/**
 * Shared zod pieces for web-platform Server Action forms that are not
 * auth-specific. Resource schemas compose these and keep the screen's own
 * messages / limits at the call site.
 */

import { z } from "zod";

/**
 * Signed decimal integers only. `Number()` alone would also accept `0x10`,
 * `1e3`, fractions, and `Infinity`.
 */
const INTEGER_RE = /^[+-]?\d+$/u;

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
 * Empty / missing becomes `fallback` (default 0). Existing number inputs
 * treat a blank field as that default rather than as an error.
 */
export const intFormSchema = (
  message: string,
  options?: { fallback?: number; max?: number; min?: number }
): z.ZodType<number, unknown> => {
  const fallback = options?.fallback ?? 0;
  const { max, min } = options ?? {};

  let checked = z.number({ error: message }).int(message);
  if (min !== undefined) {
    checked = checked.min(min, message);
  }
  if (max !== undefined) {
    checked = checked.max(max, message);
  }

  return z.preprocess((value) => {
    const raw = typeof value === "string" ? value.trim() : "";
    if (raw === "") {
      return fallback;
    }
    if (!INTEGER_RE.test(raw)) {
      return;
    }

    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      return;
    }

    const lowerBounded = min === undefined ? parsed : Math.max(min, parsed);
    return max === undefined ? lowerBounded : Math.min(max, lowerBounded);
  }, checked);
};

/**
 * One text field that accepts a comma- or newline-separated list. Empty
 * entries are dropped; format checks stay on the consumer.
 */
export const commaOrNewlineStringListFormSchema = z.preprocess((value) => {
  const raw = typeof value === "string" ? value : "";
  return raw
    .split(/[\n,]/u)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}, z.array(z.string()));
