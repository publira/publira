import type { GetTenantResponse } from "@publira/api-client/public/tenant";
import { AppPurchaseRoute } from "@publira/api-client/public/types";

import type { EpisodePurchaseSurface } from "./catalog";

/**
 * Whether the tenant's app can sell an episode right now, on each platform it
 * runs on. An episode the site sends to the app links a platform's listing
 * only where this is true: the app there is the one that sells it.
 */
export interface TenantAppPayments {
  appStore: boolean;
  googlePlay: boolean;
}

/**
 * Whether the app sells on either platform: what decides that an episode the
 * site cannot sell is pointed to the app rather than treated as one nobody can
 * buy.
 */
export const appAcceptsPayments = (payments: TenantAppPayments): boolean =>
  payments.appStore || payments.googlePlay;

/**
 * Whether the tenant can sell an episode right now through the site's own
 * checkout, and in its app on either platform.
 */
export interface TenantSales {
  app: boolean;
  web: boolean;
}

export const toTenantSales = ({
  acceptsPayments,
  appPayments,
}: {
  acceptsPayments: boolean;
  appPayments: TenantAppPayments;
}): TenantSales => ({
  app: appAcceptsPayments(appPayments),
  web: acceptsPayments,
});

/**
 * Where the site sends a reader to buy an episode: its own checkout wherever
 * it may sell the episode and takes payments, the app where the site cannot
 * sell it and the app can, and nowhere while neither can. An episode sold on
 * both is bought on the site the reader is already on whenever it can be, and
 * in the app only while the site takes no payments.
 */
export type EpisodeSaleDestination = "app" | "none" | "web";

export const episodeSaleDestination = (
  purchaseSurface: EpisodePurchaseSurface,
  sales: TenantSales
): EpisodeSaleDestination => {
  if (purchaseSurface !== "app" && sales.web) {
    return "web";
  }
  if (purchaseSurface !== "web" && sales.app) {
    return "app";
  }
  return "none";
};

/**
 * The generated `GetTenantResponse` fields {@link toTenantAppPayments} reads.
 */
type RawTenantAppPayments = Pick<
  GetTenantResponse,
  | "acceptsAppStorePayments"
  | "acceptsGooglePlayPayments"
  | "acceptsPayments"
  | "appPurchaseRoute"
>;

/**
 * What has to be ready for the app to sell depends on which purchase it
 * offers. Through the external checkout it buys where the site does, so it
 * sells on both platforms exactly when the site takes payments. Through the
 * stores it needs no web payment provider, only its own platform's store, and
 * the app on a platform whose store is not ready offers no purchase.
 *
 * `APP_PURCHASE_ROUTE_UNSPECIFIED` is never answered, and reads as the external
 * checkout, which is what a tenant that has chosen nothing sells through.
 */
export const toTenantAppPayments = ({
  acceptsAppStorePayments,
  acceptsGooglePlayPayments,
  acceptsPayments,
  appPurchaseRoute,
}: RawTenantAppPayments): TenantAppPayments => {
  if (appPurchaseRoute === AppPurchaseRoute.STORE) {
    return {
      appStore: acceptsAppStorePayments === true,
      googlePlay: acceptsGooglePlayPayments === true,
    };
  }
  return {
    appStore: acceptsPayments === true,
    googlePlay: acceptsPayments === true,
  };
};
