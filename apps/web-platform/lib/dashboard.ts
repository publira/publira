import { rpcErrorMessage } from "@publira/api-client/error-messages";
import { rethrowUnclassifiedRpcError } from "@publira/api-client/errors";

import {
  apiClient,
  buildSessionHeaders,
  resolveAccessToken,
} from "./api-client";

export interface PlatformDashboardRecentEvent {
  action: string;
  actor: string;
  at: string;
  eventType: string;
  target: string;
}

export interface PlatformDashboardSummary {
  activeTenants: number;
  pendingEndUsers: number;
  recentEvents: PlatformDashboardRecentEvent[];
  suspendedTenants: number;
  totalTenants: number;
}

export type GetPlatformDashboardSummaryResult =
  | { ok: true; summary: PlatformDashboardSummary }
  | { ok: false; message: string };

const normalizeRecentEventsLimit = (value?: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 10;
  }

  return Math.max(1, Math.min(50, Math.trunc(value)));
};

export const getPlatformDashboardSummary = async (input?: {
  recentEventsLimit?: number;
}): Promise<GetPlatformDashboardSummaryResult> => {
  "use cache: private";

  const sid = await resolveAccessToken();
  if (!sid) {
    return {
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
    };
  }

  try {
    const response = await apiClient.dashboard.getDashboardSummary(
      {
        recentEventsLimit: normalizeRecentEventsLimit(input?.recentEventsLimit),
      } as never,
      buildSessionHeaders(sid)
    );

    return {
      ok: true,
      summary: {
        activeTenants: response.activeTenants,
        pendingEndUsers: response.pendingEndUsers,
        recentEvents: (response.recentEvents ?? []).map((event) => ({
          action: event.action,
          actor: event.actor,
          at: event.at,
          eventType: event.eventType,
          target: event.target,
        })),
        suspendedTenants: response.suspendedTenants,
        totalTenants: response.totalTenants,
      },
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(
        error,
        "ダッシュボードの取得に失敗しました。時間をおいて再試行してください。"
      ),
      ok: false,
    };
  }
};
