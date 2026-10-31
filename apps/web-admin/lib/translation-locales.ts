import { getLocales } from "@publira/i18n";
import type { Locale } from "@publira/i18n";

import type { TenantLocales } from "./tenant-locales";

/** What a screen editing a record written once per language shows of it. */
export interface TranslationLocales {
  /**
   * The languages that have a tab: the ones the site offers, or every one this
   * build serves when they cannot be read, since a tab too many is a smaller
   * fault than a translation nobody can reach.
   */
  locales: readonly Locale[];
  /** The record's translations that have a tab, oldest first. */
  visibleLocales: readonly Locale[];
  /**
   * The translation the screen opens on. Undefined only when the tenant's
   * languages cannot be read and the URL names none: the API's own choice
   * falls back to any translation, a hidden one included, so it is left to make
   * only then.
   */
  shownLocale: Locale | undefined;
}

/**
 * The tabs of a record and the one the screen opens on: the language the URL
 * names when the site offers it, else the default language's translation,
 * else the first offered language the record has one in, else the default
 * language, where the screen offers to add one.
 */
export const resolveTranslationLocales = ({
  requestedLocale,
  tenantLocales,
  translatedLocales,
}: {
  requestedLocale: Locale | undefined;
  tenantLocales: TenantLocales | null;
  /** Every language the record has a translation in, oldest first. */
  translatedLocales: readonly Locale[];
}): TranslationLocales => {
  const locales = tenantLocales?.supportedLocales ?? getLocales();
  const offered = new Set(locales);
  const visibleLocales = translatedLocales.filter((code) => offered.has(code));

  if (requestedLocale && offered.has(requestedLocale)) {
    return { locales, shownLocale: requestedLocale, visibleLocales };
  }

  if (!tenantLocales) {
    return { locales, shownLocale: undefined, visibleLocales };
  }

  return {
    locales,
    shownLocale: visibleLocales.includes(tenantLocales.defaultLocale)
      ? tenantLocales.defaultLocale
      : (visibleLocales[0] ?? tenantLocales.defaultLocale),
    visibleLocales,
  };
};

/** The tabs of a record, and the translation its form edits. */
export interface TranslationToEdit<T> extends Omit<
  TranslationLocales,
  "shownLocale"
> {
  /**
   * The language the form writes. Undefined only for a record with no
   * translation at all, which the API never answers.
   */
  shownLocale: Locale | undefined;
  /** The record's translation in {@link shownLocale}, absent until one is added. */
  translation: T | undefined;
}

/**
 * {@link resolveTranslationLocales} for a form that writes one language and
 * must name it. Where the tenant's languages cannot be read, it opens the
 * oldest translation that has a tab, else the oldest of all: the API falls
 * back to the oldest as well, so the form shows what readers are shown.
 */
export const resolveTranslationToEdit = <T extends { locale: Locale }>({
  requestedLocale,
  tenantLocales,
  translations,
}: {
  requestedLocale: Locale | undefined;
  tenantLocales: TenantLocales | null;
  /** Every translation of the record, oldest first. */
  translations: readonly T[];
}): TranslationToEdit<T> => {
  const translatedLocales = translations.map(
    (translation) => translation.locale
  );

  const { locales, shownLocale, visibleLocales } = resolveTranslationLocales({
    requestedLocale,
    tenantLocales,
    translatedLocales,
  });

  const localeToEdit = shownLocale ?? visibleLocales[0] ?? translatedLocales[0];

  return {
    locales,
    shownLocale: localeToEdit,
    translation: translations.find(
      (translation) => translation.locale === localeToEdit
    ),
    visibleLocales,
  };
};

/**
 * The edit screen at `path` opened on one translation, with the flag its toast
 * reads. Without a locale it opens the one {@link resolveTranslationLocales}
 * picks.
 */
export const translationEditPath = (
  path: string,
  translationLocale?: Locale,
  flash?: string
): string => {
  const query = new URLSearchParams();

  if (translationLocale) {
    query.set("locale", translationLocale);
  }

  if (flash) {
    query.set(flash, "1");
  }

  const search = query.toString();

  return search ? `${path}?${search}` : path;
};
