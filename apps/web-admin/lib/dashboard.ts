import { rpcErrorMessage } from "@publira/api-client/error-messages";
import { rethrowUnclassifiedRpcError } from "@publira/api-client/errors";
import { DEFAULT_LOCALE, getMessage } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";

import { isUnauthenticatedError } from "./admin-auth-shared";
import { apiClient, withSessionHeaders } from "./api";
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

const mapErrorToMessage = (error: unknown, locale: Locale): string =>
  rpcErrorMessage(
    error,
    getMessage(sharedCatalog(locale), "admin.dashboard.load_error")
  );

export const getDashboard = async (
  tenantId: string,
  locale: Locale = DEFAULT_LOCALE
): Promise<GetDashboardResult> => {
  "use cache: private";

  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      message: getMessage(
        sharedCatalog(locale),
        "admin.dashboard.session_invalid"
      ),
      ok: false,
      requiresSignIn: true,
    };
  }

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
      message: mapErrorToMessage(error, locale),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
    };
  }
};
