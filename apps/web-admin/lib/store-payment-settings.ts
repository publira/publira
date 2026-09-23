import type {
  TenantAppStorePaymentSettings as RpcTenantAppStorePaymentSettings,
  TenantGooglePlayPaymentSettings as RpcTenantGooglePlayPaymentSettings,
  TenantStoreProduct as RpcTenantStoreProduct,
} from "@publira/api-client/admin/types";
import { AppPurchaseRoute } from "@publira/api-client/admin/types";
import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  rethrowUnclassifiedRpcError,
  rpcErrorDisposition,
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
import type {
  AppPurchaseRouteValue,
  TenantStorePaymentSettings,
} from "./store-payment-settings-shared";

export type {
  AppPurchaseRouteValue,
  TenantStorePaymentSettings,
} from "./store-payment-settings-shared";

const APP_PURCHASE_ROUTE_ENUM: Record<AppPurchaseRouteValue, AppPurchaseRoute> =
  {
    external_checkout: AppPurchaseRoute.EXTERNAL_CHECKOUT,
    store: AppPurchaseRoute.STORE,
  };

export interface StoreKeyUpdate {
  /** A `SecretUpdateMode` value. */
  mode: number;
  value: string;
}

export interface UpdateTenantStorePaymentSettingsInput {
  tenantId: string;
  appPurchaseRoute: AppPurchaseRouteValue;
  appStore: {
    enabled: boolean;
    issuerId: string;
    keyId: string;
    privateKey: StoreKeyUpdate;
  };
  googlePlay: {
    enabled: boolean;
    serviceAccountKey: StoreKeyUpdate;
  };
}

export type StorePaymentSettingsField =
  | "appPurchaseRoute"
  | "issuerId"
  | "keyId"
  | "privateKey"
  | "serviceAccountKey";

export type StorePaymentSettingsFieldErrors = Partial<
  Record<StorePaymentSettingsField, string>
>;

export type TenantStorePaymentSettingsResult =
  | { ok: true; settings: TenantStorePaymentSettings }
  | {
      ok: false;
      message: string;
      fieldErrors?: StorePaymentSettingsFieldErrors;
      /** Set by the read only; the update path throws instead. */
      requiresSignIn?: boolean;
    };

export interface TenantStoreProduct {
  productId: string;
  price: number;
  episodeCount: number;
}

export type TenantStoreProductsResult =
  | { ok: true; products: TenantStoreProduct[] }
  | { ok: false; message: string; requiresSignIn?: boolean };

/**
 * The store settings read carries this tag. The app links write clears it too,
 * because a store is ready only once the app it sells in is named there.
 */
export const tenantStorePaymentSettingsCacheTag = (tenantId: string): string =>
  `tenant:${tenantId.trim()}:store-payment-settings`;

/**
 * The generated fields {@link toTenantStorePaymentSettings} reads, so a proto
 * rename fails here rather than showing an empty hint.
 */
type RawAppStore = Pick<
  RpcTenantAppStorePaymentSettings,
  | "bundleIdentifier"
  | "enabled"
  | "issuerId"
  | "keyId"
  | "privateKeyConfigured"
  | "privateKeyHint"
  | "ready"
>;

type RawGooglePlay = Pick<
  RpcTenantGooglePlayPaymentSettings,
  | "enabled"
  | "packageName"
  | "ready"
  | "serviceAccountEmail"
  | "serviceAccountKeyConfigured"
  | "serviceAccountKeyHint"
>;

type RawStoreProduct = Pick<
  RpcTenantStoreProduct,
  "episodeCount" | "price" | "productId"
>;

const toAppStore = (
  store?: RawAppStore
): TenantStorePaymentSettings["appStore"] => ({
  bundleIdentifier: store?.bundleIdentifier ?? "",
  enabled: Boolean(store?.enabled),
  issuerId: store?.issuerId ?? "",
  keyId: store?.keyId ?? "",
  privateKeyConfigured: Boolean(store?.privateKeyConfigured),
  privateKeyHint: store?.privateKeyHint ?? "",
  ready: Boolean(store?.ready),
});

const toGooglePlay = (
  store?: RawGooglePlay
): TenantStorePaymentSettings["googlePlay"] => ({
  enabled: Boolean(store?.enabled),
  packageName: store?.packageName ?? "",
  ready: Boolean(store?.ready),
  serviceAccountEmail: store?.serviceAccountEmail ?? "",
  serviceAccountKeyConfigured: Boolean(store?.serviceAccountKeyConfigured),
  serviceAccountKeyHint: store?.serviceAccountKeyHint ?? "",
});

const toTenantStorePaymentSettings = (settings?: {
  appPurchaseRoute?: AppPurchaseRoute;
  appStore?: RawAppStore;
  googlePlay?: RawGooglePlay;
}): TenantStorePaymentSettings => ({
  appPurchaseRoute:
    settings?.appPurchaseRoute === AppPurchaseRoute.STORE
      ? "store"
      : "external_checkout",
  appStore: toAppStore(settings?.appStore),
  googlePlay: toGooglePlay(settings?.googlePlay),
});

const toTenantStoreProduct = (
  product: RawStoreProduct
): TenantStoreProduct => ({
  episodeCount: product.episodeCount ?? 0,
  price: product.price ?? 0,
  productId: product.productId ?? "",
});

export const getTenantStorePaymentSettings = async (
  tenantId: string,
  locale: Locale
): Promise<TenantStorePaymentSettingsResult> => {
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

  cacheTag(tenantStorePaymentSettingsCacheTag(normalizedTenantId));

  try {
    const response =
      await apiClient.paymentSettings.getTenantStorePaymentSettings(
        { tenant: { tenantId: normalizedTenantId } },
        withSessionHeaders(sessionId)
      );
    return {
      ok: true,
      settings: toTenantStorePaymentSettings(response.settings),
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(
        error,
        t("admin.settings.store_payment.load_failed"),
        { locale }
      ),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
    };
  }
};

/** The fields the API refused, in the words the form uses for them. */
const refusedFieldErrors = (
  error: unknown,
  t: Awaited<ReturnType<typeof getMessagesFor>>
): StorePaymentSettingsFieldErrors | undefined => {
  const fieldErrors: StorePaymentSettingsFieldErrors = {};
  if (rpcErrorHasFieldViolation(error, "app_store.issuer_id")) {
    fieldErrors.issuerId = t(
      "admin.settings.store_payment.validation.issuer_id_invalid"
    );
  }
  if (rpcErrorHasFieldViolation(error, "app_store.key_id")) {
    fieldErrors.keyId = t(
      "admin.settings.store_payment.validation.key_id_invalid"
    );
  }
  if (rpcErrorHasFieldViolation(error, "app_store.private_key")) {
    fieldErrors.privateKey = t(
      "admin.settings.store_payment.validation.private_key_invalid"
    );
  }
  if (rpcErrorHasFieldViolation(error, "google_play.service_account_key")) {
    fieldErrors.serviceAccountKey = t(
      "admin.settings.store_payment.validation.service_account_key_invalid"
    );
  }
  return Object.keys(fieldErrors).length > 0 ? fieldErrors : undefined;
};

export const updateTenantStorePaymentSettings = async (
  input: UpdateTenantStorePaymentSettingsInput,
  locale: Locale
): Promise<TenantStorePaymentSettingsResult> => {
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
      await apiClient.paymentSettings.updateTenantStorePaymentSettings(
        {
          appPurchaseRoute: APP_PURCHASE_ROUTE_ENUM[input.appPurchaseRoute],
          appStore: {
            enabled: input.appStore.enabled,
            issuerId: input.appStore.issuerId,
            keyId: input.appStore.keyId,
            privateKey: input.appStore.privateKey.value,
            privateKeyUpdateMode: input.appStore.privateKey.mode,
          },
          googlePlay: {
            enabled: input.googlePlay.enabled,
            serviceAccountKey: input.googlePlay.serviceAccountKey.value,
            serviceAccountKeyUpdateMode:
              input.googlePlay.serviceAccountKey.mode,
          },
          tenant: { tenantId: normalizedTenantId },
        },
        withSessionHeaders(sessionId)
      );
    return {
      ok: true,
      settings: toTenantStorePaymentSettings(response.settings),
    };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    const fieldErrors = refusedFieldErrors(error, t);
    if (fieldErrors) {
      return { fieldErrors, message: t("errors.validation"), ok: false };
    }
    // The one precondition this RPC has: the store route with no ready store.
    if (rpcErrorDisposition(error) === "precondition") {
      return {
        fieldErrors: {
          appPurchaseRoute: t(
            "admin.settings.store_payment.validation.route_requires_ready_store"
          ),
        },
        message: t("errors.validation"),
        ok: false,
      };
    }
    return {
      message: rpcErrorMessage(
        error,
        t("admin.settings.store_payment.save_failed"),
        { locale }
      ),
      ok: false,
    };
  }
};

/**
 * The store products the catalog needs. Read uncached: it follows every price
 * change of every episode, and no episode write clears a tag for it.
 */
export const listTenantStoreProducts = async (
  tenantId: string,
  locale: Locale
): Promise<TenantStoreProductsResult> => {
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

  try {
    const response = await apiClient.paymentSettings.listTenantStoreProducts(
      { tenant: { tenantId: normalizedTenantId } },
      withSessionHeaders(sessionId)
    );
    return { ok: true, products: response.products.map(toTenantStoreProduct) };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(
        error,
        t("admin.settings.store_products.load_failed"),
        { locale }
      ),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
    };
  }
};
