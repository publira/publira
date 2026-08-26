import { rpcErrorMessage } from "@publira/api-client/error-messages";
import { rethrowUnclassifiedRpcError } from "@publira/api-client/errors";
import { getMessage } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";

import {
  apiClient,
  buildSessionHeaders,
  resolveAccessToken,
} from "./api-client";
import { isUnauthenticatedError } from "./auth-shared";
import { loadPlatformMessages } from "./locale";

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

export const getPlatformDashboardSummary = async (input: {
  locale: Locale;
  recentEventsLimit?: number;
}): Promise<GetPlatformDashboardSummaryResult> => {
  "use cache: private";

  const sid = await resolveAccessToken();
  if (!sid) {
    dropFailedCacheEntry();
    const messages = await loadPlatformMessages(input.locale);
    return {
      message: getMessage(messages, "errors.rpc.unauthenticated"),
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
    const messages = await loadPlatformMessages(input.locale);
    return {
      message: rpcErrorMessage(
        error,
        getMessage(messages, "platform.dashboard.list_failed"),
        { locale: input.locale }
      ),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
    };
  }
};
