import type {
  TenantAppleSignInSettings as RpcTenantAppleSignInSettings,
  TenantGoogleSignInSettings as RpcTenantGoogleSignInSettings,
} from "@publira/api-client/admin/types";
import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  rethrowUnclassifiedRpcError,
  rpcErrorHasFieldViolation,
} from "@publira/api-client/errors";
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

export interface TenantAppleSignInSettings {
  enabled: boolean;
  servicesId: string;
  teamId: string;
  keyId: string;
  privateKeyConfigured: boolean;
  privateKeyHint: string;
  /** Edited with the app links, not here. Empty where none is named. */
  bundleIdentifier: string;
  ready: boolean;
}

export interface TenantGoogleSignInSettings {
  enabled: boolean;
  webClientId: string;
  iosClientId: string;
  ready: boolean;
}

export interface TenantSignInSettings {
  apple: TenantAppleSignInSettings;
  google: TenantGoogleSignInSettings;
}

export interface SignInKeyUpdate {
  /** A `SecretUpdateMode` value. */
  mode: number;
  value: string;
}

export interface UpdateTenantSignInSettingsInput {
  tenantId: string;
  apple: {
    enabled: boolean;
    servicesId: string;
    teamId: string;
    keyId: string;
    privateKey: SignInKeyUpdate;
  };
  google: {
    enabled: boolean;
    webClientId: string;
    iosClientId: string;
  };
}

export type SignInSettingsField =
  | "iosClientId"
  | "keyId"
  | "privateKey"
  | "servicesId"
  | "teamId"
  | "webClientId";

export type SignInSettingsFieldErrors = Partial<
  Record<SignInSettingsField, string>
>;

export type TenantSignInSettingsResult =
  | { ok: true; settings: TenantSignInSettings }
  | {
      ok: false;
      message: string;
      fieldErrors?: SignInSettingsFieldErrors;
      /** Set by the read only; the update path throws instead. */
      requiresSignIn?: boolean;
    };

export const tenantSignInSettingsCacheTag = (tenantId: string): string =>
  `tenant:${tenantId.trim()}:sign-in-settings`;

type RawApple = Pick<
  RpcTenantAppleSignInSettings,
  | "bundleIdentifier"
  | "enabled"
  | "keyId"
  | "privateKeyConfigured"
  | "privateKeyHint"
  | "ready"
  | "servicesId"
  | "teamId"
>;

type RawGoogle = Pick<
  RpcTenantGoogleSignInSettings,
  "enabled" | "iosClientId" | "ready" | "webClientId"
>;

const toApple = (apple?: RawApple): TenantAppleSignInSettings => ({
  bundleIdentifier: apple?.bundleIdentifier ?? "",
  enabled: Boolean(apple?.enabled),
  keyId: apple?.keyId ?? "",
  privateKeyConfigured: Boolean(apple?.privateKeyConfigured),
  privateKeyHint: apple?.privateKeyHint ?? "",
  ready: Boolean(apple?.ready),
  servicesId: apple?.servicesId ?? "",
  teamId: apple?.teamId ?? "",
});

const toGoogle = (google?: RawGoogle): TenantGoogleSignInSettings => ({
  enabled: Boolean(google?.enabled),
  iosClientId: google?.iosClientId ?? "",
  ready: Boolean(google?.ready),
  webClientId: google?.webClientId ?? "",
});

const toTenantSignInSettings = (settings?: {
  apple?: RawApple;
  google?: RawGoogle;
}): TenantSignInSettings => ({
  apple: toApple(settings?.apple),
  google: toGoogle(settings?.google),
});

const getTenantSignInSettingsForSession = async (
  tenantId: string,
  locale: Locale,
  sessionId: string
): Promise<TenantSignInSettingsResult> => {
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

  cacheTag(tenantSignInSettingsCacheTag(normalizedTenantId));

  try {
    const response = await apiClient.tenantSettings.getTenantSignInSettings(
      { tenant: { tenantId: normalizedTenantId } },
      withSessionHeaders(sessionId)
    );
    return { ok: true, settings: toTenantSignInSettings(response.settings) };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    dropFailedCacheEntry();
    return {
      message: rpcErrorMessage(error, t("admin.settings.sign_in.load_failed"), {
        locale,
      }),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
    };
  }
};

export const getTenantSignInSettings = async (
  tenantId: string,
  locale: Locale
): Promise<TenantSignInSettingsResult> =>
  getTenantSignInSettingsForSession(tenantId, locale, await getAccessToken());

/** The fields the API refused, in the words the form uses for them. */
const refusedFieldErrors = (
  error: unknown,
  input: UpdateTenantSignInSettingsInput,
  t: Awaited<ReturnType<typeof getMessagesFor>>
): SignInSettingsFieldErrors | undefined => {
  const fieldErrors: SignInSettingsFieldErrors = {};
  if (rpcErrorHasFieldViolation(error, "apple.services_id")) {
    fieldErrors.servicesId = t(
      "admin.settings.sign_in.validation.services_id_invalid"
    );
  }
  if (rpcErrorHasFieldViolation(error, "apple.team_id")) {
    fieldErrors.teamId = t("admin.settings.sign_in.validation.team_id_invalid");
  }
  if (rpcErrorHasFieldViolation(error, "apple.key_id")) {
    fieldErrors.keyId = t("admin.settings.sign_in.validation.key_id_invalid");
  }
  if (rpcErrorHasFieldViolation(error, "apple.private_key")) {
    fieldErrors.privateKey = t(
      "admin.settings.sign_in.validation.private_key_invalid"
    );
  }
  // The API names Google as a whole, so every client ID entered is suspect.
  if (rpcErrorHasFieldViolation(error, "google")) {
    const message = t("admin.settings.sign_in.validation.client_id_invalid");
    if (input.google.webClientId) {
      fieldErrors.webClientId = message;
    }
    if (input.google.iosClientId) {
      fieldErrors.iosClientId = message;
    }
  }
  return Object.keys(fieldErrors).length > 0 ? fieldErrors : undefined;
};

/** Writes both providers; the key is kept, replaced, or cleared as its mode says. */
export const updateTenantSignInSettings = async (
  input: UpdateTenantSignInSettingsInput,
  locale: Locale
): Promise<TenantSignInSettingsResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  const normalizedTenantId = input.tenantId.trim();
  if (!normalizedTenantId || !sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    const response = await apiClient.tenantSettings.updateTenantSignInSettings(
      {
        apple: {
          enabled: input.apple.enabled,
          keyId: input.apple.keyId,
          privateKey: input.apple.privateKey.value,
          privateKeyUpdateMode: input.apple.privateKey.mode,
          servicesId: input.apple.servicesId,
          teamId: input.apple.teamId,
        },
        google: {
          enabled: input.google.enabled,
          iosClientId: input.google.iosClientId,
          webClientId: input.google.webClientId,
        },
        tenant: { tenantId: normalizedTenantId },
      },
      withSessionHeaders(sessionId)
    );
    return { ok: true, settings: toTenantSignInSettings(response.settings) };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    const fieldErrors = refusedFieldErrors(error, input, t);
    if (fieldErrors) {
      return { fieldErrors, message: t("errors.validation"), ok: false };
    }
    return {
      message: rpcErrorMessage(error, t("admin.settings.sign_in.save_failed"), {
        locale,
      }),
      ok: false,
    };
  }
};
