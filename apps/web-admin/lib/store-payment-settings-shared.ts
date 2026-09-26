/**
 * How the tenant's app sells an episode it may sell. Strings rather than the
 * generated `AppPurchaseRoute` enum, because that is what the form posts;
 * `store-payment-settings.ts` is where they meet the enum.
 */
export const APP_PURCHASE_ROUTES = ["external_checkout", "store"] as const;

export type AppPurchaseRouteValue = (typeof APP_PURCHASE_ROUTES)[number];

export const isAppPurchaseRouteValue = (
  value: string
): value is AppPurchaseRouteValue =>
  APP_PURCHASE_ROUTES.some((route) => route === value);

export interface TenantAppStorePaymentSettings {
  enabled: boolean;
  issuerId: string;
  keyId: string;
  privateKeyConfigured: boolean;
  privateKeyHint: string;
  /** Edited with the app links, not here. Empty where none is named. */
  bundleIdentifier: string;
  ready: boolean;
}

export interface TenantGooglePlayPaymentSettings {
  enabled: boolean;
  serviceAccountEmail: string;
  serviceAccountKeyConfigured: boolean;
  serviceAccountKeyHint: string;
  /** Edited with the app links, not here. Empty where none is named. */
  packageName: string;
  ready: boolean;
}

export interface TenantStorePaymentSettings {
  appPurchaseRoute: AppPurchaseRouteValue;
  appStore: TenantAppStorePaymentSettings;
  googlePlay: TenantGooglePlayPaymentSettings;
}

export type StoreStatus = "disabled" | "incomplete" | "ready" | "unset";

/**
 * Where one store stands. A store that is on but not ready is missing its key
 * or the app it sells in, and sells nothing until both are there.
 */
export const storeStatus = (store: {
  enabled: boolean;
  keyConfigured: boolean;
  ready: boolean;
}): StoreStatus => {
  if (store.ready) {
    return "ready";
  }
  if (store.enabled) {
    return "incomplete";
  }
  if (store.keyConfigured) {
    return "disabled";
  }
  return "unset";
};
