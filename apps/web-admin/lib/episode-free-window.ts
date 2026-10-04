import type { AdminEpisodeFreeWindow } from "@publira/api-client/admin/types";
import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  rethrowUnclassifiedRpcError,
  rpcErrorHasFieldViolation,
} from "@publira/api-client/errors";
import { forEachPageWithToken } from "@publira/api-client/pagination";
import type { Locale } from "@publira/i18n";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";
import { cacheTag } from "next/cache";

import { rethrowUnauthenticatedRpcError } from "./admin-auth-shared";
import { verifyAdminPageSession } from "./admin-page-session";
import { apiClient, withServiceHeaders, withSessionHeaders } from "./api";
import { episodesCacheTag } from "./episode";
import { getMessagesFor } from "./messages";
import { getAccessToken } from "./session";

/** A scheduled period during which one episode reads as free to everyone. */
export interface EpisodeFreeWindowItem {
  id: string;
  episodeId: string;
  episodePublicId: string;
  episodeTitle: string;
  /** RFC 3339. The window covers `startsAt` up to but not including `endsAt`. */
  startsAt: string;
  endsAt: string;
}

export type ListEpisodeFreeWindowsResult =
  | { ok: true; freeWindows: EpisodeFreeWindowItem[] }
  | { ok: false; message: string };

export type CreateEpisodeFreeWindowResult =
  | { ok: true; freeWindow: EpisodeFreeWindowItem }
  | { ok: false; message: string };

export type CreateSeriesFreeWindowsResult =
  | { ok: true; freeWindows: EpisodeFreeWindowItem[] }
  | { ok: false; message: string };

export type DeleteEpisodeFreeWindowResult =
  | { ok: true }
  | { ok: false; message: string };

/**
 * The tag every free window read is filed under. Every Action that schedules
 * or removes a window clears it, so the episode screens show the change.
 */
export const episodeFreeWindowsCacheTag = (tenantId: string): string =>
  `episode-free-windows-${tenantId}`;

/** The generated fields {@link mapFreeWindow} reads (see `series.ts`). */
type RawEpisodeFreeWindow = Pick<
  AdminEpisodeFreeWindow,
  | "endsAt"
  | "episodeId"
  | "episodePublicId"
  | "episodeTitle"
  | "id"
  | "startsAt"
>;

const mapFreeWindow = (
  window: RawEpisodeFreeWindow
): EpisodeFreeWindowItem => ({
  endsAt: window.endsAt,
  episodeId: window.episodeId,
  episodePublicId: window.episodePublicId,
  episodeTitle: window.episodeTitle,
  id: window.id,
  startsAt: window.startsAt,
});

/**
 * The wording for a rejected schedule. A failed precondition is the overlap
 * the database refuses, which is the one an editor can fix by choosing another
 * period; the field violations name what the server found wrong in the input.
 */
const mapCreateErrorToMessage = async (
  error: unknown,
  fallback: string,
  locale: Locale
): Promise<string> => {
  const t = await getMessagesFor(locale);
  if (
    rpcErrorHasFieldViolation(error, "starts_at") ||
    rpcErrorHasFieldViolation(error, "ends_at")
  ) {
    return t("admin.series.episodes.free_windows.validation.period_invalid");
  }
  if (rpcErrorHasFieldViolation(error, "episode_ids")) {
    return t("admin.series.episodes.free_windows.episodes_changed");
  }

  return rpcErrorMessage(error, fallback, {
    locale,
    overrides: {
      "not-found": t("admin.series.episodes.series_not_found"),
      precondition: t("admin.series.episodes.free_windows.overlap"),
    },
  });
};

const listEpisodeFreeWindowsForTenant = async (
  input: { episodeId: string; tenantId: string },
  locale: Locale
): Promise<ListEpisodeFreeWindowsResult> => {
  "use cache";
  cacheTag(episodeFreeWindowsCacheTag(input.tenantId));
  // The rows carry the episode's title, which an episode write can change.
  cacheTag(episodesCacheTag(input.tenantId));

  const t = await getMessagesFor(locale);
  try {
    const freeWindows: EpisodeFreeWindowItem[] = [];
    const walkStop = await forEachPageWithToken(
      async (token, limit) => {
        const response = await apiClient.series.listEpisodeFreeWindows(
          {
            limit,
            scope: { case: "episodeId", value: input.episodeId },
            tenant: { tenantId: input.tenantId },
            token,
          },
          withServiceHeaders()
        );
        return {
          items: response.freeWindows ?? [],
          nextToken: response.nextToken ?? "",
        };
      },
      (items) => {
        for (const item of items) {
          freeWindows.push(mapFreeWindow(item));
        }
      }
    );

    // A partial list would hide a window the editor came here to remove.
    if (walkStop !== "completed") {
      dropFailedCacheEntry();
      return {
        message: t("admin.series.episodes.free_windows.list_failed"),
        ok: false,
      };
    }

    return { freeWindows, ok: true };
  } catch (error) {
    // A `"use cache"` scope cannot rethrow: the fill would fail the whole
    // request. The entry is dropped instead, so the answer comes back as soon
    // as the API does.
    dropFailedCacheEntry();
    return {
      message: rpcErrorMessage(
        error,
        t("admin.series.episodes.free_windows.list_failed"),
        { locale }
      ),
      ok: false,
    };
  }
};

/**
 * Every free window scheduled on one episode, latest start first, the ones
 * already over included until someone deletes them.
 *
 * Read with the service credential: the list is the same for every operator
 * of the tenant, so one entry serves all of them.
 */
export const listEpisodeFreeWindows = async (input: {
  episodeId: string;
}): Promise<ListEpisodeFreeWindowsResult> => {
  const { locale, tenantId } = await verifyAdminPageSession();
  return listEpisodeFreeWindowsForTenant({ ...input, tenantId }, locale);
};

export const createEpisodeFreeWindow = async (
  input: {
    tenantId: string;
    episodeId: string;
    startsAt: string;
    endsAt: string;
  },
  locale: Locale
): Promise<CreateEpisodeFreeWindowResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  if (!sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    const response = await apiClient.series.createEpisodeFreeWindow(
      {
        endsAt: input.endsAt,
        episodeId: input.episodeId,
        startsAt: input.startsAt,
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );
    if (!response.freeWindow) {
      return {
        message: t("admin.series.episodes.free_windows.create_failed"),
        ok: false,
      };
    }

    return { freeWindow: mapFreeWindow(response.freeWindow), ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: await mapCreateErrorToMessage(
        error,
        t("admin.series.episodes.free_windows.create_failed"),
        locale
      ),
      ok: false,
    };
  }
};

/**
 * Schedules one period on several episodes of a series in one all-or-nothing
 * call. No `episodeIds` schedules every episode of the series.
 */
export const createSeriesFreeWindows = async (
  input: {
    tenantId: string;
    seriesId: string;
    episodeIds?: readonly string[];
    startsAt: string;
    endsAt: string;
  },
  locale: Locale
): Promise<CreateSeriesFreeWindowsResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  if (!sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    const response = await apiClient.series.createSeriesFreeWindows(
      {
        endsAt: input.endsAt,
        episodeIds: [...(input.episodeIds ?? [])],
        seriesId: input.seriesId,
        startsAt: input.startsAt,
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );

    return {
      freeWindows: (response.freeWindows ?? []).map((window) =>
        mapFreeWindow(window)
      ),
      ok: true,
    };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: await mapCreateErrorToMessage(
        error,
        t("admin.series.episodes.free_windows.bulk_failed"),
        locale
      ),
      ok: false,
    };
  }
};

export const deleteEpisodeFreeWindow = async (
  input: { tenantId: string; freeWindowId: string },
  locale: Locale
): Promise<DeleteEpisodeFreeWindowResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  if (!sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    await apiClient.series.deleteEpisodeFreeWindow(
      {
        freeWindowId: input.freeWindowId,
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );
    return { ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(
        error,
        t("admin.series.episodes.free_windows.delete_failed"),
        {
          locale,
          overrides: {
            "not-found": t(
              "admin.series.episodes.free_windows.already_deleted"
            ),
          },
        }
      ),
      ok: false,
    };
  }
};
