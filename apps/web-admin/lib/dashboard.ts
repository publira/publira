import { rpcErrorMessage } from "@publira/api-client/error-messages";
import { rethrowUnclassifiedRpcError } from "@publira/api-client/errors";
import type { Locale } from "@publira/i18n";
import { cacheTag } from "next/cache";

import { isUnauthenticatedError } from "./admin-auth-shared";
import { apiClient, withSessionHeaders } from "./api";
import { getMessagesFor } from "./messages";
import { getAccessToken } from "./session";

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
  | {
      ok: false;
      message: string;
      /** The API rejected the session — the page raises the login redirect. */
      requiresSignIn: boolean;
    };

/**
 * Tag the dashboard's cached read carries, so `updateTag` in a Server Action
 * that writes what it reports — a series' publish state or title, an episode's
 * schedule — makes the new counts and publishing queue visible in the same
 * session instead of leaving the numbers from before the save in the private
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

export const getDashboard = async (
  tenantId: string,
  locale: Locale
): Promise<GetDashboardResult> => {
  "use cache: private";

  const sessionId = await getAccessToken();
  if (!sessionId) {
    const t = await getMessagesFor(locale);
    return {
      message: t("errors.rpc.unauthenticated"),
      ok: false,
      requiresSignIn: true,
    };
  }

  cacheTag(tenantDashboardCacheTag(tenantId));

  try {
    const response = await apiClient.dashboard.getDashboard(
      { tenant: { tenantId } },
      withSessionHeaders(sessionId)
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
    rethrowUnclassifiedRpcError(error);
    return {
      message: await mapErrorToMessage(error, locale),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
    };
  }
};
