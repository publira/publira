import type { Locale } from "@publira/i18n";

/**
 * The names of a genre form's name fields, shared by the form that draws them
 * and the Action that reads them back.
 */

/** The hidden field naming the default language, on a form that has one field per language. */
export const DEFAULT_LOCALE_FIELD = "default_locale";

/** One language's name; without a language, the one field of a form that has no others. */
export const nameField = (translationLocale?: Locale): string =>
  translationLocale ? `name.${translationLocale}` : "name";

/** The name {@link nameField} held when the form was drawn. */
export const savedNameField = (translationLocale?: Locale): string =>
  translationLocale ? `saved_name.${translationLocale}` : "saved_name";
