/**
 * Locale constants both sides of the switcher need.
 *
 * `lib/locale.ts` imports `next/headers`, so the Client Component that renders
 * the switcher cannot import from it.
 */

/** Name the switcher's submit buttons carry the chosen locale under. */
export const LOCALE_FIELD_NAME = "locale";
