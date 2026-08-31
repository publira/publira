import { rpcErrorMessage } from "@publira/api-client/error-messages";
import { rethrowUnclassifiedRpcError } from "@publira/api-client/errors";
import { getMessage } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";

import {
  isUnauthenticatedError,
  rethrowUnauthenticatedRpcError,
} from "./admin-auth-shared";
import { apiClient, withSessionHeaders } from "./api";
import { FALLBACK_LOCALE } from "./fallback-locale";
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

const genericLoadErrorMessage = (messages: SharedMessages): string =>
  getMessage(messages, "admin.settings.site.load_failed");
const genericUpdateErrorMessage = (messages: SharedMessages): string =>
  getMessage(messages, "admin.settings.site.save_failed");

const mapErrorToMessage = (
  error: unknown,
  fallbackMessage: string,
  locale: Locale
): string => rpcErrorMessage(error, fallbackMessage, { locale });

export const getTenantSiteSettings = async (
  tenantId: string,
  locale: Locale = FALLBACK_LOCALE
): Promise<GetTenantSiteSettingsResult> => {
  "use cache: private";

  const messages = sharedCatalog(locale);
  const sessionId = await getAccessToken();
  const normalizedTenantId = tenantId.trim();
  if (!normalizedTenantId || !sessionId) {
    return {
      message: getMessage(messages, "errors.rpc.unauthenticated"),
      ok: false,
      requiresSignIn: !sessionId,
      settings: defaultSettings,
    };
  }

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
    return {
      message: mapErrorToMessage(
        error,
        genericLoadErrorMessage(messages),
        locale
      ),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
      settings: defaultSettings,
    };
  }
};

export const updateTenantSiteSettings = async (
  input: {
    tenantId: string;
    copyrightText: string;
    siteDescription: string;
    siteTagline: string;
  },
  locale: Locale = FALLBACK_LOCALE
): Promise<UpdateTenantSiteSettingsResult> => {
  const messages = sharedCatalog(locale);
  const sessionId = await getAccessToken();
  const normalizedTenantId = input.tenantId.trim();
  if (!normalizedTenantId || !sessionId) {
    return {
      message: getMessage(messages, "errors.rpc.unauthenticated"),
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
      message: mapErrorToMessage(
        error,
        genericUpdateErrorMessage(messages),
        locale
      ),
      ok: false,
    };
  }
};
