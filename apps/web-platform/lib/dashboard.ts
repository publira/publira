import { rpcErrorMessage } from "@publira/api-client/error-messages";
import type { Locale } from "@publira/i18n";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";
import { cacheLife, cacheTag } from "next/cache";

import {
  SHARED_READ_CACHE_LIFE,
  apiClient,
  withServiceHeaders,
} from "./api-client";
import { verifyPlatformSession } from "./auth-session";
import { getPlatformLocale } from "./locale";
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
  | { ok: false; message: string };

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

const getPlatformDashboardSummaryForLocale = async (
  locale: Locale,
  recentEventsLimit: number
): Promise<GetPlatformDashboardSummaryResult> => {
  "use cache";
  cacheLife(SHARED_READ_CACHE_LIFE);
  cacheTag(platformDashboardCacheTag);

  try {
    const response = await apiClient.dashboard.getDashboardSummary(
      { recentEventsLimit } as never,
      withServiceHeaders()
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
    // A `"use cache"` scope cannot rethrow: the fill would fail the whole
    // request. The entry is dropped instead, so the dashboard comes back as
    // soon as the API does.
    dropFailedCacheEntry();
    const t = await getMessagesFor(locale);
    return {
      message: rpcErrorMessage(error, t("platform.dashboard.list_failed"), {
        locale,
      }),
      ok: false,
    };
  }
};

/**
 * The platform's tenant counts, pending end users, and recent events.
 *
 * Read with the service credential: the summary is the same for every
 * operator, so one entry serves all of them.
 */
export const getPlatformDashboardSummary = async (
  input: { recentEventsLimit?: number } = {}
): Promise<GetPlatformDashboardSummaryResult> => {
  await verifyPlatformSession();
  return getPlatformDashboardSummaryForLocale(
    await getPlatformLocale(),
    normalizeRecentEventsLimit(input.recentEventsLimit)
  );
};
