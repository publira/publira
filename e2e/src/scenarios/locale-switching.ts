/**
 * Records created by `db/seeds/scenarios/080_locale_switching.sql`.
 *
 * The development seed tenant stores `en` as its default locale, so a suite
 * that only reads it cannot separate the stored setting from a constant this
 * build falls back to. The first tenant stores `ja`, which is what lets the
 * same assertions run in both directions: its public site serves Japanese
 * without a locale prefix and keeps `/en/...`, and its console login screen —
 * reached without a session, and so without a `publira_locale` cookie — opens
 * in Japanese.
 */

export const LOCALE_SWITCHING_SCENARIO = "080_locale_switching";

/**
 * Tenant whose saved default locale is Japanese. It owns no series and no users.
 *
 * Its site copy is written in Japanese alone, so every other language falls
 * back to it.
 */
export const JAPANESE_DEFAULT_TENANT = {
  domain: "locale.localhost",
  japaneseCopy: {
    copyrightText: "© Locale Tenant (Japanese edition)",
    siteDescription: "The Japanese description of Locale Tenant.",
  },
  name: "Locale Tenant",
  publicId: "LangTNNTAAA1",
} as const;

/**
 * Tenant that offers Japanese and English alone, Japanese being its default.
 * Every other seeded tenant offers all five languages, so this is the one
 * whose switcher, sitemap, and redirects show the set rather than the registry.
 * It owns no users.
 *
 * Its site copy is written in both languages. Its two series are what a title
 * in the reader's language is read off: `translated` and its episode are
 * written in both languages, and `untranslated` in Japanese alone, so its
 * English URL falls back. Its two announcements follow the same pattern.
 */
export const BILINGUAL_TENANT = {
  announcements: {
    translated: {
      englishBody: "The English body of the spring schedule.",
      englishTitle: "Spring schedule",
      id: "018f0f46-0001-7000-8000-000000000001",
      japaneseBody: "The Japanese body of the spring schedule.",
      japaneseTitle: "Spring schedule (Japanese edition)",
    },
    untranslated: {
      id: "018f0f46-0002-7000-8000-000000000002",
      japaneseBody: "The Japanese body of the maintenance window.",
      japaneseTitle: "Maintenance window (Japanese edition)",
    },
  },
  domain: "bilingual.localhost",
  englishCopy: {
    copyrightText: "© Bilingual Tenant",
    siteDescription: "The English description of Bilingual Tenant.",
  },
  japaneseCopy: {
    copyrightText: "© Bilingual Tenant (Japanese edition)",
    siteDescription: "The Japanese description of Bilingual Tenant.",
  },
  name: "Bilingual Tenant",
  publicId: "BlngTNNTAAA1",
  translated: {
    englishSynopsis: "The English synopsis of Night Train.",
    englishTitle: "Night Train",
    episode: {
      englishTitle: "Departure",
      japaneseTitle: "Departure (Japanese edition)",
      publicId: "BlngEPSDAAA1",
    },
    japaneseSynopsis: "The Japanese synopsis of Night Train.",
    japaneseTitle: "Night Train (Japanese edition)",
    publicId: "BlngSERSAAA1",
  },
  untranslated: {
    japaneseTitle: "Harbor Lights (Japanese edition)",
    publicId: "BlngSERSAAA2",
  },
} as const;
