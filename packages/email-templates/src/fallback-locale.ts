import type { Locale } from "@publira/i18n";

/**
 * The locale an email is worded in when the render request names none this
 * build serves.
 *
 * `@publira/i18n` no longer turns a missing or unknown value into a locale, so
 * this is the last place the previous behaviour of the `locale` fields lives.
 * A message queued with no locale is a message whose recipient's language was
 * never recorded, which the sender has to answer rather than this package.
 *
 * Requiring a resolved locale on the render request, and deleting this, is
 * #1251.
 */
export const FALLBACK_LOCALE: Locale = "ja";
