import type { Locale } from "@publira/i18n";

/**
 * The locale this console still renders in where it cannot name the operator's.
 *
 * `@publira/i18n` no longer turns a missing or unknown value into a locale, so
 * every remaining implicit fallback in `web-platform` goes through this one
 * constant instead of being spelled `"ja"` at each site. It is a stand-in, not
 * a decision: the paths that reach it have either the `publira_locale` cookie
 * or the stored platform default to resolve instead, and a read that fails is
 * an outage to report rather than a language to choose.
 *
 * Resolving the locale on each of these paths, and deleting this, is #1249.
 */
export const FALLBACK_LOCALE: Locale = "ja";
