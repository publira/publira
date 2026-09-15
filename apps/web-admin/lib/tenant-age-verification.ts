import { AgeVerification } from "@publira/api-client/admin/types";
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
import type { TenantAgeVerification } from "./tenant-age-verification-shared";

export type GetTenantAgeVerificationResult =
  | { ok: true; ageVerification: TenantAgeVerification }
  | {
      ok: false;
      message: string;
      /**
       * No rule. A read that failed has no saved policy to report, and the
       * settings screen would otherwise offer to save a value nobody chose over
       * the stored one — opening a tenant's `r18` catalogue to readers who have
       * proven nothing, or closing it to every reader with no date on file.
       */
      requiresSignIn: boolean;
    };

export type UpdateTenantAgeVerificationResult =
  | { ok: true; ageVerification: TenantAgeVerification }
  | { ok: false; message: string };

/**
 * Tag the settings screen's cached read carries, so `updateTag` in the Server
 * Action makes the saved rule visible in the same session instead of leaving
 * the previous one in the private cache.
 */
export const tenantAgeVerificationCacheTag = (tenantId: string): string =>
  `tenant:${tenantId.trim()}:age-verification`;

/**
 * `AGE_VERIFICATION_UNSPECIFIED` names no rule, so it resolves to nothing
 * rather than to `none`: a response that answered with the enum's zero value is
 * a read that failed to say anything, and reporting it as "no age is proven"
 * would put that in front of an operator as the tenant's own choice.
 */
const toTenantAgeVerification = (
  ageVerification: AgeVerification | undefined
): TenantAgeVerification | undefined => {
  switch (ageVerification) {
    case AgeVerification.NONE: {
      return "none";
    }
    case AgeVerification.R18: {
      return "r18";
    }
    case AgeVerification.R15_AND_R18: {
      return "r15_and_r18";
    }
    default: {
      return undefined;
    }
  }
};

const toAgeVerificationEnum = (
  ageVerification: TenantAgeVerification
): AgeVerification => {
  switch (ageVerification) {
    case "r18": {
      return AgeVerification.R18;
    }
    case "r15_and_r18": {
      return AgeVerification.R15_AND_R18;
    }
    default: {
      return AgeVerification.NONE;
    }
  }
};

export const getTenantAgeVerification = async (
  tenantId: string,
  locale: Locale
): Promise<GetTenantAgeVerificationResult> => {
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

  cacheTag(tenantAgeVerificationCacheTag(normalizedTenantId));

  try {
    const response = await apiClient.tenantSettings.getTenantAgeVerification(
      {
        tenant: { tenantId: normalizedTenantId },
      },
      withSessionHeaders(sessionId)
    );

    const ageVerification = toTenantAgeVerification(response.ageVerification);
    if (ageVerification === undefined) {
      return {
        message: t("admin.settings.age_verification.load_failed"),
        ok: false,
        requiresSignIn: false,
      };
    }

    return { ageVerification, ok: true };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(
        error,
        t("admin.settings.age_verification.load_failed"),
        { locale }
      ),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
    };
  }
};

export const updateTenantAgeVerification = async (
  input: { tenantId: string; ageVerification: TenantAgeVerification },
  locale: Locale
): Promise<UpdateTenantAgeVerificationResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  const normalizedTenantId = input.tenantId.trim();
  if (!normalizedTenantId || !sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    const response = await apiClient.tenantSettings.updateTenantAgeVerification(
      {
        ageVerification: toAgeVerificationEnum(input.ageVerification),
        tenant: { tenantId: normalizedTenantId },
      },
      withSessionHeaders(sessionId)
    );
    const saved = toTenantAgeVerification(response.ageVerification);
    if (saved === undefined) {
      return {
        message: t("admin.settings.age_verification.save_failed"),
        ok: false,
      };
    }

    return { ageVerification: saved, ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(
        error,
        t("admin.settings.age_verification.save_failed"),
        { locale }
      ),
      ok: false,
    };
  }
};
