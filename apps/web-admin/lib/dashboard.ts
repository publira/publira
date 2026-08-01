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
  | { ok: false; message: string };

const mapErrorToMessage = (error: unknown): string => {
  if (!(error instanceof Error)) {
    return "ダッシュボードの取得に失敗しました。時間をおいて再試行してください。";
  }

  const message = error.message.toLowerCase();

  if (
    message.includes("unauthenticated") ||
    message.includes("permission_denied")
  ) {
    return "セッションが無効です。再ログインしてください。";
  }

  return "ダッシュボードの取得に失敗しました。時間をおいて再試行してください。";
};

export const getDashboard = async (
  tenantId: string
): Promise<GetDashboardResult> => {
  "use cache: private";

  const sessionId = await getAccessToken();
  if (!sessionId) {
    return {
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
    };
  }

  try {
    const response = await apiClient.dashboard.getDashboard(
      { tenant: { tenantId: tenantId } },
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
    return {
      message: mapErrorToMessage(error),
      ok: false,
    };
  }
};
