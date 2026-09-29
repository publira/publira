/**
 * Records created by `db/seeds/scenarios/080_locale_switching.sql`.
 *
 * The development seed tenant stores `en` as its default locale, so a suite
 * that only reads it cannot separate the stored setting from a constant this
 * build falls back to. This tenant stores `ja`, which is what lets the same
 * assertions run in both directions: its public site serves Japanese without a
 * locale prefix and keeps `/en/...`, and its console login screen — reached
 * without a session, and so without a `publira_locale` cookie — opens in
 * Japanese.
 */

export const LOCALE_SWITCHING_SCENARIO = "080_locale_switching";

/** Tenant whose saved default locale is Japanese. It owns no series and no users. */
export const JAPANESE_DEFAULT_TENANT = {
  domain: "locale.localhost",
  name: "Locale Tenant",
  publicId: "LangTNNTAAA1",
} as const;
