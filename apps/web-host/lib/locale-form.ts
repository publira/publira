/**
 * How a Server Action learns which locale the reader is on.
 *
 * `next/root-params` is unavailable in Server Actions, so a form that redirects
 * to another page carries the locale the way it already carries the tenant id:
 * a hidden field filled in from `useLocale()`. Actions bound by a Server
 * Component take it as an argument instead.
 *
 * Kept free of `next/headers` so the Client Components that render the field
 * can import the name from the same place the action parses it.
 */

import { parseLocale } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { z } from "zod";

import { FALLBACK_LOCALE } from "./fallback-locale";

/** Name of the hidden field the locale travels in. */
export const LOCALE_FIELD_NAME = "locale";

/**
 * Accepts anything and resolves to a supported locale.
 *
 * A missing or forged field falls back to `ja` rather than failing the
 * submission: the locale only decides where the redirect lands, and rejecting
 * the whole form over it would lose the reader's input.
 */
export const localeFormSchema = z
  .unknown()
  .transform((value): Locale => parseLocale(value) ?? FALLBACK_LOCALE);
