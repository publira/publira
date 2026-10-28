import type { EpisodePublication } from "@publira/api-client/admin/types";
import { rpcErrorMessage } from "@publira/api-client/error-messages";
import { forEachPageWithToken } from "@publira/api-client/pagination";
import type { Locale } from "@publira/i18n";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";
import { cacheTag } from "next/cache";

import { verifyAdminPageSession } from "./admin-page-session";
import { apiClient, withServiceHeaders } from "./api";
import { tenantDashboardCacheTag } from "./dashboard";
import { episodePublicationCacheTag, episodesCacheTag } from "./episode";
import { getMessagesFor } from "./messages";

export interface EpisodePublicationItem {
  seriesPublicId: string;
  seriesTitle: string;
  episodePublicId: string;
  episodeTitle: string;
  status: "published" | "scheduled";
  /** RFC 3339: when it was published, or is to be. */
  publishedAt: string;
}

export type ListEpisodePublicationsResult =
  | { ok: true; episodes: EpisodePublicationItem[] }
  | { ok: false; message: string };

type RawEpisodePublication = Pick<
  EpisodePublication,
  | "episodePublicId"
  | "episodeTitle"
  | "publishedAt"
  | "seriesPublicId"
  | "seriesTitle"
  | "status"
>;

const mapEpisodePublication = (
  item: RawEpisodePublication
): EpisodePublicationItem => ({
  episodePublicId: item.episodePublicId ?? "",
  episodeTitle: item.episodeTitle ?? "",
  publishedAt: item.publishedAt ?? "",
  seriesPublicId: item.seriesPublicId ?? "",
  seriesTitle: item.seriesTitle ?? "",
  status: item.status === "published" ? "published" : "scheduled",
});

/**
 * The cached body of {@link listEpisodePublications}, keyed on the tenant, the
 * locale its failure is worded in, and the period.
 *
 * It reports the series titles and the episode schedules the dashboard's queue
 * does, so it carries the dashboard's tags: every write that changes one of
 * those already clears them, and `publira server` drops the publication tag
 * when a scheduled episode goes live on its own.
 */
const listEpisodePublicationsForTenant = async (
  input: { endDate: string; startDate: string; tenantId: string },
  locale: Locale
): Promise<ListEpisodePublicationsResult> => {
  "use cache";
  cacheTag(tenantDashboardCacheTag(input.tenantId));
  cacheTag(episodesCacheTag(input.tenantId));
  cacheTag(episodePublicationCacheTag(input.tenantId));

  const t = await getMessagesFor(locale);
  try {
    const episodes: EpisodePublicationItem[] = [];
    const walkStop = await forEachPageWithToken(
      async (token, limit) => {
        const response = await apiClient.series.listEpisodesByPublicationDate(
          {
            endDate: input.endDate,
            limit,
            startDate: input.startDate,
            tenant: { tenantId: input.tenantId },
            token,
          },
          withServiceHeaders()
        );
        return {
          items: response.episodes ?? [],
          nextToken: response.nextToken ?? "",
        };
      },
      (items) => {
        for (const item of items) {
          episodes.push(mapEpisodePublication(item));
        }
      }
    );

    // A calendar missing the later pages would show those days as free, which
    // reads as an answer rather than as a failure.
    if (walkStop !== "completed") {
      dropFailedCacheEntry();
      return { message: t("admin.calendar.load_error"), ok: false };
    }

    return { episodes, ok: true };
  } catch (error) {
    // A `"use cache"` scope cannot rethrow: the fill would fail the whole
    // request. The entry is dropped instead, so the answer comes back as soon
    // as the API does.
    dropFailedCacheEntry();
    return {
      message: rpcErrorMessage(error, t("admin.calendar.load_error"), {
        locale,
      }),
      ok: false,
    };
  }
};

/**
 * Every scheduled and published episode of the tenant whose publication falls
 * between two of the tenant's calendar days, both included, in the order they
 * go out. Read with the service credential: the answer is the same for every
 * operator of the tenant, so one entry serves all of them.
 */
export const listEpisodePublications = async (input: {
  endDate: string;
  startDate: string;
}): Promise<ListEpisodePublicationsResult> => {
  const { locale, tenantId } = await verifyAdminPageSession();
  return listEpisodePublicationsForTenant({ ...input, tenantId }, locale);
};
