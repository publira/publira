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

import { isLocale } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { z } from "zod";

/** Name of the hidden field the locale travels in. */
export const LOCALE_FIELD_NAME = "locale";

/**
 * The submitted locale, rejected when it names none this site serves.
 *
 * `<LocaleField />` fills the field in from the `[locale]` segment the reader
 * is already on, so a value outside {@link isLocale} did not come from the
 * form. Answering it anyway is worse than refusing it: the redirect would land
 * under a prefix the site does not serve.
 */
export const localeFormSchema = z
  .unknown()
  .refine((value): value is Locale => isLocale(value));

/**
 * The locale a Server Action words its own response in, read from its form.
 *
 * Throws rather than standing in: an Action that cannot name the reader's
 * language cannot word the rejection it was about to return either, so there
 * is nothing for it to answer with.
 */
export const requireFormLocale = (value: unknown): Locale => {
  if (!isLocale(value)) {
    throw new Error(
      `${LOCALE_FIELD_NAME} names no supported locale: ${String(value)}`
    );
  }

  return value;
};
