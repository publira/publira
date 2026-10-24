import type { TenantSiteVerification as RpcTenantSiteVerification } from "@publira/api-client/admin/types";
import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  Code,
  rethrowUnclassifiedRpcError,
  rpcErrorCode,
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
import { siteVerificationCodeMessage } from "./tenant-site-verification-shared";

/** The codes the storefront proves the site is the tenant's with. */
export interface TenantSiteVerification {
  /** Google Search Console's google-site-verification code, empty for none. */
  google: string;
  /** Bing Webmaster Tools' msvalidate.01 code, empty for none. */
  bing: string;
}

export type TenantSiteVerificationResult =
  | { ok: true; siteVerification: TenantSiteVerification }
  | {
      ok: false;
      message: string;
      /** Set by the read only; the update path throws instead. */
      requiresSignIn?: boolean;
    };

/** Refusals worded for the field each belongs to. */
export type TenantSiteVerificationFieldErrors = Partial<
  Record<keyof TenantSiteVerification, string>
>;

export type UpdateTenantSiteVerificationResult =
  | { ok: true; siteVerification: TenantSiteVerification }
  | {
      ok: false;
      message: string;
      fieldErrors?: TenantSiteVerificationFieldErrors;
    };

/**
 * Tag the settings screen's cached read carries, so `updateTag` in the Server
 * Action makes the saved codes visible in the same session instead of leaving
 * the previous ones in the private cache.
 */
export const tenantSiteVerificationCacheTag = (tenantId: string): string =>
  `tenant:${tenantId.trim()}:site-verification`;

type RawTenantSiteVerification = Pick<
  RpcTenantSiteVerification,
  "bingSiteVerification" | "googleSiteVerification"
>;

const toTenantSiteVerification = (
  siteVerification?: RawTenantSiteVerification
): TenantSiteVerification => ({
  bing: siteVerification?.bingSiteVerification ?? "",
  google: siteVerification?.googleSiteVerification ?? "",
});

const getTenantSiteVerificationForSession = async (
  tenantId: string,
  locale: Locale,
  sessionId: string
): Promise<CachedRead<TenantSiteVerificationResult>> => {
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

  cacheTag(tenantSiteVerificationCacheTag(normalizedTenantId));

  try {
    const response = await apiClient.tenantSettings.getTenantSiteVerification(
      { tenant: { tenantId: normalizedTenantId } },
      withSessionHeaders(sessionId)
    );
    return {
      ok: true,
      siteVerification: toTenantSiteVerification(response.siteVerification),
    };
  } catch (error) {
    dropFailedCacheEntry();
    // The previous release's server has no such RPC, and an install may run
    // it beside this console while it upgrades. That costs this card alone,
    // closed as for any read that failed, rather than the settings page.
    if (rpcErrorCode(error) === Code.Unimplemented) {
      return {
        message: t("admin.settings.site_verification.load_failed"),
        ok: false,
      };
    }
    return {
      message: rpcErrorMessage(
        error,
        t("admin.settings.site_verification.load_failed"),
        { locale }
      ),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
      unexpected: rpcErrorDisposition(error) === "unexpected",
    };
  }
};

/**
 * The API answers this to a tenant administrator only, so the settings screen
 * calls it for one and renders the card read-only for anyone else without
 * asking: a refusal there says nothing the read-only notice does not.
 */
export const getTenantSiteVerification = async (
  tenantId: string,
  locale: Locale
): Promise<TenantSiteVerificationResult> =>
  settleCachedRead(
    await getTenantSiteVerificationForSession(
      tenantId,
      locale,
      await getAccessToken()
    )
  );

/**
 * Which code the API refused. The Action reads each one by the server's rule
 * first, so a refused code is one the two rules read differently; the server's
 * answer is the one that stands.
 */
const refusedField = (
  error: unknown
): keyof TenantSiteVerification | undefined => {
  if (
    rpcErrorHasFieldViolation(
      error,
      "site_verification.google_site_verification"
    )
  ) {
    return "google";
  }
  if (
    rpcErrorHasFieldViolation(error, "site_verification.bing_site_verification")
  ) {
    return "bing";
  }
  return undefined;
};

/** Writes both codes, an empty one clearing it. */
export const updateTenantSiteVerification = async (
  input: { tenantId: string } & TenantSiteVerification,
  locale: Locale
): Promise<UpdateTenantSiteVerificationResult> => {
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
      await apiClient.tenantSettings.updateTenantSiteVerification(
        {
          siteVerification: {
            bingSiteVerification: input.bing,
            googleSiteVerification: input.google,
          },
          tenant: { tenantId: normalizedTenantId },
        },
        withSessionHeaders(sessionId)
      );
    return {
      ok: true,
      siteVerification: toTenantSiteVerification(response.siteVerification),
    };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    const refused = refusedField(error);
    if (refused) {
      const message = siteVerificationCodeMessage(t, refused, "invalid");
      return { fieldErrors: { [refused]: message }, message, ok: false };
    }
    return {
      message: rpcErrorMessage(
        error,
        t("admin.settings.site_verification.save_failed"),
        { locale }
      ),
      ok: false,
    };
  }
};
