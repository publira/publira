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

/** Whether the tenant shows Author pages, and whether those include sales. */
export interface TenantCreatorPageSettings {
  creatorPagesEnabled: boolean;
  creatorPagesShowSales: boolean;
}

export type GetTenantCreatorPageSettingsResult =
  | ({ ok: true } & TenantCreatorPageSettings)
  | {
      ok: false;
      message: string;
      /**
       * No settings. A read that failed has no saved choice to report, and the
       * settings screen would otherwise offer to save both switches off over
       * whatever the tenant had turned on.
       */
      requiresSignIn: boolean;
    };

export type UpdateTenantCreatorPageSettingsResult =
  | ({ ok: true } & TenantCreatorPageSettings)
  | { ok: false; message: string };

/**
 * Tag the settings screen's cached read carries, so `updateTag` in the Server
 * Action makes the saved switches visible in the same session instead of
 * leaving the previous ones in the private cache.
 */
export const tenantCreatorPageSettingsCacheTag = (tenantId: string): string =>
  `tenant:${tenantId.trim()}:creator-page-settings`;

const getTenantCreatorPageSettingsForSession = async (
  tenantId: string,
  locale: Locale,
  sessionId: string
): Promise<CachedRead<GetTenantCreatorPageSettingsResult>> => {
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

  cacheTag(tenantCreatorPageSettingsCacheTag(normalizedTenantId));

  try {
    const response =
      await apiClient.tenantSettings.getTenantCreatorPageSettings(
        { tenant: { tenantId: normalizedTenantId } },
        withSessionHeaders(sessionId)
      );

    return {
      creatorPagesEnabled: response.creatorPagesEnabled,
      creatorPagesShowSales: response.creatorPagesShowSales,
      ok: true,
    };
  } catch (error) {
    dropFailedCacheEntry();

    return {
      message: rpcErrorMessage(
        error,
        t("admin.settings.creator_pages.load_failed"),
        { locale }
      ),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
      unexpected: rpcErrorDisposition(error) === "unexpected",
    };
  }
};

export const getTenantCreatorPageSettings = async (
  tenantId: string,
  locale: Locale
): Promise<GetTenantCreatorPageSettingsResult> =>
  settleCachedRead(
    await getTenantCreatorPageSettingsForSession(
      tenantId,
      locale,
      await getAccessToken()
    )
  );

export const updateTenantCreatorPageSettings = async (
  input: {
    tenantId: string;
  } & TenantCreatorPageSettings,
  locale: Locale
): Promise<UpdateTenantCreatorPageSettingsResult> => {
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
      await apiClient.tenantSettings.updateTenantCreatorPageSettings(
        {
          creatorPagesEnabled: input.creatorPagesEnabled,
          creatorPagesShowSales: input.creatorPagesShowSales,
          tenant: { tenantId: normalizedTenantId },
        },
        withSessionHeaders(sessionId)
      );

    return {
      creatorPagesEnabled: response.creatorPagesEnabled,
      creatorPagesShowSales: response.creatorPagesShowSales,
      ok: true,
    };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);

    return {
      message: rpcErrorMessage(
        error,
        t("admin.settings.creator_pages.save_failed"),
        { locale }
      ),
      ok: false,
    };
  }
};
