/**
 * Records created by `db/seeds/scenarios/080_locale_switching.sql`.
 *
 * The development seed tenant stores `ja` as its default locale, so a suite
 * that only reads it cannot separate the stored setting from a constant this
 * build falls back to. This tenant stores `en`, which is what lets the same
 * assertions run in both directions: its public site serves English without a
 * locale prefix and keeps `/ja/...`, and its console login screen — reached
 * without a session, and so without a `publira_locale` cookie — opens in
 * English.
 */

export const LOCALE_SWITCHING_SCENARIO = "080_locale_switching";

/** Tenant whose saved default locale is English. It owns no series and no users. */
export const ENGLISH_DEFAULT_TENANT = {
  domain: "locale.localhost",
  name: "Locale Tenant",
  publicId: "LangTNNTAAA1",
} as const;
