import { AppPurchaseRoute } from "@publira/api-client/public/types";
import { describe, expect, it } from "vitest";

import { appAcceptsPayments, toTenantAppPayments } from "./app-payments";

const response = (
  overrides: Partial<Parameters<typeof toTenantAppPayments>[0]>
): Parameters<typeof toTenantAppPayments>[0] => ({
  acceptsAppStorePayments: false,
  acceptsGooglePlayPayments: false,
  acceptsPayments: false,
  appPurchaseRoute: AppPurchaseRoute.EXTERNAL_CHECKOUT,
  ...overrides,
});

describe("toTenantAppPayments", () => {
  describe("through the external checkout", () => {
    it("Sell on both platforms while the site takes payments", () => {
      expect(
        toTenantAppPayments(
          response({
            acceptsAppStorePayments: false,
            acceptsGooglePlayPayments: false,
            acceptsPayments: true,
            appPurchaseRoute: AppPurchaseRoute.EXTERNAL_CHECKOUT,
          })
        )
      ).toEqual({ appStore: true, googlePlay: true });
    });

    it("Sell nowhere while the site cannot take payments", () => {
      expect(
        toTenantAppPayments(
          response({
            acceptsPayments: false,
            appPurchaseRoute: AppPurchaseRoute.EXTERNAL_CHECKOUT,
          })
        )
      ).toEqual({ appStore: false, googlePlay: false });
    });

    it("Read a route the response does not name as the external checkout", () => {
      expect(
        toTenantAppPayments(
          response({
            acceptsPayments: true,
            appPurchaseRoute: AppPurchaseRoute.UNSPECIFIED,
          })
        )
      ).toEqual({ appStore: true, googlePlay: true });
    });
  });

  describe("through the stores", () => {
    it("Sell on the platform whose store is ready without a web payment provider", () => {
      expect(
        toTenantAppPayments(
          response({
            acceptsAppStorePayments: true,
            acceptsGooglePlayPayments: false,
            acceptsPayments: false,
            appPurchaseRoute: AppPurchaseRoute.STORE,
          })
        )
      ).toEqual({ appStore: true, googlePlay: false });
    });

    it("Sell nowhere while no store is ready, even where the site takes payments", () => {
      expect(
        toTenantAppPayments(
          response({
            acceptsAppStorePayments: false,
            acceptsGooglePlayPayments: false,
            acceptsPayments: true,
            appPurchaseRoute: AppPurchaseRoute.STORE,
          })
        )
      ).toEqual({ appStore: false, googlePlay: false });
    });
  });
});

describe("appAcceptsPayments", () => {
  it("Count the app as selling while either platform sells", () => {
    expect(appAcceptsPayments({ appStore: false, googlePlay: true })).toBe(
      true
    );
  });

  it("Count the app as selling nowhere while neither platform does", () => {
    expect(appAcceptsPayments({ appStore: false, googlePlay: false })).toBe(
      false
    );
  });
});
