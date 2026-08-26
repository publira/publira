import { rpcErrorMessage } from "@publira/api-client/error-messages";
import { isMissingResourceRpcError } from "@publira/api-client/errors";
import type { PublishedAuthor } from "@publira/api-client/public/types";
import { cachedReadFailure } from "@publira/utils/cached-read";
import type { CachedReadResult } from "@publira/utils/cached-read";

import { apiClient } from "./api-client";
import { applyCacheTag, tenantAuthorsTag } from "./cache-tags";

const AUTHORS_LIST_ERROR_MESSAGE =
  "著者一覧を取得できませんでした。時間をおいて再試行してください。";
const AUTHOR_DETAIL_ERROR_MESSAGE =
  "著者を取得できませんでした。時間をおいて再試行してください。";

export interface PublishedAuthorListItem {
  id: string;
  name: string;
  iconImageUrl: string;
  seriesCount: number;
}

export interface PublishedAuthorSeriesItem {
  publicId: string;
  title: string;
}

export interface PublishedAuthorDetail {
  id: string;
  name: string;
  iconImageUrl: string;
  profileText: string;
  seriesCount: number;
  series: PublishedAuthorSeriesItem[];
  /** Token for the previous series page. Empty on the first page. */
  previousToken: string;
  /** Token for the next series page. Empty on the last page. */
  nextToken: string;
}

export interface PublishedAuthorListResult {
  authors: PublishedAuthorListItem[];
  /** Token for the previous page. Empty on the first page. */
  previousToken: string;
  /** Token for the next page. Empty on the last page. */
  nextToken: string;
}

/**
 * The generated `PublishedAuthor` fields {@link mapPublishedAuthor} reads.
 * Naming them against the message type is what makes a proto rename fail here —
 * a restated structural type keeps compiling, and the author page then renders
 * a nameless author with no profile text and nothing pointing at the cause.
 */
type RawPublishedAuthor = Pick<
  PublishedAuthor,
  "iconImageUrl" | "name" | "profileText" | "publicId" | "publishedSeriesCount"
>;

const mapPublishedAuthor = (
  author: RawPublishedAuthor
): Omit<PublishedAuthorDetail, "nextToken" | "previousToken" | "series"> => ({
  iconImageUrl: author.iconImageUrl?.trim() ?? "",
  id: author.publicId ?? "",
  name: (author.name ?? "").trim(),
  profileText: (author.profileText ?? "").trim(),
  seriesCount: author.publishedSeriesCount ?? 0,
});

/**
 * Cursor pagination: `token` is whatever the previous response returned as
 * `previousToken` / `nextToken`, and is opaque to the caller. Contract:
 * `proto/README.md`.
 */
export const listPublishedAuthors = async (
  tenantId: string,
  { limit = 20, token = "" }: { limit?: number; token?: string } = {}
): Promise<CachedReadResult<PublishedAuthorListResult>> => {
  "use cache";

  const normalizedTenantId = tenantId.trim();
  applyCacheTag(tenantAuthorsTag(normalizedTenantId));

  let response: Awaited<
    ReturnType<typeof apiClient.catalog.listPublishedAuthors>
  >;
  try {
    response = await apiClient.catalog.listPublishedAuthors({
      limit,
      tenant: { tenantId: normalizedTenantId },
      token,
    });
  } catch (error) {
    return cachedReadFailure(
      rpcErrorMessage(error, AUTHORS_LIST_ERROR_MESSAGE)
    );
  }

  return {
    ok: true,
    value: {
      authors: (response.authors ?? []).map((author) => {
        const mapped = mapPublishedAuthor(author);
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
 * `ok: true` with a `null` value when the author does not exist, has no
 * currently published series, or belongs to another tenant — the server
 * returns `not_found` or `permission_denied` for those and the public site
 * must not tell them apart.
 *
 * `ok: false` when the fetch itself failed. Neither case throws: a `"use cache"`
 * fill that throws fails the whole request (#672).
 *
 * Related series are one cursor page. Pass the previous response's token to
 * move; the first call (empty token) is enough to render the author.
 */
export const getPublishedAuthorDetail = async (
  tenantId: string,
  authorId: string,
  { limit = 20, token = "" }: { limit?: number; token?: string } = {}
): Promise<CachedReadResult<PublishedAuthorDetail | null>> => {
  "use cache";

  const normalizedTenantId = tenantId.trim();
  const normalizedAuthorId = authorId.trim();
  applyCacheTag(tenantAuthorsTag(normalizedTenantId));

  let response: Awaited<
    ReturnType<typeof apiClient.catalog.getPublishedAuthorDetail>
  >;
  try {
    response = await apiClient.catalog.getPublishedAuthorDetail({
      limit,
      publicId: normalizedAuthorId,
      tenant: { tenantId: normalizedTenantId },
      token,
    });
  } catch (error) {
    if (isMissingResourceRpcError(error)) {
      return { ok: true, value: null };
    }
    return cachedReadFailure(
      rpcErrorMessage(error, AUTHOR_DETAIL_ERROR_MESSAGE)
    );
  }

  if (!response.author) {
    return { ok: true, value: null };
  }

  return {
    ok: true,
    value: {
      ...mapPublishedAuthor(response.author),
      nextToken: response.nextToken ?? "",
      previousToken: response.previousToken ?? "",
      series: (response.series ?? []).flatMap((series) => {
        const publicId = series.publicId?.trim() ?? "";
        return publicId.length > 0
          ? [{ publicId, title: series.title?.trim() ?? "" }]
          : [];
      }),
    },
  };
};
