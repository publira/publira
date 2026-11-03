import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  rethrowUnclassifiedRpcError,
  rpcErrorDisposition,
} from "@publira/api-client/errors";
import type { Locale } from "@publira/i18n";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";
import { cacheTag } from "next/cache";

import {
  isUnauthenticatedError,
  rethrowUnauthenticatedRpcError,
} from "./admin-auth-shared";
import { apiClient, withSessionHeaders } from "./api";
import type { CachedRead } from "./cached-read";
import { settleCachedRead } from "./cached-read";
import { getMessagesFor } from "./messages";
import { getAccessToken } from "./session";

export type GetTenantEpisodeReviewSettingsResult =
  | { ok: true; episodeReviewRequired: boolean }
  | {
      ok: false;
      message: string;
      /**
       * No setting. A read that failed has no saved choice to report, and the
       * settings screen would otherwise offer to save review off over a tenant
       * that requires it.
       */
      requiresSignIn: boolean;
    };

export type UpdateTenantEpisodeReviewSettingsResult =
  | { ok: true; episodeReviewRequired: boolean }
  | { ok: false; message: string };

/**
 * Tag the screens' cached read of the setting carries, so `updateTag` in the
 * Server Action makes the saved choice visible in the same session instead of
 * leaving the previous one in the private cache.
 */
export const tenantEpisodeReviewSettingsCacheTag = (tenantId: string): string =>
  `tenant:${tenantId.trim()}:episode-review-settings`;

const getTenantEpisodeReviewSettingsForSession = async (
  tenantId: string,
  locale: Locale,
  sessionId: string
): Promise<CachedRead<GetTenantEpisodeReviewSettingsResult>> => {
  "use cache: private";

  const t = await getMessagesFor(locale);
  const normalizedTenantId = tenantId.trim();

  if (!normalizedTenantId || !sessionId) {
    dropFailedCacheEntry();

    return {
      message: t("errors.rpc.unauthenticated"),
      ok: false,
      requiresSignIn: !sessionId,
    };
  }

  cacheTag(tenantEpisodeReviewSettingsCacheTag(normalizedTenantId));

  try {
    const response =
      await apiClient.tenantSettings.getTenantEpisodeReviewSettings(
        { tenant: { tenantId: normalizedTenantId } },
        withSessionHeaders(sessionId)
      );

    return {
      episodeReviewRequired: response.episodeReviewRequired,
      ok: true,
    };
  } catch (error) {
    dropFailedCacheEntry();

    return {
      message: rpcErrorMessage(
        error,
        t("admin.settings.episode_review.load_failed"),
        { locale }
      ),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
      unexpected: rpcErrorDisposition(error) === "unexpected",
    };
  }
};

/** Whether the tenant requires a Tenant admin to approve an episode before it is published. */
export const getTenantEpisodeReviewSettings = async (
  tenantId: string,
  locale: Locale
): Promise<GetTenantEpisodeReviewSettingsResult> =>
  settleCachedRead(
    await getTenantEpisodeReviewSettingsForSession(
      tenantId,
      locale,
      await getAccessToken()
    )
  );

export const updateTenantEpisodeReviewSettings = async (
  input: { tenantId: string; episodeReviewRequired: boolean },
  locale: Locale
): Promise<UpdateTenantEpisodeReviewSettingsResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);

  const normalizedTenantId = input.tenantId.trim();

  if (!normalizedTenantId || !sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    const response =
      await apiClient.tenantSettings.updateTenantEpisodeReviewSettings(
        {
          episodeReviewRequired: input.episodeReviewRequired,
          tenant: { tenantId: normalizedTenantId },
        },
        withSessionHeaders(sessionId)
      );

    return {
      episodeReviewRequired: response.episodeReviewRequired,
      ok: true,
    };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);

    return {
      message: rpcErrorMessage(
        error,
        t("admin.settings.episode_review.save_failed"),
        { locale }
      ),
      ok: false,
    };
  }
};
