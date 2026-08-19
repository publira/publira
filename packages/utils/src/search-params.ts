/**
 * Shared zod schemas for `searchParams`.
 *
 * Next.js hands a query value over as `string | string[] | undefined`, so a
 * bare `z.string()` never fits it and every screen ends up writing its own
 * `z.preprocess`. These factories do that normalization once: unwrap the query
 * value, trim it, bound its length, and only then apply the type-specific
 * check.
 *
 * Failure handling follows one rule, per AGENTS.md "Untrusted input":
 *
 * - `fallback` given → the schema never fails. An absent, empty, or invalid
 *   value becomes that explicit safe default (a filter screen still renders).
 * - `fallback` omitted → the same input produces a zod issue, so the page can
 *   decide to `notFound()` instead of quietly showing different content.
 *
 * `searchParamDate` needs `Temporal` at runtime, like the rest of this package
 * (see https://github.com/publira/publira/issues/573).
 */

import { z } from "zod";

import { sharedMessage } from "./catalog";
import type { Locale } from "./i18n";

/** A single entry of Next.js' resolved `searchParams` object. */
export type SearchParamValue = string | string[] | undefined;

/** Length bound applied to every string-ish query value unless overridden. */
const DEFAULT_MAX_LENGTH = 255;

/** Repeated query keys are filter lists, not bulk input. */
const DEFAULT_MAX_ITEMS = 50;

/**
 * Decimal integers and fractions only. `Number()` alone would also accept
 * `0x10`, `1e3`, `Infinity`, and whitespace, none of which a link in this app
 * ever produces.
 */
const NUMBER_RE = /^[+-]?\d+(?:\.\d+)?$/u;

/** Calendar day as emitted by `<input type="date">`. */
const PLAIN_DATE_RE = /^\d{4}-\d{2}-\d{2}$/u;

const TRUE_VALUES: ReadonlySet<string> = new Set(["1", "on", "true", "yes"]);
const FALSE_VALUES: ReadonlySet<string> = new Set(["0", "false", "no", "off"]);

const HIGH_SURROGATE_FIRST = 0xd8_00;
const HIGH_SURROGATE_LAST = 0xdb_ff;

export interface SearchParamStringOptions {
  /**
   * Returned when the value is absent, empty after trimming, or invalid.
   * Omit it to make those cases a zod issue instead.
   */
  fallback?: string;
  /** Maximum length in UTF-16 code units. Default: {@link DEFAULT_MAX_LENGTH}. */
  maxLength?: number;
  /**
   * Cut an over-long value down to `maxLength` instead of treating it as
   * invalid. Default `false`: a truncated filter silently searches for
   * something the visitor never typed, and a truncated pagination token is
   * simply corrupt, so opt in only where cutting is the intended behavior.
   */
  truncate?: boolean;
}

export interface SearchParamStringArrayOptions {
  /** Returned when the value is absent or invalid. Omit to fail instead. */
  fallback?: string[];
  /** Maximum number of entries. Default: {@link DEFAULT_MAX_ITEMS}. */
  maxItems?: number;
  /** Maximum length of each entry, in UTF-16 code units. Default: {@link DEFAULT_MAX_LENGTH}. */
  maxLength?: number;
  /** Cut over-long entries and extra entries instead of rejecting them. Default `false`. */
  truncate?: boolean;
}

export interface SearchParamEnumOptions<F extends string> {
  /** Returned when the value is absent or outside `values`. Omit to fail instead. */
  fallback?: F;
  /**
   * UI locale for the rejection message when `fallback` is omitted.
   * Unknown values fall back to `ja`.
   */
  locale?: Locale | string;
  /** Maximum length in UTF-16 code units. Default: {@link DEFAULT_MAX_LENGTH}. */
  maxLength?: number;
}

export interface SearchParamNumberOptions {
  /**
   * Pull an out-of-range value back to `min` / `max` instead of treating it as
   * invalid. Default `false`.
   */
  clamp?: boolean;
  /** Returned when the value is absent or invalid. Omit to fail instead. */
  fallback?: number;
  /** Reject fractions. Default `true` — offsets, limits, and page sizes are integers. */
  integer?: boolean;
  max?: number;
  min?: number;
}

export interface SearchParamBooleanOptions {
  /** Returned when the value is absent or unrecognized. Omit to fail instead. */
  fallback?: boolean;
}

export interface SearchParamDateOptions {
  /** Returned when the value is absent or not a real calendar day. Omit to fail instead. */
  fallback?: string;
}

/**
 * Unwrap the single value of a query key. A key repeated with *conflicting*
 * values is not something a link in this app produces, so rather than guessing
 * which one the visitor meant (`URLSearchParams.get` would silently take the
 * first), it is treated as invalid and resolves to the fallback. Repeating the
 * same value is unambiguous and passes through.
 */
const singleValue = (value: unknown): string | undefined => {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value) && value.length > 0) {
    const [first, ...rest] = value as unknown[];
    if (typeof first !== "string") {
      return undefined;
    }

    // Repeating a key with one and the same value asks nothing ambiguous.
    return rest.every((entry) => entry === first) ? first : undefined;
  }

  return undefined;
};

/**
 * Cut to `maxLength` code units without leaving a lone high surrogate behind —
 * that is not valid UTF-8 and would break at the RPC boundary.
 */
const truncateToLength = (value: string, maxLength: number): string => {
  const sliced = value.slice(0, maxLength);
  // At the last position a high surrogate has no pair to complete, so
  // `codePointAt` reports the surrogate itself.
  const lastCode = sliced.codePointAt(sliced.length - 1) ?? 0;
  if (lastCode >= HIGH_SURROGATE_FIRST && lastCode <= HIGH_SURROGATE_LAST) {
    return sliced.slice(0, -1);
  }

  return sliced;
};

/** Trim, drop empties, and optionally truncate. `undefined` means "not supplied". */
const normalizeString = (
  value: string,
  maxLength: number,
  truncate: boolean
): string | undefined => {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  return truncate ? truncateToLength(trimmed, maxLength) : trimmed;
};

const normalizeSingle = (
  value: unknown,
  maxLength: number,
  truncate: boolean
): string | undefined => {
  const single = singleValue(value);
  if (single === undefined) {
    return undefined;
  }

  return normalizeString(single, maxLength, truncate);
};

/**
 * Turn a schema into one that resolves to `fallback` for every input it would
 * otherwise reject, including a missing value. Without a fallback the schema is
 * returned untouched so the caller sees the issue.
 *
 * The `.optional()` is what lets a key that is simply absent from the
 * `searchParams` object reach the transform: inside `z.object`, a schema whose
 * input is required reports the missing key before any fallback could apply.
 */
const withFallback = <Out, F>(
  schema: z.ZodType<Out, unknown>,
  fallback: F | undefined
): z.ZodType<F | Out, unknown> => {
  if (fallback === undefined) {
    return schema;
  }

  return z
    .unknown()
    .optional()
    .transform((value) => {
      const parsed = schema.safeParse(value);
      return parsed.success ? parsed.data : fallback;
    });
};

/** Trimmed, length-bounded single query value. */
export const searchParamString = (
  options?: SearchParamStringOptions
): z.ZodType<string, unknown> => {
  const maxLength = options?.maxLength ?? DEFAULT_MAX_LENGTH;
  const schema = z.preprocess(
    (value) => normalizeSingle(value, maxLength, options?.truncate ?? false),
    z.string().max(maxLength)
  );

  return withFallback(schema, options?.fallback);
};

/**
 * Repeated query key → trimmed, non-empty entries. A single `?tag=a` is read as
 * a one-entry list, so a caller never has to branch on the array shape.
 * Duplicates are preserved: de-duplicating is the consumer's decision.
 */
export const searchParamStringArray = (
  options?: SearchParamStringArrayOptions
): z.ZodType<string[], unknown> => {
  const maxLength = options?.maxLength ?? DEFAULT_MAX_LENGTH;
  const maxItems = options?.maxItems ?? DEFAULT_MAX_ITEMS;
  const truncate = options?.truncate ?? false;

  const schema = z.preprocess(
    (value): string[] | undefined => {
      const entries = typeof value === "string" ? [value] : value;
      if (!Array.isArray(entries)) {
        return undefined;
      }

      const normalized = (entries as unknown[]).flatMap((entry) => {
        if (typeof entry !== "string") {
          return [];
        }

        const single = normalizeString(entry, maxLength, truncate);
        return single === undefined ? [] : [single];
      });

      return truncate ? normalized.slice(0, maxItems) : normalized;
    },
    z.array(z.string().max(maxLength)).max(maxItems)
  );

  return withFallback(schema, options?.fallback);
};

/**
 * Query value restricted to a known set. `values` may be a set of options built
 * at runtime (the filter dropdown's own values), not just a literal tuple.
 */
export const searchParamEnum = <T extends string, F extends string = never>(
  values: Iterable<T>,
  options?: SearchParamEnumOptions<F>
): z.ZodType<F | T, unknown> => {
  const allowed: ReadonlySet<string> = new Set<string>(values);
  const maxLength = options?.maxLength ?? DEFAULT_MAX_LENGTH;
  const schema = z.preprocess(
    (value) => normalizeSingle(value, maxLength, false),
    z.string().refine((value): value is T => allowed.has(value), {
      message: sharedMessage("errors.disallowed_value", options?.locale),
    })
  );

  return withFallback<T, F>(schema, options?.fallback);
};

/** Numeric query value (offset, limit, page size). */
export const searchParamNumber = (
  options?: SearchParamNumberOptions
): z.ZodType<number, unknown> => {
  const { clamp = false, max, min } = options ?? {};
  const integer = options?.integer ?? true;

  let checked = integer ? z.number().int() : z.number();
  if (min !== undefined) {
    checked = checked.min(min);
  }
  if (max !== undefined) {
    checked = checked.max(max);
  }

  const schema = z.preprocess((value): number | undefined => {
    const single = normalizeSingle(value, DEFAULT_MAX_LENGTH, false);
    if (single === undefined || !NUMBER_RE.test(single)) {
      return undefined;
    }

    const parsed = Number(single);
    if (!clamp) {
      return parsed;
    }

    const lowerBounded = min === undefined ? parsed : Math.max(min, parsed);
    return max === undefined ? lowerBounded : Math.min(max, lowerBounded);
  }, checked);

  return withFallback(schema, options?.fallback);
};

/**
 * Boolean query value. Accepts `1` / `true` / `on` / `yes` and their negatives,
 * case-insensitively — `on` is what a checkbox inside a GET form submits.
 */
export const searchParamBoolean = (
  options?: SearchParamBooleanOptions
): z.ZodType<boolean, unknown> => {
  const schema = z.preprocess((value): boolean | undefined => {
    const single = normalizeSingle(value, DEFAULT_MAX_LENGTH, false);
    if (single === undefined) {
      return undefined;
    }

    const normalized = single.toLowerCase();
    if (TRUE_VALUES.has(normalized)) {
      return true;
    }
    if (FALSE_VALUES.has(normalized)) {
      return false;
    }

    return undefined;
  }, z.boolean());

  return withFallback(schema, options?.fallback);
};

/**
 * Date-only filter boundary (`YYYY-MM-DD`), kept as a string for
 * `startOfDayIsoString` / `endOfDayIsoString`.
 *
 * The shape is checked against the calendar, not just the pattern: Temporal
 * parses with `overflow: "reject"`, so `2024-02-30` is invalid instead of being
 * quietly constrained to the 29th.
 */
export const searchParamDate = (
  options?: SearchParamDateOptions
): z.ZodType<string, unknown> => {
  const schema = z.preprocess((value): string | undefined => {
    const single = normalizeSingle(value, DEFAULT_MAX_LENGTH, false);
    if (single === undefined || !PLAIN_DATE_RE.test(single)) {
      return undefined;
    }

    try {
      Temporal.PlainDate.from(single, { overflow: "reject" });
    } catch {
      return undefined;
    }

    return single;
  }, z.string());

  return withFallback(schema, options?.fallback);
};
