import {
  GoogleTagConsentMode as RpcGoogleTagConsentMode,
  GoogleTagServingMode as RpcGoogleTagServingMode,
} from "@publira/api-client/admin/types";
import type { TenantAnalyticsSettings as RpcTenantAnalyticsSettings } from "@publira/api-client/admin/types";
import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  rethrowUnclassifiedRpcError,
  rpcErrorDisposition,
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
import type { CachedRead } from "./cached-read";
import { settleCachedRead } from "./cached-read";
import { getMessagesFor } from "./messages";
import { getAccessToken } from "./session";
import type {
  GoogleTagConsentMode,
  GoogleTagServingMode,
  TenantAnalyticsSettings,
} from "./tenant-analytics-settings-shared";

export interface UpdateTenantAnalyticsSettingsInput {
  tenantId: string;
  settings: Omit<TenantAnalyticsSettings, "gatewayPath">;
  /** Replaces the gateway path, after which the old one no longer answers. */
  regenerateGatewayPath: boolean;
}

export type TenantAnalyticsSettingsField =
  | "consentMode"
  | "ga4MeasurementId"
  | "gtmContainerId"
  | "serverContainerUrl"
  | "servingMode";

export type TenantAnalyticsSettingsFieldErrors = Partial<
  Record<TenantAnalyticsSettingsField, string>
>;

export type TenantAnalyticsSettingsResult =
  | { ok: true; settings: TenantAnalyticsSettings }
  | {
      ok: false;
      message: string;
      fieldErrors?: TenantAnalyticsSettingsFieldErrors;
      /** Set by the read only; the update path throws instead. */
      requiresSignIn?: boolean;
    };

export const tenantAnalyticsSettingsCacheTag = (tenantId: string): string =>
  `tenant:${tenantId.trim()}:analytics-settings`;

type RawTenantAnalyticsSettings = Pick<
  RpcTenantAnalyticsSettings,
  | "consentMode"
  | "gatewayPath"
  | "ga4MeasurementId"
  | "gtmContainerId"
  | "serverContainerUrl"
  | "servingMode"
>;

/**
 * `GOOGLE_TAG_SERVING_MODE_UNSPECIFIED` names no mode, so it resolves to
 * nothing rather than to `google`: the API never answers it on a read, and
 * reporting it as Google's own servers would put a mode in front of the
 * operator that the tenant may not have chosen.
 */
const toServingMode = (
  mode: RpcGoogleTagServingMode | undefined
): GoogleTagServingMode | undefined => {
  switch (mode) {
    case RpcGoogleTagServingMode.GOOGLE: {
      return "google";
    }
    case RpcGoogleTagServingMode.SERVER_CONTAINER: {
      return "server_container";
    }
    case RpcGoogleTagServingMode.GATEWAY: {
      return "gateway";
    }
    default: {
      return undefined;
    }
  }
};

const toRpcServingMode = (
  mode: GoogleTagServingMode
): RpcGoogleTagServingMode => {
  switch (mode) {
    case "server_container": {
      return RpcGoogleTagServingMode.SERVER_CONTAINER;
    }
    case "gateway": {
      return RpcGoogleTagServingMode.GATEWAY;
    }
    default: {
      return RpcGoogleTagServingMode.GOOGLE;
    }
  }
};

/**
 * A server of the release before this one has no consent mode and answers
 * `GOOGLE_TAG_CONSENT_MODE_UNSPECIFIED`, and the storefront it serves runs the
 * tag without asking, so the answer reads as `not_required`.
 */
const toConsentMode = (
  mode: RpcGoogleTagConsentMode | undefined
): GoogleTagConsentMode => {
  switch (mode) {
    case RpcGoogleTagConsentMode.OPT_IN: {
      return "opt_in";
    }
    case RpcGoogleTagConsentMode.EXTERNAL: {
      return "external";
    }
    default: {
      return "not_required";
    }
  }
};

const toRpcConsentMode = (
  mode: GoogleTagConsentMode
): RpcGoogleTagConsentMode => {
  switch (mode) {
    case "opt_in": {
      return RpcGoogleTagConsentMode.OPT_IN;
    }
    case "external": {
      return RpcGoogleTagConsentMode.EXTERNAL;
    }
    default: {
      return RpcGoogleTagConsentMode.NOT_REQUIRED;
    }
  }
};

const toTenantAnalyticsSettings = (
  settings: RawTenantAnalyticsSettings | undefined
): TenantAnalyticsSettings | undefined => {
  const servingMode = toServingMode(settings?.servingMode);
  if (servingMode === undefined) {
    return undefined;
  }
  return {
    consentMode: toConsentMode(settings?.consentMode),
    ga4MeasurementId: settings?.ga4MeasurementId ?? "",
    gatewayPath: settings?.gatewayPath ?? "",
    gtmContainerId: settings?.gtmContainerId ?? "",
    serverContainerUrl: settings?.serverContainerUrl ?? "",
    servingMode,
  };
};

const getTenantAnalyticsSettingsForSession = async (
  tenantId: string,
  locale: Locale,
  sessionId: string
): Promise<CachedRead<TenantAnalyticsSettingsResult>> => {
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

  cacheTag(tenantAnalyticsSettingsCacheTag(normalizedTenantId));

  try {
    const response = await apiClient.tenantSettings.getTenantAnalyticsSettings(
      { tenant: { tenantId: normalizedTenantId } },
      withSessionHeaders(sessionId)
    );
    const settings = toTenantAnalyticsSettings(response.settings);
    if (settings === undefined) {
      dropFailedCacheEntry();
      return {
        message: t("admin.settings.google_tag.load_failed"),
        ok: false,
        requiresSignIn: false,
      };
    }
    return { ok: true, settings };
  } catch (error) {
    dropFailedCacheEntry();
    return {
      message: rpcErrorMessage(
        error,
        t("admin.settings.google_tag.load_failed"),
        { locale }
      ),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
      unexpected: rpcErrorDisposition(error) === "unexpected",
    };
  }
};

export const getTenantAnalyticsSettings = async (
  tenantId: string,
  locale: Locale
): Promise<TenantAnalyticsSettingsResult> =>
  settleCachedRead(
    await getTenantAnalyticsSettingsForSession(
      tenantId,
      locale,
      await getAccessToken()
    )
  );

/** The fields the API refused, in the words the form uses for them. */
const refusedFieldErrors = (
  error: unknown,
  input: UpdateTenantAnalyticsSettingsInput,
  t: Awaited<ReturnType<typeof getMessagesFor>>
): TenantAnalyticsSettingsFieldErrors | undefined => {
  const fieldErrors: TenantAnalyticsSettingsFieldErrors = {};
  if (rpcErrorHasFieldViolation(error, "settings.ga4_measurement_id")) {
    fieldErrors.ga4MeasurementId = /^ua-/iu.test(
      input.settings.ga4MeasurementId
    )
      ? t("admin.settings.google_tag.validation.universal_analytics_id")
      : t("admin.settings.google_tag.validation.measurement_id_invalid");
  }
  if (rpcErrorHasFieldViolation(error, "settings.gtm_container_id")) {
    fieldErrors.gtmContainerId =
      input.settings.gtmContainerId === "" &&
      input.settings.consentMode === "external"
        ? t("admin.settings.google_tag.validation.container_id_required")
        : t("admin.settings.google_tag.validation.container_id_invalid");
  }
  if (rpcErrorHasFieldViolation(error, "settings.serving_mode")) {
    fieldErrors.servingMode = t(
      "admin.settings.google_tag.validation.serving_mode_invalid"
    );
  }
  if (rpcErrorHasFieldViolation(error, "settings.consent_mode")) {
    fieldErrors.consentMode = t(
      "admin.settings.google_tag.validation.consent_mode_invalid"
    );
  }
  if (rpcErrorHasFieldViolation(error, "settings.server_container_url")) {
    fieldErrors.serverContainerUrl = input.settings.serverContainerUrl
      ? t("admin.settings.google_tag.validation.server_container_url_invalid")
      : t("admin.settings.google_tag.validation.server_container_url_required");
  }
  return Object.keys(fieldErrors).length > 0 ? fieldErrors : undefined;
};

/** Writes every field but the gateway path, which the API generates. */
export const updateTenantAnalyticsSettings = async (
  input: UpdateTenantAnalyticsSettingsInput,
  locale: Locale
): Promise<TenantAnalyticsSettingsResult> => {
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
      await apiClient.tenantSettings.updateTenantAnalyticsSettings(
        {
          regenerateGatewayPath: input.regenerateGatewayPath,
          settings: {
            consentMode: toRpcConsentMode(input.settings.consentMode),
            ga4MeasurementId: input.settings.ga4MeasurementId,
            gtmContainerId: input.settings.gtmContainerId,
            serverContainerUrl: input.settings.serverContainerUrl,
            servingMode: toRpcServingMode(input.settings.servingMode),
          },
          tenant: { tenantId: normalizedTenantId },
        },
        withSessionHeaders(sessionId)
      );
    const settings = toTenantAnalyticsSettings(response.settings);
    if (settings === undefined) {
      return {
        message: t("admin.settings.google_tag.save_failed"),
        ok: false,
      };
    }
    return { ok: true, settings };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    const fieldErrors = refusedFieldErrors(error, input, t);
    if (fieldErrors) {
      return { fieldErrors, message: t("errors.validation"), ok: false };
    }
    return {
      message: rpcErrorMessage(
        error,
        t("admin.settings.google_tag.save_failed"),
        { locale }
      ),
      ok: false,
    };
  }
};
