import type { Locale } from "@publira/i18n";

/**
 * The locale this app still renders in where it cannot name the reader's.
 *
 * `@publira/i18n` no longer turns a missing or unknown value into a locale, so
 * every remaining implicit fallback in `web-host` goes through this one
 * constant instead of being spelled `"ja"` at each site. It is a stand-in, not
 * a decision: the public site keeps the locale in the URL, and each path that
 * reaches here has either a `[locale]` segment or the tenant's stored default
 * to resolve instead.
 *
 * Resolving the locale on each of these paths, and deleting this, is #1250.
 */
export const FALLBACK_LOCALE: Locale = "ja";
