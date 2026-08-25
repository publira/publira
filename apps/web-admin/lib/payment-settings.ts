import type { AdminApiClient } from "@publira/api-client/admin/client";
import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  rethrowUnclassifiedRpcError,
  rpcErrorRawMessage,
} from "@publira/api-client/errors";
import { cacheTag } from "next/cache";

import {
  isUnauthenticatedError,
  rethrowUnauthenticatedRpcError,
} from "./admin-auth-shared";
import { apiClient, withSessionHeaders } from "./api";
import { PAYMENT_PROVIDER_STRIPE } from "./payment-settings-shared";
import type { TenantPaymentSettings } from "./payment-settings-shared";
import { getAccessToken } from "./session";

export type { TenantPaymentSettings } from "./payment-settings-shared";
export {
  emptyTenantPaymentSettings,
  PAYMENT_PROVIDER_STRIPE,
  paymentSettingsStatus,
  paymentSettingsStatusCopy,
  SECRET_UPDATE_MODE_REPLACE,
  SECRET_UPDATE_MODE_UNCHANGED,
} from "./payment-settings-shared";

export interface UpdateTenantPaymentSettingsInput {
  tenantId: string;
  enabled: boolean;
  secretKeyUpdateMode: number;
  secretKey: string;
  webhookSecretUpdateMode: number;
  webhookSecret: string;
}

export type TenantPaymentSettingsResult =
  | { ok: true; settings: TenantPaymentSettings }
  | {
      ok: false;
      message: string;
      /**
       * The API rejected the session while reading the settings — the page
       * raises the login redirect. The update path throws instead, so only
       * {@link getTenantPaymentSettings} ever sets it.
       */
      requiresSignIn?: boolean;
    };

const genericLoadErrorMessage =
  "決済設定の取得に失敗しました。時間をおいて再試行してください。";
const genericUpdateErrorMessage =
  "決済設定の保存に失敗しました。時間をおいて再試行してください。";
const sessionErrorMessage = "セッションが無効です。再ログインしてください。";

/**
 * Tag the settings screen's cached read carries, so `updateTag` in the Server
 * Action makes the saved flags and hints visible in the same session instead of
 * leaving the previous public view in the private cache.
 */
export const tenantPaymentSettingsCacheTag = (tenantId: string): string =>
  `tenant:${tenantId.trim()}:payment-settings`;

/**
 * Validation and encryption-not-configured errors name what the operator must
 * fix, so those categories pass the server's own text through. Other categories
 * take the shared copy — a raw `[internal]` message is not something to show.
 */
const parseErrorMessage = (error: unknown, fallback: string): string => {
  const serverMessage = rpcErrorRawMessage(error)?.trim() || fallback;
  return rpcErrorMessage(error, fallback, {
    "invalid-argument": serverMessage,
    precondition: serverMessage,
  });
};

/**
 * The generated `TenantPaymentSettings` fields {@link toTenantPaymentSettings}
 * reads. Naming them against the message type is what makes a proto rename fail
 * here — a restated structural type keeps compiling, and a mapper that copied
 * `secretKey` by accident would keep compiling too.
 */
type RawTenantPaymentSettings = Pick<
  NonNullable<
    Awaited<
      ReturnType<AdminApiClient["paymentSettings"]["getTenantPaymentSettings"]>
    >["settings"]
  >,
  | "enabled"
  | "provider"
  | "ready"
  | "secretKeyConfigured"
  | "secretKeyHint"
  | "webhookSecretConfigured"
  | "webhookSecretHint"
>;

const toTenantPaymentSettings = (
  settings?: RawTenantPaymentSettings
): TenantPaymentSettings => ({
  enabled: Boolean(settings?.enabled),
  provider: settings?.provider?.trim() || PAYMENT_PROVIDER_STRIPE,
  ready: Boolean(settings?.ready),
  secretKeyConfigured: Boolean(settings?.secretKeyConfigured),
  secretKeyHint: settings?.secretKeyHint ?? "",
  webhookSecretConfigured: Boolean(settings?.webhookSecretConfigured),
  webhookSecretHint: settings?.webhookSecretHint ?? "",
});

export const getTenantPaymentSettings = async (
  tenantId: string
): Promise<TenantPaymentSettingsResult> => {
  "use cache: private";

  const sessionId = await getAccessToken();
  const normalizedTenantId = tenantId.trim();
  if (!normalizedTenantId || !sessionId) {
    return {
      message: sessionErrorMessage,
      ok: false,
      requiresSignIn: !sessionId,
    };
  }

  cacheTag(tenantPaymentSettingsCacheTag(normalizedTenantId));

  try {
    const response = await apiClient.paymentSettings.getTenantPaymentSettings(
      {
        tenant: { tenantId: normalizedTenantId },
      },
      withSessionHeaders(sessionId)
    );

    return {
      ok: true,
      settings: toTenantPaymentSettings(response.settings),
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      message: parseErrorMessage(error, genericLoadErrorMessage),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
    };
  }
};

export const updateTenantPaymentSettings = async (
  input: UpdateTenantPaymentSettingsInput
): Promise<TenantPaymentSettingsResult> => {
  const sessionId = await getAccessToken();
  const normalizedTenantId = input.tenantId.trim();
  if (!normalizedTenantId || !sessionId) {
    return { message: sessionErrorMessage, ok: false };
  }

  try {
    const response =
      await apiClient.paymentSettings.updateTenantPaymentSettings(
        {
          enabled: input.enabled,
          provider: PAYMENT_PROVIDER_STRIPE,
          secretKey: input.secretKey,
          secretKeyUpdateMode: input.secretKeyUpdateMode,
          tenant: { tenantId: normalizedTenantId },
          webhookSecret: input.webhookSecret,
          webhookSecretUpdateMode: input.webhookSecretUpdateMode,
        },
        withSessionHeaders(sessionId)
      );

    return {
      ok: true,
      settings: toTenantPaymentSettings(response.settings),
    };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: parseErrorMessage(error, genericUpdateErrorMessage),
      ok: false,
    };
  }
};
