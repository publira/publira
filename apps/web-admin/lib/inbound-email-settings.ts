import type {
  InboundEmailProvider as RpcInboundEmailProvider,
  TenantInboundEmailSettings as RpcTenantInboundEmailSettings,
} from "@publira/api-client/admin/types";
import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  rethrowUnclassifiedRpcError,
  rpcErrorDisposition,
  rpcErrorHasFieldViolation,
  rpcErrorRawMessage,
} from "@publira/api-client/errors";
import type { Locale } from "@publira/i18n";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";
import { cacheTag } from "next/cache";

import {
  isUnauthenticatedError,
  rethrowUnauthenticatedRpcError,
} from "./admin-auth-shared";
import { apiClient, withSessionHeaders } from "./api";
import type {
  InboundEmailProvider,
  TenantInboundEmailSettings,
} from "./inbound-email-settings-shared";
import { getMessagesFor } from "./messages";
import type { ProviderCredentialUpdate } from "./provider-credential-form";
import { getAccessToken } from "./session";

export type {
  InboundEmailCredentialField,
  InboundEmailCredentialFieldState,
  InboundEmailProvider,
  TenantInboundEmailSettings,
} from "./inbound-email-settings-shared";
export {
  emptyTenantInboundEmailSettings,
  inboundEmailSettingsStatus,
  inboundReplyAddressPattern,
} from "./inbound-email-settings-shared";

export interface UpdateTenantInboundEmailSettingsInput {
  tenantId: string;
  provider: string;
  enabled: boolean;
  domain: string;
  fields: ProviderCredentialUpdate[];
}

export type TenantInboundEmailSettingsResult =
  | { ok: true; settings: TenantInboundEmailSettings }
  | {
      ok: false;
      message: string;
      /**
       * The API rejected the session while reading the settings — the page
       * raises the login redirect. The update path throws instead, so only
       * {@link getTenantInboundEmailSettings} ever sets it.
       */
      requiresSignIn?: boolean;
    };

export type UpdateTenantInboundEmailSettingsResult =
  | { ok: true; settings: TenantInboundEmailSettings }
  | {
      ok: false;
      message: string;
      /** Set when the server refused the domain as not a domain name. */
      domainInvalid?: boolean;
    };

export type InboundEmailProvidersResult =
  | { ok: true; providers: InboundEmailProvider[] }
  | { ok: false; message: string; requiresSignIn?: boolean };

export type InboundEmailProviderResult =
  | { ok: true; provider: InboundEmailProvider }
  | { ok: false; message: string };

/**
 * Tag the email screen's inbound email reads carry, so `updateTag` in the
 * Server Action makes the saved domain and hints visible in the same session
 * instead of leaving the previous public view in the private cache.
 */
export const tenantInboundEmailSettingsCacheTag = (tenantId: string): string =>
  `tenant:${tenantId.trim()}:inbound-email-settings`;

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
 * The generated `TenantInboundEmailSettings` fields
 * {@link toTenantInboundEmailSettings} reads. Naming them against the message
 * type is what makes a proto rename fail here — a restated structural type
 * keeps compiling, and the mapper silently substitutes an empty string for the
 * field it can no longer find.
 */
type RawTenantInboundEmailSettings = Pick<
  RpcTenantInboundEmailSettings,
  "domain" | "enabled" | "fields" | "provider" | "ready"
>;

type RawFieldState = Pick<
  RpcTenantInboundEmailSettings["fields"][number],
  "configured" | "hint" | "name"
>;

type RawInboundEmailProvider = Pick<
  RpcInboundEmailProvider,
  "displayName" | "fields" | "id" | "webhookPath"
>;

type RawCredentialField = Pick<
  RpcInboundEmailProvider["fields"][number],
  "name" | "required" | "secret"
>;

const toTenantInboundEmailSettings = (
  settings?: RawTenantInboundEmailSettings
): TenantInboundEmailSettings => ({
  domain: settings?.domain?.trim() ?? "",
  enabled: Boolean(settings?.enabled),
  fields: (settings?.fields ?? []).map((field: RawFieldState) => ({
    configured: Boolean(field.configured),
    hint: field.hint ?? "",
    name: field.name,
  })),
  provider: settings?.provider?.trim() ?? "",
  ready: Boolean(settings?.ready),
});

const toInboundEmailProvider = (
  provider: RawInboundEmailProvider
): InboundEmailProvider => ({
  displayName: provider.displayName?.trim() || provider.id,
  fields: (provider.fields ?? []).map((field: RawCredentialField) => ({
    name: field.name,
    required: Boolean(field.required),
    secret: Boolean(field.secret),
  })),
  id: provider.id,
  webhookPath: provider.webhookPath ?? "",
});

const requestInboundEmailProviders = async (
  tenantId: string,
  sessionId: string
): Promise<InboundEmailProvider[]> => {
  const response =
    await apiClient.inboundEmailSettings.listInboundEmailProviders(
      { tenant: { tenantId } },
      withSessionHeaders(sessionId)
    );
  return (response.providers ?? []).map(toInboundEmailProvider);
};

/**
 * What a cached read hands its exported caller: the result, and whether its
 * failure is one no screen copy describes. A `"use cache"` scope must not
 * throw — the fill would fail the whole request — and an error that crosses
 * its boundary loses its `Code`, so the scope classifies the failure and the
 * caller, outside it, throws the unexpected ones.
 */
type CachedRead<TResult> = TResult & { unexpected?: boolean };

/** The result of a cached read, thrown when its failure was unexpected. */
const settleCachedRead = <
  TResult extends { ok: true } | { ok: false; message: string },
>({
  unexpected,
  ...result
}: CachedRead<TResult>): TResult => {
  const settled = result as TResult;
  if (unexpected && !settled.ok) {
    throw new Error(settled.message);
  }
  return settled;
};

const getTenantInboundEmailSettingsForSession = async (
  tenantId: string,
  locale: Locale,
  sessionId: string
): Promise<CachedRead<TenantInboundEmailSettingsResult>> => {
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

  cacheTag(tenantInboundEmailSettingsCacheTag(normalizedTenantId));

  try {
    const response =
      await apiClient.inboundEmailSettings.getTenantInboundEmailSettings(
        { tenant: { tenantId: normalizedTenantId } },
        withSessionHeaders(sessionId)
      );

    return {
      ok: true,
      settings: toTenantInboundEmailSettings(response.settings),
    };
  } catch (error) {
    dropFailedCacheEntry();
    return {
      message: parseErrorMessage(
        error,
        t("admin.settings.inbound_email.load_failed"),
        locale
      ),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
      unexpected: rpcErrorDisposition(error) === "unexpected",
    };
  }
};

export const getTenantInboundEmailSettings = async (
  tenantId: string,
  locale: Locale
): Promise<TenantInboundEmailSettingsResult> =>
  settleCachedRead(
    await getTenantInboundEmailSettingsForSession(
      tenantId,
      locale,
      await getAccessToken()
    )
  );

const listInboundEmailProvidersForSession = async (
  tenantId: string,
  locale: Locale,
  sessionId: string
): Promise<CachedRead<InboundEmailProvidersResult>> => {
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

  cacheTag(tenantInboundEmailSettingsCacheTag(normalizedTenantId));

  try {
    return {
      ok: true,
      providers: await requestInboundEmailProviders(
        normalizedTenantId,
        sessionId
      ),
    };
  } catch (error) {
    dropFailedCacheEntry();
    return {
      message: parseErrorMessage(
        error,
        t("admin.settings.inbound_email.load_failed"),
        locale
      ),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
      unexpected: rpcErrorDisposition(error) === "unexpected",
    };
  }
};

/** The providers the server registers, for the provider select. */
export const listInboundEmailProviders = async (
  tenantId: string,
  locale: Locale
): Promise<InboundEmailProvidersResult> =>
  settleCachedRead(
    await listInboundEmailProvidersForSession(
      tenantId,
      locale,
      await getAccessToken()
    )
  );

/**
 * The declaration of the provider a save names, read afresh so the Action
 * checks the submitted fields against what the server registers rather than
 * against what the form claims.
 */
export const getInboundEmailProvider = async (
  tenantId: string,
  providerId: string,
  locale: Locale
): Promise<InboundEmailProviderResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  const normalizedTenantId = tenantId.trim();
  if (!normalizedTenantId || !sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    const providers = await requestInboundEmailProviders(
      normalizedTenantId,
      sessionId
    );
    const provider = providers.find((candidate) => candidate.id === providerId);
    return provider
      ? { ok: true, provider }
      : {
          message: t(
            "admin.settings.inbound_email.validation.provider_invalid"
          ),
          ok: false,
        };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: parseErrorMessage(
        error,
        t("admin.settings.inbound_email.save_failed"),
        locale
      ),
      ok: false,
    };
  }
};

export const updateTenantInboundEmailSettings = async (
  input: UpdateTenantInboundEmailSettingsInput,
  locale: Locale
): Promise<UpdateTenantInboundEmailSettingsResult> => {
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
      await apiClient.inboundEmailSettings.updateTenantInboundEmailSettings(
        {
          domain: input.domain,
          enabled: input.enabled,
          fields: input.fields,
          provider: input.provider,
          tenant: { tenantId: normalizedTenantId },
        },
        withSessionHeaders(sessionId)
      );

    return {
      ok: true,
      settings: toTenantInboundEmailSettings(response.settings),
    };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    if (
      rpcErrorDisposition(error) === "invalid-argument" &&
      rpcErrorHasFieldViolation(error, "domain")
    ) {
      return {
        domainInvalid: true,
        message: t("errors.validation"),
        ok: false,
      };
    }
    return {
      message: parseErrorMessage(
        error,
        t("admin.settings.inbound_email.save_failed"),
        locale
      ),
      ok: false,
    };
  }
};
