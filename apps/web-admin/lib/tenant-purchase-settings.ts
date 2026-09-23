import type { TenantPurchaseSettings as RpcTenantPurchaseSettings } from "@publira/api-client/admin/types";
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
import type { SurfaceAvailabilityValue } from "./surface-availability";
import {
  SURFACE_AVAILABILITY_ENUM,
  toSurfaceAvailabilityValue,
} from "./surface-availability-enum";

/**
 * Where the tenant's episodes may be bought unless a series or an episode
 * states otherwise, and the store listings of its app. A store address is
 * empty where the app has no listing there.
 */
export interface TenantPurchaseSettings {
  purchaseAvailability: SurfaceAvailabilityValue;
  appStoreUrl: string;
  googlePlayUrl: string;
}

export type TenantPurchaseSettingsResult =
  | { ok: true; settings: TenantPurchaseSettings }
  | {
      ok: false;
      message: string;
      /** The API rejected the session — the page raises the login redirect. */
      requiresSignIn?: boolean;
    };

/**
 * Tag the reads of the tenant default carry — the payments screen and the
 * series and episode forms that name it — so a save reaches all of them in
 * the same session.
 */
export const tenantPurchaseSettingsCacheTag = (tenantId: string): string =>
  `tenant:${tenantId.trim()}:purchase-settings`;

type RawTenantPurchaseSettings = Pick<
  RpcTenantPurchaseSettings,
  "appStoreUrl" | "googlePlayUrl" | "purchaseAvailability"
>;

/**
 * The API never answers the unspecified value, so one that names no surface is
 * a read that said nothing, not the tenant's choice: reported, a form would
 * otherwise open on a value the next save writes over the stored one.
 */
const toTenantPurchaseSettings = (
  settings: RawTenantPurchaseSettings | undefined
): TenantPurchaseSettings | undefined => {
  const purchaseAvailability = toSurfaceAvailabilityValue(
    settings?.purchaseAvailability
  );
  if (!purchaseAvailability) {
    return;
  }
  return {
    appStoreUrl: settings?.appStoreUrl ?? "",
    googlePlayUrl: settings?.googlePlayUrl ?? "",
    purchaseAvailability,
  };
};

export const getTenantPurchaseSettings = async (
  tenantId: string,
  locale: Locale
): Promise<TenantPurchaseSettingsResult> => {
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

  cacheTag(tenantPurchaseSettingsCacheTag(normalizedTenantId));

  try {
    const response = await apiClient.tenantSettings.getTenantPurchaseSettings(
      { tenant: { tenantId: normalizedTenantId } },
      withSessionHeaders(sessionId)
    );

    const settings = toTenantPurchaseSettings(response.settings);
    if (settings === undefined) {
      return {
        message: t("admin.settings.purchase.load_failed"),
        ok: false,
      };
    }

    return { ok: true, settings };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(
        error,
        t("admin.settings.purchase.load_failed"),
        { locale }
      ),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
    };
  }
};

export const updateTenantPurchaseSettings = async (
  input: { tenantId: string } & TenantPurchaseSettings,
  locale: Locale
): Promise<TenantPurchaseSettingsResult> => {
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
      await apiClient.tenantSettings.updateTenantPurchaseSettings(
        {
          settings: {
            appStoreUrl: input.appStoreUrl,
            googlePlayUrl: input.googlePlayUrl,
            purchaseAvailability:
              SURFACE_AVAILABILITY_ENUM[input.purchaseAvailability],
          },
          tenant: { tenantId: normalizedTenantId },
        },
        withSessionHeaders(sessionId)
      );

    const settings = toTenantPurchaseSettings(response.settings);
    if (settings === undefined) {
      return {
        message: t("admin.settings.purchase.save_failed"),
        ok: false,
      };
    }

    return { ok: true, settings };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    // Only the server's check is authoritative, so its refusal of an address
    // the form passed still names the field.
    let storeUrlMessage: string | undefined;
    if (rpcErrorHasFieldViolation(error, "settings.app_store_url")) {
      storeUrlMessage = t(
        "admin.settings.purchase.validation.app_store_url_invalid"
      );
    } else if (rpcErrorHasFieldViolation(error, "settings.google_play_url")) {
      storeUrlMessage = t(
        "admin.settings.purchase.validation.google_play_url_invalid"
      );
    }
    return {
      message: rpcErrorMessage(
        error,
        t("admin.settings.purchase.save_failed"),
        {
          locale,
          overrides: storeUrlMessage
            ? { "invalid-argument": storeUrlMessage }
            : undefined,
        }
      ),
      ok: false,
    };
  }
};
