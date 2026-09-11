import { isMissingResourceRpcError } from "@publira/api-client/errors";
import type { PublishedCreator } from "@publira/api-client/public/types";
import type { Locale } from "@publira/i18n";
import type { CachedReadResult } from "@publira/utils/cached-read";

import { apiClient } from "./api-client";
import {
  applyCacheTag,
  tenantCreatorsTag,
  tenantSeriesListTag,
} from "./cache-tags";
import { toSeriesListItem } from "./catalog";
import type { SeriesListItem } from "./catalog";
import { localizedReadFailure } from "./read-failure";

export interface PublishedCreatorListItem {
  id: string;
  name: string;
  iconImageUrl: string;
  seriesCount: number;
}

export interface PublishedCreatorDetail {
  id: string;
  name: string;
  iconImageUrl: string;
  profileText: string;
  seriesCount: number;
  series: SeriesListItem[];
  /** Token for the previous series page. Empty on the first page. */
  previousToken: string;
  /** Token for the next series page. Empty on the last page. */
  nextToken: string;
}

export interface PublishedCreatorListResult {
  creators: PublishedCreatorListItem[];
  /** Token for the previous page. Empty on the first page. */
  previousToken: string;
  /** Token for the next page. Empty on the last page. */
  nextToken: string;
}

/**
 * The generated `PublishedCreator` fields {@link mapPublishedCreator} reads.
 * Naming them against the message type is what makes a proto rename fail here —
 * a restated structural type keeps compiling, and the creator page then renders
 * a nameless creator with no profile text and nothing pointing at the cause.
 */
type RawPublishedCreator = Pick<
  PublishedCreator,
  "iconImageUrl" | "name" | "profileText" | "publicId" | "publishedSeriesCount"
>;

const mapPublishedCreator = (
  creator: RawPublishedCreator
): Omit<PublishedCreatorDetail, "nextToken" | "previousToken" | "series"> => ({
  iconImageUrl: creator.iconImageUrl?.trim() ?? "",
  id: creator.publicId ?? "",
  name: (creator.name ?? "").trim(),
  profileText: (creator.profileText ?? "").trim(),
  seriesCount: creator.publishedSeriesCount ?? 0,
});

/**
 * Cursor pagination: `token` is whatever the previous response returned as
 * `previousToken` / `nextToken`, and is opaque to the caller. Contract:
 * `proto/README.md`.
 */
export const listPublishedCreators = async (
  tenantId: string,
  {
    limit = 20,
    locale,
    token = "",
  }: { limit?: number; locale: Locale; token?: string }
): Promise<CachedReadResult<PublishedCreatorListResult>> => {
  "use cache";

  const normalizedTenantId = tenantId.trim();
  applyCacheTag(tenantCreatorsTag(normalizedTenantId));

  let response: Awaited<
    ReturnType<typeof apiClient.catalog.listPublishedCreators>
  >;
  try {
    response = await apiClient.catalog.listPublishedCreators({
      limit,
      tenant: { tenantId: normalizedTenantId },
      token,
    });
  } catch (error) {
    return localizedReadFailure(error, locale, "host.creators.list_failed");
  }

  return {
    ok: true,
    value: {
      creators: (response.creators ?? []).map((creator) => {
        const mapped = mapPublishedCreator(creator);
        return {
          iconImageUrl: mapped.iconImageUrl,
          id: mapped.id,
          name: mapped.name,
          seriesCount: mapped.seriesCount,
        };
      }),
      nextToken: response.nextToken ?? "",
      previousToken: response.previousToken ?? "",
    },
  };
};

/**
 * Creators whose name matches, narrowed to the ones credited on a currently
 * published series — the population {@link listPublishedCreators} shows. A
 * publish therefore changes the answer, so the series list tag invalidates it
 * alongside the creator tag.
 *
 * Only the name is matched: a biography that mentions another creator would
 * otherwise answer a name search with someone the reader did not ask for.
 *
 * Cursor pagination as {@link listPublishedCreators}, plus the rule that a token
 * belongs to the query it was built for.
 */
export const searchPublishedCreators = async (
  tenantId: string,
  {
    limit = 20,
    locale,
    query,
    token = "",
  }: { limit?: number; locale: Locale; query: string; token?: string }
): Promise<CachedReadResult<PublishedCreatorListResult>> => {
  "use cache";

  const normalizedTenantId = tenantId.trim();
  applyCacheTag(tenantCreatorsTag(normalizedTenantId));
  applyCacheTag(tenantSeriesListTag(normalizedTenantId));

  let response: Awaited<
    ReturnType<typeof apiClient.catalog.searchPublishedCreators>
  >;
  try {
    response = await apiClient.catalog.searchPublishedCreators({
      limit,
      query,
      tenant: { tenantId: normalizedTenantId },
      token,
    });
  } catch (error) {
    return localizedReadFailure(error, locale, "host.search.creators_failed");
  }

  return {
    ok: true,
    value: {
      creators: (response.creators ?? []).map((creator) => {
        const mapped = mapPublishedCreator(creator);
        return {
          iconImageUrl: mapped.iconImageUrl,
          id: mapped.id,
          name: mapped.name,
          seriesCount: mapped.seriesCount,
        };
      }),
      nextToken: response.nextToken ?? "",
      previousToken: response.previousToken ?? "",
    },
  };
};

/**
 * `ok: true` with a `null` value when the creator does not exist, has no
 * currently published series, or belongs to another tenant — the server
 * returns `not_found` or `permission_denied` for those and the public site
 * must not tell them apart.
 *
 * `ok: false` when the fetch itself failed. Neither case throws: a `"use cache"`
 * fill that throws fails the whole request.
 *
 * Related series are one cursor page. Pass the previous response's token to
 * move; the first call (empty token) is enough to render the creator.
 */
export const getPublishedCreatorDetail = async (
  tenantId: string,
  creatorId: string,
  {
    limit = 20,
    locale,
    token = "",
  }: { limit?: number; locale: Locale; token?: string }
): Promise<CachedReadResult<PublishedCreatorDetail | null>> => {
  "use cache";

  const normalizedTenantId = tenantId.trim();
  const normalizedCreatorId = creatorId.trim();
  applyCacheTag(tenantCreatorsTag(normalizedTenantId));

  let response: Awaited<
    ReturnType<typeof apiClient.catalog.getPublishedCreatorDetail>
  >;
  try {
    response = await apiClient.catalog.getPublishedCreatorDetail({
      limit,
      publicId: normalizedCreatorId,
      tenant: { tenantId: normalizedTenantId },
      token,
    });
  } catch (error) {
    if (isMissingResourceRpcError(error)) {
      return { ok: true, value: null };
    }
    return localizedReadFailure(error, locale, "host.creators.detail_failed");
  }

  if (!response.creator) {
    return { ok: true, value: null };
  }

  return {
    ok: true,
    value: {
      ...mapPublishedCreator(response.creator),
      nextToken: response.nextToken ?? "",
      previousToken: response.previousToken ?? "",
      series: (response.series ?? []).flatMap((series) =>
        (series.publicId?.trim() ?? "").length > 0
          ? [toSeriesListItem(series)]
          : []
      ),
    },
  };
};
