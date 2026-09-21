import type { TenantFcmSettings as RpcTenantFcmSettings } from "@publira/api-client/admin/types";
import { rpcErrorMessage } from "@publira/api-client/error-messages";
import { rethrowUnclassifiedRpcError } from "@publira/api-client/errors";
import type { Locale } from "@publira/i18n";
import { cacheTag } from "next/cache";

import {
  isUnauthenticatedError,
  rethrowUnauthenticatedRpcError,
} from "./admin-auth-shared";
import { apiClient, withSessionHeaders } from "./api";
import { getMessagesFor } from "./messages";
import { getAccessToken } from "./session";

/** What the console shows of the stored credentials; never the key itself. */
export interface TenantFcmSettings {
  configured: boolean;
  projectId: string;
  clientEmail: string;
  /** RFC 3339, empty while nothing is stored. */
  updatedAt: string;
}

export type TenantFcmSettingsResult =
  | { ok: true; settings: TenantFcmSettings }
  | { ok: false; message: string; requiresSignIn?: boolean };

export const emptyTenantFcmSettings: TenantFcmSettings = {
  clientEmail: "",
  configured: false,
  projectId: "",
  updatedAt: "",
};

export const tenantFcmSettingsCacheTag = (tenantId: string): string =>
  `tenant:${tenantId.trim()}:fcm-settings`;

/**
 * The generated fields {@link toTenantFcmSettings} reads, named against the
 * message type so a proto rename fails here.
 */
type RawTenantFcmSettings = Pick<
  RpcTenantFcmSettings,
  "clientEmail" | "configured" | "projectId" | "updatedAt"
>;

const toTenantFcmSettings = (
  settings?: RawTenantFcmSettings
): TenantFcmSettings =>
  settings?.configured
    ? {
        clientEmail: settings.clientEmail,
        configured: true,
        projectId: settings.projectId,
        updatedAt: settings.updatedAt,
      }
    : emptyTenantFcmSettings;

export const getTenantFcmSettings = async (
  tenantId: string,
  locale: Locale
): Promise<TenantFcmSettingsResult> => {
  "use cache: private";

  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  const normalizedTenantId = tenantId.trim();
  if (!normalizedTenantId || !sessionId) {
    return {
      message: t("errors.rpc.unauthenticated"),
      ok: false,
      requiresSignIn: !sessionId,
    };
  }

  cacheTag(tenantFcmSettingsCacheTag(normalizedTenantId));

  try {
    const response = await apiClient.fcmSettings.getTenantFcmSettings(
      { tenant: { tenantId: normalizedTenantId } },
      withSessionHeaders(sessionId)
    );
    return { ok: true, settings: toTenantFcmSettings(response.settings) };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(
        error,
        t("admin.settings.mobile_push.load_failed"),
        { locale }
      ),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
    };
  }
};

export interface SaveTenantFcmCredentialsInput {
  tenantId: string;
  projectId: string;
  serviceAccountJson: string;
}

/**
 * The server's refusal names the field at fault in English, so a refusal is
 * answered with the console's own copy instead: the form has already checked
 * everything it can, and what is left is a key the server could not use.
 */
export const saveTenantFcmCredentials = async (
  input: SaveTenantFcmCredentialsInput,
  locale: Locale
): Promise<TenantFcmSettingsResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  const normalizedTenantId = input.tenantId.trim();
  if (!normalizedTenantId || !sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    const response = await apiClient.fcmSettings.saveTenantFcmCredentials(
      {
        projectId: input.projectId,
        serviceAccountJson: input.serviceAccountJson,
        tenant: { tenantId: normalizedTenantId },
      },
      withSessionHeaders(sessionId)
    );
    return { ok: true, settings: toTenantFcmSettings(response.settings) };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(
        error,
        t("admin.settings.mobile_push.save_failed"),
        {
          locale,
          overrides: {
            "invalid-argument": t(
              "admin.settings.mobile_push.validation.key_invalid"
            ),
            precondition: t(
              "admin.settings.mobile_push.encryption_unavailable"
            ),
          },
        }
      ),
      ok: false,
    };
  }
};

export const deleteTenantFcmCredentials = async (
  tenantId: string,
  locale: Locale
): Promise<TenantFcmSettingsResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  const normalizedTenantId = tenantId.trim();
  if (!normalizedTenantId || !sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    const response = await apiClient.fcmSettings.deleteTenantFcmCredentials(
      { tenant: { tenantId: normalizedTenantId } },
      withSessionHeaders(sessionId)
    );
    return { ok: true, settings: toTenantFcmSettings(response.settings) };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(
        error,
        t("admin.settings.mobile_push.delete_failed"),
        { locale }
      ),
      ok: false,
    };
  }
};
