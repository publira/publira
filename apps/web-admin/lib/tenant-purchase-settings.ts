import type { TenantPurchaseSettings as RpcTenantPurchaseSettings } from "@publira/api-client/admin/types";
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
import type { AdminMessageAccessor } from "./messages";
import { getAccessToken } from "./session";
import type { SurfaceAvailabilityValue } from "./surface-availability";
import {
  SURFACE_AVAILABILITY_ENUM,
  toSurfaceAvailabilityValue,
} from "./surface-availability-enum";
import { MAX_TIP_AMOUNTS } from "./tenant-tip-settings-shared";

/**
 * Whether readers may tip the Authors of an episode, and the amounts they may
 * give, in the minor unit of the tenant's currency and in ascending order.
 */
export interface TenantTipSettings {
  enabled: boolean;
  amounts: number[];
}

/**
 * Where the tenant's episodes may be bought unless a series or an episode
 * states otherwise, the store listings of its app, and the tips it takes. A
 * store address is empty where the app has no listing there.
 */
export interface TenantPurchaseSettings {
  purchaseAvailability: SurfaceAvailabilityValue;
  appStoreUrl: string;
  googlePlayUrl: string;
  tips: TenantTipSettings;
}

export type TenantPurchaseSettingsResult =
  | { ok: true; settings: TenantPurchaseSettings }
  | {
      ok: false;
      message: string;
      /** The API rejected the session — the page raises the login redirect. */
      requiresSignIn?: boolean;
      /** The server refused the tip amounts, worded for the field. */
      tipAmountsError?: string;
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
  "appStoreUrl" | "googlePlayUrl" | "purchaseAvailability" | "tips"
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
    // A server of the release before tips answers none, which is tips off.
    tips: {
      amounts: [...(settings?.tips?.amounts ?? [])],
      enabled: settings?.tips?.enabled ?? false,
    },
  };
};

const getTenantPurchaseSettingsForSession = async (
  tenantId: string,
  locale: Locale,
  sessionId: string
): Promise<CachedRead<TenantPurchaseSettingsResult>> => {
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

  cacheTag(tenantPurchaseSettingsCacheTag(normalizedTenantId));

  try {
    const response = await apiClient.tenantSettings.getTenantPurchaseSettings(
      { tenant: { tenantId: normalizedTenantId } },
      withSessionHeaders(sessionId)
    );

    const settings = toTenantPurchaseSettings(response.settings);

    if (settings === undefined) {
      dropFailedCacheEntry();

      return {
        message: t("admin.settings.purchase.load_failed"),
        ok: false,
      };
    }

    return { ok: true, settings };
  } catch (error) {
    dropFailedCacheEntry();

    return {
      message: rpcErrorMessage(
        error,
        t("admin.settings.purchase.load_failed"),
        { locale }
      ),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
      unexpected: rpcErrorDisposition(error) === "unexpected",
    };
  }
};

export const getTenantPurchaseSettings = async (
  tenantId: string,
  locale: Locale
): Promise<TenantPurchaseSettingsResult> =>
  settleCachedRead(
    await getTenantPurchaseSettingsForSession(
      tenantId,
      locale,
      await getAccessToken()
    )
  );

/**
 * Sends `settings` for the tenant and reads back what the API stored.
 * `failedMessage` words a failure the API gave no reason for, which is the
 * card's own: where episodes are sold, or the tips.
 */
const writeTenantPurchaseSettings = async (
  request: {
    sessionId: string;
    settings: Omit<TenantPurchaseSettings, "tips"> & {
      tips?: TenantTipSettings;
    };
    tenantId: string;
  },
  {
    failedMessage,
    locale,
    t,
  }: {
    failedMessage: string;
    locale: Locale;
    t: AdminMessageAccessor;
  }
): Promise<TenantPurchaseSettingsResult> => {
  const { settings } = request;

  try {
    const response =
      await apiClient.tenantSettings.updateTenantPurchaseSettings(
        {
          settings: {
            appStoreUrl: settings.appStoreUrl,
            googlePlayUrl: settings.googlePlayUrl,
            purchaseAvailability:
              SURFACE_AVAILABILITY_ENUM[settings.purchaseAvailability],
            tips: settings.tips
              ? {
                  amounts: settings.tips.amounts,
                  enabled: settings.tips.enabled,
                }
              : undefined,
          },
          tenant: { tenantId: request.tenantId },
        },
        withSessionHeaders(request.sessionId)
      );

    const stored = toTenantPurchaseSettings(response.settings);

    if (stored === undefined) {
      return { message: failedMessage, ok: false };
    }

    return { ok: true, settings: stored };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);

    // Only the server's check is authoritative, so its refusal of an address
    // or an amount the form passed still names the field.
    if (rpcErrorHasFieldViolation(error, "settings.tips.amounts")) {
      const tipAmountsError = t(
        "admin.settings.tips.validation.amounts_refused",
        { max: MAX_TIP_AMOUNTS }
      );

      return { message: tipAmountsError, ok: false, tipAmountsError };
    }

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
      message: rpcErrorMessage(error, failedMessage, {
        locale,
        overrides: storeUrlMessage
          ? { "invalid-argument": storeUrlMessage }
          : undefined,
      }),
      ok: false,
    };
  }
};

/**
 * Writes where episodes are sold and the store addresses. The tips are left
 * out, which the API reads as keeping them as they are.
 */
export const updateTenantPurchaseSettings = async (
  input: { tenantId: string } & Omit<TenantPurchaseSettings, "tips">,
  locale: Locale
): Promise<TenantPurchaseSettingsResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);

  const tenantId = input.tenantId.trim();

  if (!tenantId || !sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  return writeTenantPurchaseSettings(
    {
      sessionId,
      settings: {
        appStoreUrl: input.appStoreUrl,
        googlePlayUrl: input.googlePlayUrl,
        purchaseAvailability: input.purchaseAvailability,
      },
      tenantId,
    },
    { failedMessage: t("admin.settings.purchase.save_failed"), locale, t }
  );
};

/**
 * Writes the tips. The API writes every other purchase setting beside them,
 * so those are sent back as it answers them now rather than as the page last
 * showed them, which another save may have changed since.
 */
export const updateTenantTipSettings = async (
  input: { tenantId: string; tips: TenantTipSettings },
  locale: Locale
): Promise<TenantPurchaseSettingsResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);

  const tenantId = input.tenantId.trim();

  if (!tenantId || !sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  const failedMessage = t("admin.settings.tips.save_failed");
  let current: TenantPurchaseSettings | undefined;

  try {
    const response = await apiClient.tenantSettings.getTenantPurchaseSettings(
      { tenant: { tenantId } },
      withSessionHeaders(sessionId)
    );

    current = toTenantPurchaseSettings(response.settings);
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);

    return {
      message: rpcErrorMessage(error, failedMessage, { locale }),
      ok: false,
    };
  }

  if (current === undefined) {
    return { message: failedMessage, ok: false };
  }

  return writeTenantPurchaseSettings(
    { sessionId, settings: { ...current, tips: input.tips }, tenantId },
    { failedMessage, locale, t }
  );
};
