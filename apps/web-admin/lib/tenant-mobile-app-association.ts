import type {
  TenantAndroidAppAssociation as RpcTenantAndroidAppAssociation,
  TenantIosAppAssociation as RpcTenantIosAppAssociation,
} from "@publira/api-client/admin/types";
import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  rethrowUnclassifiedRpcError,
  rpcErrorHasFieldViolation,
} from "@publira/api-client/errors";
import type { Locale } from "@publira/i18n";
import { cacheTag } from "next/cache";

import {
  isUnauthenticatedError,
  rethrowUnauthenticatedRpcError,
} from "./admin-auth-shared";
import { apiClient, withSessionHeaders } from "./api";
import { getMessagesFor } from "./messages";
import { getAccessToken } from "./session";

/** The Android app the tenant's links open in. */
export interface TenantAndroidAppAssociation {
  applicationId: string;
  sha256CertFingerprints: string[];
}

/** The iOS app the tenant's links open in. */
export interface TenantIosAppAssociation {
  teamId: string;
  bundleIdentifier: string;
}

/** A platform is absent where the tenant publishes no app on it. */
export interface TenantMobileAppAssociation {
  android?: TenantAndroidAppAssociation;
  ios?: TenantIosAppAssociation;
}

export type TenantMobileAppAssociationResult =
  | { ok: true; association: TenantMobileAppAssociation }
  | { ok: false; message: string; requiresSignIn?: boolean };

/** The most signing certificates the API stores for one Android app. */
export const MAX_ANDROID_CERT_FINGERPRINTS = 10;

export const tenantMobileAppAssociationCacheTag = (tenantId: string): string =>
  `tenant:${tenantId.trim()}:mobile-app-association`;

type RawTenantAndroidAppAssociation = Pick<
  RpcTenantAndroidAppAssociation,
  "applicationId" | "sha256CertFingerprints"
>;

type RawTenantIosAppAssociation = Pick<
  RpcTenantIosAppAssociation,
  "bundleIdentifier" | "teamId"
>;

const toTenantMobileAppAssociation = (association?: {
  android?: RawTenantAndroidAppAssociation;
  ios?: RawTenantIosAppAssociation;
}): TenantMobileAppAssociation => ({
  android: association?.android
    ? {
        applicationId: association.android.applicationId ?? "",
        sha256CertFingerprints: [
          ...(association.android.sha256CertFingerprints ?? []),
        ],
      }
    : undefined,
  ios: association?.ios
    ? {
        bundleIdentifier: association.ios.bundleIdentifier ?? "",
        teamId: association.ios.teamId ?? "",
      }
    : undefined,
});

export const getTenantMobileAppAssociation = async (
  tenantId: string,
  locale: Locale
): Promise<TenantMobileAppAssociationResult> => {
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

  cacheTag(tenantMobileAppAssociationCacheTag(normalizedTenantId));

  try {
    const response =
      await apiClient.tenantSettings.getTenantMobileAppAssociation(
        { tenant: { tenantId: normalizedTenantId } },
        withSessionHeaders(sessionId)
      );
    return {
      association: toTenantMobileAppAssociation(response.association),
      ok: true,
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(
        error,
        t("admin.settings.app_links.load_failed"),
        { locale }
      ),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
    };
  }
};

/** Which field the API refused, as the form names it to the operator. */
const refusedFieldMessage = (
  error: unknown,
  association: TenantMobileAppAssociation,
  t: Awaited<ReturnType<typeof getMessagesFor>>
): string | undefined => {
  if (rpcErrorHasFieldViolation(error, "association.android.application_id")) {
    return t("admin.settings.app_links.validation.application_id_invalid");
  }
  if (
    rpcErrorHasFieldViolation(
      error,
      "association.android.sha256_cert_fingerprints"
    )
  ) {
    return t("admin.settings.app_links.validation.fingerprints_count", {
      max: String(MAX_ANDROID_CERT_FINGERPRINTS),
    });
  }
  const fingerprints = association.android?.sha256CertFingerprints ?? [];
  const refused = fingerprints.find((_, index) =>
    rpcErrorHasFieldViolation(
      error,
      `association.android.sha256_cert_fingerprints[${index}]`
    )
  );
  if (refused !== undefined) {
    return t("admin.settings.app_links.validation.fingerprint_refused", {
      fingerprint: refused,
    });
  }
  if (rpcErrorHasFieldViolation(error, "association.ios.team_id")) {
    return t("admin.settings.app_links.validation.team_id_invalid");
  }
  if (rpcErrorHasFieldViolation(error, "association.ios.bundle_identifier")) {
    return t("admin.settings.app_links.validation.bundle_identifier_invalid");
  }
  return undefined;
};

/** Writes both platforms: an absent one is cleared. */
export const updateTenantMobileAppAssociation = async (
  input: { tenantId: string; association: TenantMobileAppAssociation },
  locale: Locale
): Promise<TenantMobileAppAssociationResult> => {
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
      await apiClient.tenantSettings.updateTenantMobileAppAssociation(
        {
          association: {
            android: input.association.android,
            ios: input.association.ios,
          },
          tenant: { tenantId: normalizedTenantId },
        },
        withSessionHeaders(sessionId)
      );
    return {
      association: toTenantMobileAppAssociation(response.association),
      ok: true,
    };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    const fieldMessage = refusedFieldMessage(error, input.association, t);
    return {
      message: rpcErrorMessage(
        error,
        t("admin.settings.app_links.save_failed"),
        {
          locale,
          overrides: fieldMessage
            ? { "invalid-argument": fieldMessage }
            : undefined,
        }
      ),
      ok: false,
    };
  }
};
