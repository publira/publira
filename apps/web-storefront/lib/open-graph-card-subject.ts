import type { Locale } from "@publira/i18n";
import type { CachedReadResult } from "@publira/utils/cached-read";

import {
  findPublishedTagBySlug,
  getEpisodeDetail,
  getSeriesDetail,
  listPublishedGenres,
} from "./catalog";
import {
  CREATOR_SERIES_PAGE_SIZE,
  getPublishedCreatorDetail,
} from "./creators";
import { episodeDisplayTitle } from "./episode-title";
import { getPublishedLabelDetail, LABEL_SERIES_PAGE_SIZE } from "./labels";
import { getMessagesFor } from "./messages";
import { getPublishedPage } from "./pages";
import {
  getTenantPublicOrigin,
  getTenantSiteCopy,
  getTenantSiteInfo,
} from "./tenant";
import { tenantLocalePath } from "./tenant-locale-path";

/**
 * What one card is about, by the identifiers its route carries. Every string
 * the card says is read back from these, so a card says nothing its page does
 * not.
 */
export type OpenGraphCardSubject =
  | { creatorId: string; kind: "creator" }
  | { episodeId: string; kind: "episode"; seriesId: string }
  | { genreId: string; kind: "genre" }
  | { kind: "label"; labelId: string }
  | { kind: "page"; slug: readonly string[] }
  | { kind: "series"; seriesId: string }
  | { kind: "site" }
  | { kind: "tag"; tagSlug: string };

/** The lines a card sets above the tenant's brand. */
export interface OpenGraphCardText {
  /** The smaller line above the title: what the subject belongs to. */
  eyebrow?: string;
  title: string;
}

/**
 * The path a subject's card is served at, before the locale prefix, mirroring
 * the path of the page it stands for under `/og`.
 */
export const openGraphCardPath = (subject: OpenGraphCardSubject): string => {
  switch (subject.kind) {
    case "creator": {
      return `/og/creators/${subject.creatorId}`;
    }
    case "episode": {
      return `/og/series/${subject.seriesId}/episodes/${subject.episodeId}`;
    }
    case "genre": {
      return `/og/genres/${subject.genreId}`;
    }
    case "label": {
      return `/og/labels/${subject.labelId}`;
    }
    case "page": {
      return `/og/page/${subject.slug.join("/")}`;
    }
    case "series": {
      return `/og/series/${subject.seriesId}`;
    }
    case "site": {
      return "/og";
    }
    case "tag": {
      return `/og/tags/${subject.tagSlug}`;
    }
    default: {
      return subject satisfies never;
    }
  }
};

/**
 * The path `metadataBase` resolves `subject`'s card against, with the locale
 * prefix the page's own URL carries, or `undefined` where the tenant's origin
 * is unavailable: the root layout then has no `metadataBase`, and Next.js
 * would write the path against `localhost`.
 */
export const tenantOpenGraphCardPath = async (
  tenantId: string,
  locale: Locale,
  subject: OpenGraphCardSubject
): Promise<string | undefined> => {
  const origin = await getTenantPublicOrigin(tenantId);
  if (!origin) {
    return undefined;
  }
  return await tenantLocalePath(tenantId, locale, openGraphCardPath(subject));
};

type CardTextResult = CachedReadResult<OpenGraphCardText | null>;

/** A read's failure, or its value carried onto the card's text. */
const toCardText = <TValue>(
  result: CachedReadResult<TValue | null>,
  text: (value: TValue) => OpenGraphCardText
): CardTextResult => {
  if (!result.ok) {
    return result;
  }
  return { ok: true, value: result.value ? text(result.value) : null };
};

/**
 * The site's own card: its tagline where the tenant wrote one, and its name
 * otherwise, which the brand under it names either way. `null` where there is
 * no such tenant, or it could not be read: `getTenantSiteInfo` cannot tell the
 * two apart, and drops the entry when it could not ask.
 */
const resolveSiteCardText = async (
  tenantId: string,
  locale: Locale
): Promise<CardTextResult> => {
  const [tenant, { siteTagline }] = await Promise.all([
    getTenantSiteInfo(tenantId),
    getTenantSiteCopy(tenantId, locale),
  ]);
  const name = tenant?.name.trim();
  if (!name) {
    return { ok: true, value: null };
  }
  return { ok: true, value: { title: siteTagline ?? name } };
};

/**
 * What `subject`'s card says in `locale`, through the same `"use cache"` reads
 * and under the same arguments its page passes, so a card costs no RPC its
 * page has not already made. `null` where the page would answer 404.
 */
export const resolveOpenGraphCardText = async (
  tenantId: string,
  locale: Locale,
  subject: OpenGraphCardSubject
): Promise<CardTextResult> => {
  switch (subject.kind) {
    case "creator": {
      const [result, t] = await Promise.all([
        getPublishedCreatorDetail(tenantId, subject.creatorId, {
          limit: CREATOR_SERIES_PAGE_SIZE,
          locale,
          token: "",
        }),
        getMessagesFor(locale),
      ]);
      return toCardText(result, (creator) => ({
        eyebrow: t("storefront.creators.list_title"),
        title: creator.name,
      }));
    }
    case "episode": {
      const [result, t] = await Promise.all([
        getEpisodeDetail(tenantId, subject.seriesId, subject.episodeId, locale),
        getMessagesFor(locale),
      ]);
      return toCardText(result, ({ episode, series }) => ({
        eyebrow: series.title,
        title: episodeDisplayTitle(t, episode),
      }));
    }
    case "genre": {
      const [result, t] = await Promise.all([
        listPublishedGenres(tenantId, locale),
        getMessagesFor(locale),
      ]);
      if (!result.ok) {
        return result;
      }
      const genre = result.value.find(
        ({ publicId }) => publicId === subject.genreId
      );
      return {
        ok: true,
        value: genre
          ? { eyebrow: t("storefront.genres.list_title"), title: genre.name }
          : null,
      };
    }
    case "label": {
      const [result, t] = await Promise.all([
        getPublishedLabelDetail(tenantId, subject.labelId, {
          limit: LABEL_SERIES_PAGE_SIZE,
          locale,
          token: "",
        }),
        getMessagesFor(locale),
      ]);
      return toCardText(result, (label) => ({
        eyebrow: t("storefront.labels.list_title"),
        title: label.name,
      }));
    }
    case "page": {
      const result = await getPublishedPage(tenantId, subject.slug, locale);
      return toCardText(result, (page) => ({ title: page.title }));
    }
    case "series": {
      const result = await getSeriesDetail(tenantId, subject.seriesId, locale);
      return toCardText(result, ({ series }) => ({ title: series.title }));
    }
    case "site": {
      return await resolveSiteCardText(tenantId, locale);
    }
    case "tag": {
      const result = await findPublishedTagBySlug(
        tenantId,
        subject.tagSlug,
        locale
      );
      return toCardText(result, (tag) => ({ title: tag.name }));
    }
    default: {
      return subject satisfies never;
    }
  }
};
