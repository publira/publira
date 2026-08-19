/**
 * Shared zod schemas for App Router dynamic `params`.
 *
 * Next.js types a segment as `string` (or `string[]` for a catch-all), but an
 * external caller can put anything in the URL. These factories trim, bound
 * length, and reject the `generateStaticParams` placeholder so a page can
 * `safeParse` the whole `params` object and pass only `z.output` downstream.
 *
 * There is no fallback: an identifier that is not a resource is not a default
 * view. The page calls `notFound()` on a failed parse — same outcome as a
 * missing record, so the response does not disclose whether the id was
 * malformed or the record is gone (apps/AGENTS.md "Untrusted input").
 *
 * Kept free of `next/navigation` so the factories can be tested and composed
 * without the app-router context. `parseRouteParams` returns `null` on
 * failure; the page (which already has that context) raises `notFound()`.
 */

import { z } from "zod";

import { isPlaceholderStaticParam } from "./static-param-placeholder";

/** Length bound applied to every segment unless overridden. */
const DEFAULT_MAX_LENGTH = 255;

/** Catch-all segments are paths, not bulk input. */
const DEFAULT_MAX_ITEMS = 50;

export interface RouteParamStringOptions {
  /** Maximum length in UTF-16 code units. Default: {@link DEFAULT_MAX_LENGTH}. */
  maxLength?: number;
}

export interface RouteParamStringArrayOptions {
  /** Maximum number of segments. Default: {@link DEFAULT_MAX_ITEMS}. */
  maxItems?: number;
  /** Maximum length of each segment, in UTF-16 code units. Default: {@link DEFAULT_MAX_LENGTH}. */
  maxLength?: number;
}

/**
 * One dynamic segment: trimmed, non-empty, length-bounded, and not the
 * static-params placeholder. Arrays and non-strings fail — a single-segment
 * route never receives those from a well-formed link.
 */
export const routeParamString = (
  options?: RouteParamStringOptions
): z.ZodType<string, unknown> => {
  const maxLength = options?.maxLength ?? DEFAULT_MAX_LENGTH;

  return z
    .string()
    .trim()
    .min(1)
    .max(maxLength)
    .refine((value) => !isPlaceholderStaticParam(value));
};

/**
 * Catch-all (`[...slug]`) segment: a non-empty array of {@link routeParamString}
 * entries. A missing, empty, or non-array value fails.
 */
export const routeParamStringArray = (
  options?: RouteParamStringArrayOptions
): z.ZodType<string[], unknown> => {
  const maxItems = options?.maxItems ?? DEFAULT_MAX_ITEMS;

  return z
    .array(routeParamString({ maxLength: options?.maxLength }))
    .min(1)
    .max(maxItems);
};

/**
 * Parse the whole `params` object with a page-owned schema. `null` means the
 * identifier is not a resource — the caller turns that into `notFound()`.
 */
export const parseRouteParams = <S extends z.ZodType>(
  schema: S,
  input: unknown
): z.output<S> | null => {
  const parsed = schema.safeParse(input);
  return parsed.success ? parsed.data : null;
};
