import type {
  PaymentProvider as RpcPaymentProvider,
  TenantPaymentSettings as RpcTenantPaymentSettings,
} from "@publira/api-client/admin/types";
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
import type {
  PaymentProvider,
  TenantPaymentSettings,
} from "./payment-settings-shared";
import { getAccessToken } from "./session";

export type {
  PaymentCredentialField,
  PaymentCredentialFieldState,
  PaymentProvider,
  TenantPaymentSettings,
} from "./payment-settings-shared";
export {
  emptyTenantPaymentSettings,
  paymentSettingsStatus,
} from "./payment-settings-shared";

/** A change to one credential field; `value` is read only on a replace. */
export interface PaymentCredentialFieldUpdate {
  name: string;
  mode: number;
  value: string;
}

export interface UpdateTenantPaymentSettingsInput {
  tenantId: string;
  provider: string;
  enabled: boolean;
  fields: PaymentCredentialFieldUpdate[];
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

export type PaymentProvidersResult =
  | { ok: true; providers: PaymentProvider[] }
  | { ok: false; message: string; requiresSignIn?: boolean };

export type PaymentProviderResult =
  | { ok: true; provider: PaymentProvider }
  | { ok: false; message: string };

/**
 * Tag the payments screen's cached reads carry, so `updateTag` in the Server
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

type RawPaymentProvider = Pick<
  RpcPaymentProvider,
  "displayName" | "fields" | "id" | "webhookPath"
>;

type RawCredentialField = Pick<
  RpcPaymentProvider["fields"][number],
  "name" | "public" | "required" | "secret"
>;

const toTenantPaymentSettings = (
  settings?: RawTenantPaymentSettings
): TenantPaymentSettings => ({
  enabled: Boolean(settings?.enabled),
  fields: (settings?.fields ?? []).map((field: RawFieldState) => ({
    configured: Boolean(field.configured),
    hint: field.hint ?? "",
    name: field.name,
  })),
  provider: settings?.provider?.trim() ?? "",
  ready: Boolean(settings?.ready),
});

const toPaymentProvider = (provider: RawPaymentProvider): PaymentProvider => ({
  displayName: provider.displayName?.trim() || provider.id,
  fields: (provider.fields ?? []).map((field: RawCredentialField) => ({
    name: field.name,
    public: Boolean(field.public),
    required: Boolean(field.required),
    secret: Boolean(field.secret),
  })),
  id: provider.id,
  webhookPath: provider.webhookPath ?? "",
});

const requestPaymentProviders = async (
  tenantId: string,
  sessionId: string
): Promise<PaymentProvider[]> => {
  const response = await apiClient.paymentSettings.listPaymentProviders(
    { tenant: { tenantId } },
    withSessionHeaders(sessionId)
  );
  return (response.providers ?? []).map(toPaymentProvider);
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

const listPaymentProvidersForSession = async (
  tenantId: string,
  locale: Locale,
  sessionId: string
): Promise<PaymentProvidersResult> => {
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
    return {
      ok: true,
      providers: await requestPaymentProviders(normalizedTenantId, sessionId),
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

/** The providers the server registers, for the provider select. */
export const listPaymentProviders = async (
  tenantId: string,
  locale: Locale
): Promise<PaymentProvidersResult> =>
  listPaymentProvidersForSession(tenantId, locale, await getAccessToken());

/**
 * The declaration of the provider a save names, read afresh so the Action
 * checks the submitted fields against what the server registers rather than
 * against what the form claims.
 */
export const getPaymentProvider = async (
  tenantId: string,
  providerId: string,
  locale: Locale
): Promise<PaymentProviderResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  const normalizedTenantId = tenantId.trim();
  if (!normalizedTenantId || !sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    const providers = await requestPaymentProviders(
      normalizedTenantId,
      sessionId
    );
    const provider = providers.find((candidate) => candidate.id === providerId);
    return provider
      ? { ok: true, provider }
      : {
          message: t("admin.settings.payment.validation.provider_invalid"),
          ok: false,
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
          fields: input.fields,
          provider: input.provider,
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
