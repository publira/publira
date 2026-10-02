import { rpcErrorMessage } from "@publira/api-client/error-messages";
import { rethrowUnclassifiedRpcError } from "@publira/api-client/errors";
import type { Locale } from "@publira/i18n";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";
import { cacheTag } from "next/cache";

import {
  isUnauthenticatedError,
  rethrowUnauthenticatedRpcError,
} from "./admin-auth-shared";
import { apiClient, withSessionHeaders } from "./api";
import { getMessagesFor } from "./messages";
import { getAccessToken } from "./session";

export interface TenantSiteSettings {
  copyrightText: string;
  siteDescription: string;
  siteTagline: string;
}

export type GetTenantSiteSettingsResult =
  | { ok: true; settings: TenantSiteSettings }
  | {
      ok: false;
      message: string;
      settings: TenantSiteSettings;
      /** The API rejected the session — the page raises the login redirect. */
      requiresSignIn: boolean;
    };

export type UpdateTenantSiteSettingsResult =
  | { ok: true; settings: TenantSiteSettings }
  | { ok: false; message: string };

const defaultSettings: TenantSiteSettings = {
  copyrightText: "",
  siteDescription: "",
  siteTagline: "",
};

/**
 * Tag the settings screen's cached read carries, so `updateTag` in the Server
 * Action makes the saved copy visible in the same session instead of leaving
 * the previous text in the private cache. Distinct from `tenant:<id>:site`,
 * which carries the public read of the tenant's name, theme, and default
 * locale — none of which this screen writes.
 */
export const tenantSiteSettingsCacheTag = (tenantId: string): string =>
  `tenant:${tenantId.trim()}:site-settings`;

const mapErrorToMessage = (
  error: unknown,
  fallbackMessage: string,
  locale: Locale
): string => rpcErrorMessage(error, fallbackMessage, { locale });

const getTenantSiteSettingsForSession = async (
  tenantId: string,
  locale: Locale,
  sessionId: string
): Promise<GetTenantSiteSettingsResult> => {
  "use cache: private";

  const t = await getMessagesFor(locale);
  const normalizedTenantId = tenantId.trim();
  if (!normalizedTenantId || !sessionId) {
    dropFailedCacheEntry();
    return {
      message: t("errors.rpc.unauthenticated"),
      ok: false,
      requiresSignIn: !sessionId,
      settings: defaultSettings,
    };
  }

  cacheTag(tenantSiteSettingsCacheTag(normalizedTenantId));

  try {
    const response = await apiClient.auth.getTenantConfig(
      {
        tenant: { tenantId: normalizedTenantId },
      },
      withSessionHeaders(sessionId)
    );

    return {
      ok: true,
      settings: {
        copyrightText: response.copyrightText ?? "",
        siteDescription: response.siteDescription ?? "",
        siteTagline: response.siteTagline ?? "",
      },
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    dropFailedCacheEntry();
    return {
      message: await mapErrorToMessage(
        error,
        t("admin.settings.site.load_failed"),
        locale
      ),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
      settings: defaultSettings,
    };
  }
};

/**
 * The site copy the settings form opens on, read through the admin API with
 * the operator's session.
 *
 * Not through the public `GetTenant`, although it answers the same three
 * fields: that RPC answers empty copy when the config row cannot be read, so the
 * storefront keeps rendering, and a form opened on that answer would save the
 * blanks over the copy the tenant has. `GetTenantConfig` reports the failure.
 */
export const getTenantSiteSettings = async (
  tenantId: string,
  locale: Locale
): Promise<GetTenantSiteSettingsResult> =>
  getTenantSiteSettingsForSession(tenantId, locale, await getAccessToken());

export const updateTenantSiteSettings = async (
  input: {
    tenantId: string;
    copyrightText: string;
    siteDescription: string;
    siteTagline: string;
  },
  locale: Locale
): Promise<UpdateTenantSiteSettingsResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  const normalizedTenantId = input.tenantId.trim();
  if (!normalizedTenantId || !sessionId) {
    return {
      message: t("errors.rpc.unauthenticated"),
      ok: false,
    };
  }

  try {
    const response = await apiClient.auth.updateTenantConfig(
      {
        copyrightText: input.copyrightText,
        siteDescription: input.siteDescription,
        siteTagline: input.siteTagline,
        tenant: { tenantId: normalizedTenantId },
      },
      withSessionHeaders(sessionId)
    );

    return {
      ok: true,
      settings: {
        copyrightText: response.copyrightText ?? "",
        siteDescription: response.siteDescription ?? "",
        siteTagline: response.siteTagline ?? "",
      },
    };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: await mapErrorToMessage(
        error,
        t("admin.settings.site.save_failed"),
        locale
      ),
      ok: false,
    };
  }
};
