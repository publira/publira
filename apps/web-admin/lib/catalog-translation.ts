import type {
  EpisodeTranslation,
  SeriesTranslation,
} from "@publira/api-client/admin/series";
import { parseLocale } from "@publira/i18n";
import type { Locale } from "@publira/i18n";

/** One language's title and synopsis of a series. */
export interface SeriesTranslationItem {
  locale: Locale;
  title: string;
  synopsis: string;
}

/** One language's title of an episode. */
export interface EpisodeTranslationItem {
  locale: Locale;
  title: string;
}

/**
 * The generated `SeriesTranslation` fields {@link toSeriesTranslations} reads.
 * Named against the message type, so a proto rename fails here.
 */
type RawSeriesTranslation = Pick<
  SeriesTranslation,
  "locale" | "synopsis" | "title"
>;

/** The generated `EpisodeTranslation` fields {@link toEpisodeTranslations} reads. */
type RawEpisodeTranslation = Pick<EpisodeTranslation, "locale" | "title">;

/**
 * A series' translations, oldest first, as the API answers them. One in a
 * language this build serves no catalog for has no tab to show it in, so it is
 * left out rather than shown under a code nobody can read.
 */
export const toSeriesTranslations = (
  translations: readonly RawSeriesTranslation[] | undefined
): SeriesTranslationItem[] =>
  (translations ?? []).flatMap((translation) => {
    const locale = parseLocale(translation.locale?.trim());

    return locale
      ? [
          {
            locale,
            synopsis: translation.synopsis ?? "",
            title: translation.title ?? "",
          },
        ]
      : [];
  });

/** An episode's translations, under the rule {@link toSeriesTranslations} follows. */
export const toEpisodeTranslations = (
  translations: readonly RawEpisodeTranslation[] | undefined
): EpisodeTranslationItem[] =>
  (translations ?? []).flatMap((translation) => {
    const locale = parseLocale(translation.locale?.trim());

    return locale ? [{ locale, title: translation.title ?? "" }] : [];
  });
