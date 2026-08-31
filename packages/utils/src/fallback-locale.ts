import type { Locale } from "@publira/i18n";

/**
 * The locale the helpers in this package still word themselves in when the
 * caller does not name one.
 *
 * `@publira/i18n` no longer turns a missing or unknown value into a locale, so
 * this is the last place the previous behaviour of these options lives. It is
 * not a default anyone should read as a decision: a caller that reaches it has
 * a locale to resolve, and the shared helpers only keep working today because
 * their `locale` option is still optional.
 *
 * Making `locale` required on the helpers that take it, and deleting this
 * module, is #1340.
 */
export const FALLBACK_LOCALE: Locale = "ja";
