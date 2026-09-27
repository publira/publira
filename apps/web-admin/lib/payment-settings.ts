import type { TenantPaymentSettings as RpcTenantPaymentSettings } from "@publira/api-client/admin/types";
import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  rethrowUnclassifiedRpcError,
  rpcErrorRawMessage,
} from "@publira/api-client/errors";
import type { Locale } from "@publira/i18n";
import { cacheTag } from "next/cache";

import {
  isUnauthenticatedError,
  rethrowUnauthenticatedRpcError,
} from "./admin-auth-shared";
import { apiClient, withSessionHeaders } from "./api";
import { getMessagesFor } from "./messages";
import {
  PAYMENT_PROVIDER_STRIPE,
  STRIPE_FIELD_SECRET_KEY,
  STRIPE_FIELD_WEBHOOK_SECRET,
} from "./payment-settings-shared";
import type { TenantPaymentSettings } from "./payment-settings-shared";
import { getAccessToken } from "./session";

export type { TenantPaymentSettings } from "./payment-settings-shared";
export {
  emptyTenantPaymentSettings,
  PAYMENT_PROVIDER_STRIPE,
  paymentSettingsStatus,
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

/**
 * Tag the payments screen's cached read carries, so `updateTag` in the Server
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
const parseErrorMessage = (
  error: unknown,
  fallback: string,
  locale: Locale
): string => {
  const serverMessage = rpcErrorRawMessage(error)?.trim() || fallback;
  return rpcErrorMessage(error, fallback, {
    locale,
    overrides: {
      "invalid-argument": serverMessage,
      precondition: serverMessage,
    },
  });
};

/**
 * The generated `TenantPaymentSettings` fields {@link toTenantPaymentSettings}
 * reads. Naming them against the message type is what makes a proto rename fail
 * here — a restated structural type keeps compiling, and a mapper that copied
 * a value by accident would keep compiling too.
 */
type RawTenantPaymentSettings = Pick<
  RpcTenantPaymentSettings,
  "enabled" | "fields" | "provider" | "ready"
>;

type RawFieldState = Pick<
  RpcTenantPaymentSettings["fields"][number],
  "configured" | "hint" | "name"
>;

const findField = (
  fields: readonly RawFieldState[] | undefined,
  name: string
): RawFieldState | undefined => fields?.find((field) => field.name === name);

const toTenantPaymentSettings = (
  settings?: RawTenantPaymentSettings
): TenantPaymentSettings => {
  const secretKey = findField(settings?.fields, STRIPE_FIELD_SECRET_KEY);
  const webhookSecret = findField(
    settings?.fields,
    STRIPE_FIELD_WEBHOOK_SECRET
  );
  return {
    enabled: Boolean(settings?.enabled),
    provider: settings?.provider?.trim() || PAYMENT_PROVIDER_STRIPE,
    ready: Boolean(settings?.ready),
    secretKeyConfigured: Boolean(secretKey?.configured),
    secretKeyHint: secretKey?.hint ?? "",
    webhookSecretConfigured: Boolean(webhookSecret?.configured),
    webhookSecretHint: webhookSecret?.hint ?? "",
  };
};

const getTenantPaymentSettingsForSession = async (
  tenantId: string,
  locale: Locale,
  sessionId: string
): Promise<TenantPaymentSettingsResult> => {
  "use cache: private";

  const t = await getMessagesFor(locale);
  const normalizedTenantId = tenantId.trim();
  if (!normalizedTenantId || !sessionId) {
    return {
      message: t("errors.rpc.unauthenticated"),
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
      message: parseErrorMessage(
        error,
        t("admin.settings.payment.load_failed"),
        locale
      ),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
    };
  }
};

export const getTenantPaymentSettings = async (
  tenantId: string,
  locale: Locale
): Promise<TenantPaymentSettingsResult> =>
  getTenantPaymentSettingsForSession(tenantId, locale, await getAccessToken());

export const updateTenantPaymentSettings = async (
  input: UpdateTenantPaymentSettingsInput,
  locale: Locale
): Promise<TenantPaymentSettingsResult> => {
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
      await apiClient.paymentSettings.updateTenantPaymentSettings(
        {
          enabled: input.enabled,
          fields: [
            {
              mode: input.secretKeyUpdateMode,
              name: STRIPE_FIELD_SECRET_KEY,
              value: input.secretKey,
            },
            {
              mode: input.webhookSecretUpdateMode,
              name: STRIPE_FIELD_WEBHOOK_SECRET,
              value: input.webhookSecret,
            },
          ],
          provider: PAYMENT_PROVIDER_STRIPE,
          tenant: { tenantId: normalizedTenantId },
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
      message: parseErrorMessage(
        error,
        t("admin.settings.payment.save_failed"),
        locale
      ),
      ok: false,
    };
  }
};
