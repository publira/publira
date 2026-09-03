import { isMissingResourceRpcError } from "@publira/api-client/errors";
import type { Locale } from "@publira/i18n";
import type { CachedReadResult } from "@publira/utils/cached-read";

import { apiClient } from "./api-client";
import {
  applyCacheTag,
  tenantLabelsTag,
  tenantSeriesListTag,
} from "./cache-tags";
import { toEyeCatchImageVariants } from "./catalog";
import type { EyeCatchImageVariant } from "./catalog";
import { localizedReadFailure } from "./read-failure";

export interface PublishedLabelSeriesItem {
  publicId: string;
  title: string;
}

export interface PublishedLabelDetail {
  id: string;
  name: string;
  seriesCount: number;
  eyeCatchImageUpdatedAt?: string;
  eyeCatchImageVariants?: EyeCatchImageVariant[];
  series: PublishedLabelSeriesItem[];
  /** Token for the previous series page. Empty on the first page. */
  previousToken: string;
  /** Token for the next series page. Empty on the last page. */
  nextToken: string;
}

/**
 * `ok: true` with a `null` value when the label does not exist or belongs to
 * another tenant — the server returns `not_found` or `permission_denied` for
 * those and the public site must not tell them apart.
 *
 * `ok: false` when the fetch itself failed. Neither case throws: a `"use cache"`
 * fill that throws fails the whole request.
 *
 * Related series are one cursor page. Pass the previous response's token to
 * move; the first call (empty token) is enough to render the label.
 */
export const getPublishedLabelDetail = async (
  tenantId: string,
  labelId: string,
  {
    limit = 20,
    locale,
    token = "",
  }: { limit?: number; locale: Locale; token?: string }
): Promise<CachedReadResult<PublishedLabelDetail | null>> => {
  "use cache";

  const normalizedTenantId = tenantId.trim();
  const normalizedLabelId = labelId.trim();
  applyCacheTag(tenantLabelsTag(normalizedTenantId));
  applyCacheTag(tenantSeriesListTag(normalizedTenantId));

  let response: Awaited<
    ReturnType<typeof apiClient.catalog.getPublishedLabelDetail>
  >;
  try {
    response = await apiClient.catalog.getPublishedLabelDetail({
      limit,
      publicId: normalizedLabelId,
      tenant: { tenantId: normalizedTenantId },
      token,
    });
  } catch (error) {
    if (isMissingResourceRpcError(error)) {
      return { ok: true, value: null };
    }
    return localizedReadFailure(error, locale, "host.labels.detail_failed");
  }

  const publicId = response.label?.publicId?.trim() ?? "";
  if (!response.label || publicId.length === 0) {
    return { ok: true, value: null };
  }

  return {
    ok: true,
    value: {
      eyeCatchImageUpdatedAt:
        response.label.eyeCatchImageUpdatedAt || undefined,
      eyeCatchImageVariants: toEyeCatchImageVariants(
        response.label.eyeCatchImageVariants
      ),
      id: publicId,
      name: (response.label.name ?? "").trim(),
      nextToken: response.nextToken ?? "",
      previousToken: response.previousToken ?? "",
      series: (response.series ?? []).flatMap((series) => {
        const seriesPublicId = series.publicId?.trim() ?? "";
        return seriesPublicId.length > 0
          ? [{ publicId: seriesPublicId, title: series.title?.trim() ?? "" }]
          : [];
      }),
      seriesCount: response.label.publishedSeriesCount ?? 0,
    },
  };
};
