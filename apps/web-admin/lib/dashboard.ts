import { rpcErrorMessage } from "@publira/api-client/error-messages";
import type { Locale } from "@publira/i18n";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";
import { cacheTag } from "next/cache";

import { verifyAdminPageSession } from "./admin-page-session";
import { apiClient, withServiceHeaders } from "./api";
import { episodePublicationCacheTag, episodesCacheTag } from "./episode";
import { getMessagesFor } from "./messages";

export interface DashboardStats {
  publishedSeriesCount: number;
  draftEpisodeCount: number;
  scheduledEpisodeCount: number;
}

export interface DashboardQueueItem {
  seriesPublicId: string;
  seriesTitle: string;
  episodePublicId: string;
  episodeTitle: string;
  status: "draft" | "scheduled";
  scheduledAt: string;
}

export type GetDashboardResult =
  | { ok: true; stats: DashboardStats; queue: DashboardQueueItem[] }
  | { ok: false; message: string };

/**
 * Tag the dashboard's cached read carries, so `updateTag` in a Server Action
 * that writes what it reports — a series' publish state or title, an episode's
 * schedule — makes the new counts and publishing queue visible on the next
 * read instead of leaving the numbers from before the save in the shared
 * cache.
 */
export const tenantDashboardCacheTag = (tenantId: string): string =>
  `tenant:${tenantId.trim()}:dashboard`;

const mapErrorToMessage = async (
  error: unknown,
  locale: Locale
): Promise<string> => {
  const t = await getMessagesFor(locale);

  return rpcErrorMessage(error, t("admin.dashboard.load_error"), { locale });
};

const getDashboardForTenant = async (
  tenantId: string,
  locale: Locale
): Promise<GetDashboardResult> => {
  "use cache";
  cacheTag(tenantDashboardCacheTag(tenantId));
  cacheTag(episodesCacheTag(tenantId));
  cacheTag(episodePublicationCacheTag(tenantId));

  try {
    const response = await apiClient.dashboard.getDashboard(
      { tenant: { tenantId } },
      withServiceHeaders()
    );

    const stats: DashboardStats = {
      draftEpisodeCount: response.stats?.draftEpisodeCount ?? 0,
      publishedSeriesCount: response.stats?.publishedSeriesCount ?? 0,
      scheduledEpisodeCount: response.stats?.scheduledEpisodeCount ?? 0,
    };

    const queue: DashboardQueueItem[] = (response.queue ?? []).map((item) => ({
      episodePublicId: item.episodePublicId,
      episodeTitle: item.episodeTitle,
      scheduledAt: item.scheduledAt,
      seriesPublicId: item.seriesPublicId,
      seriesTitle: item.seriesTitle,
      status: item.status === "scheduled" ? "scheduled" : "draft",
    }));

    return { ok: true, queue, stats };
  } catch (error) {
    // A `"use cache"` scope cannot rethrow: the fill would fail the whole
    // request. The entry is dropped instead, so the answer comes back as soon
    // as the API does.
    dropFailedCacheEntry();
    return {
      message: await mapErrorToMessage(error, locale),
      ok: false,
    };
  }
};

/**
 * The tenant's publishing overview, read with the service credential: the same
 * for every operator of the tenant, so one entry serves all of them. Its queue
 * lists episodes, so it carries the episode tags as well — an episode saved,
 * or gone live on its schedule, leaves the queue it was in.
 */
export const getDashboard = async (): Promise<GetDashboardResult> => {
  const { locale, tenantId } = await verifyAdminPageSession();
  return getDashboardForTenant(tenantId, locale);
};
