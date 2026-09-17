import { rpcErrorMessage } from "@publira/api-client/error-messages";
import { rethrowUnclassifiedRpcError } from "@publira/api-client/errors";
import type { Locale } from "@publira/i18n";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";
import { cacheTag } from "next/cache";

import {
  apiClient,
  buildSessionHeaders,
  resolveAccessToken,
} from "./api-client";
import { isUnauthenticatedError } from "./auth-shared";
import { getMessagesFor } from "./messages";

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
  | {
      ok: false;
      message: string;
      /** The API rejected the session — the page raises the login redirect. */
      requiresSignIn: boolean;
    };

const normalizeRecentEventsLimit = (value?: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 10;
  }

  return Math.max(1, Math.min(50, Math.trunc(value)));
};

/**
 * The tag the dashboard read is filed under, cleared by every write that moves
 * a tenant count, the pending end-user count, or a recent event.
 */
export const platformDashboardCacheTag = "platform:dashboard";

export const getPlatformDashboardSummary = async (input: {
  locale: Locale;
  recentEventsLimit?: number;
}): Promise<GetPlatformDashboardSummaryResult> => {
  "use cache: private";
  cacheTag(platformDashboardCacheTag);

  const sid = await resolveAccessToken();
  if (!sid) {
    dropFailedCacheEntry();
    const t = await getMessagesFor(input.locale);
    return {
      message: t("errors.rpc.unauthenticated"),
      ok: false,
      requiresSignIn: true,
    };
  }

  try {
    const response = await apiClient.dashboard.getDashboardSummary(
      {
        recentEventsLimit: normalizeRecentEventsLimit(input.recentEventsLimit),
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
    // A failed read must not be cached: the client router would replay it after
    // the API recovers, and a cached `requiresSignIn` would bounce the operator
    // back to /login even once they have signed in again.
    dropFailedCacheEntry();
    const t = await getMessagesFor(input.locale);
    return {
      message: rpcErrorMessage(error, t("platform.dashboard.list_failed"), {
        locale: input.locale,
      }),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
    };
  }
};
