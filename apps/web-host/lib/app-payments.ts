import type { GetTenantResponse } from "@publira/api-client/public/tenant";
import { AppPurchaseRoute } from "@publira/api-client/public/types";

/**
 * Whether the tenant's app can sell an episode right now, on each platform it
 * runs on. An episode sold in the app alone sends the reader to a platform's
 * listing only where this is true: the app there is the one that sells it.
 */
export interface TenantAppPayments {
  appStore: boolean;
  googlePlay: boolean;
}

/**
 * Whether the app sells on either platform: what decides that an episode sold
 * there alone is pointed to the app rather than treated as one nobody can buy.
 */
export const appAcceptsPayments = (payments: TenantAppPayments): boolean =>
  payments.appStore || payments.googlePlay;

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
