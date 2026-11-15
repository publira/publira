// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { checkoutScriptOf, paidyPayload } from "./checkout-scripts";
import type {
  CheckoutBuyer,
  JsonObject,
  PaidyClosedData,
  PaidyGlobal,
} from "./checkout-scripts";

const buyer: CheckoutBuyer = {
  addressLine: "1-2-3 Jingumae",
  building: "Omotesando Building 401",
  city: "Shibuya-ku",
  familyName: "Yamada",
  givenName: "Taro",
  postalCode: "150-0001",
  prefecture: "Tokyo",
};

const payload = {
  amount: 300,
  buyer: { email: "reader@example.com" },
  buyer_data: { ltv: 1200, user_id: "R1" },
  currency: "JPY",
};

/**
 * A stand-in for paidy.js: `launch` closes the checkout at once with what the
 * test hands it, as the reader leaving Paidy's checkout would.
 */
const fakePaidy = (callbackData: PaidyClosedData) => {
  const launched = vi.fn<(launchPayload: JsonObject) => void>();

  const configure = vi.fn<PaidyGlobal["configure"]>((config) => ({
    launch: (launchPayload) => {
      launched(launchPayload);
      config.closed(callbackData);
    },
  }));

  window.Paidy = { configure };

  return { configure, launched };
};

const launchPaidy = () => {
  const paidy = checkoutScriptOf("paidy");

  if (!paidy) {
    throw new Error("no Paidy script");
  }

  return paidy.launch({
    buyer,
    payload,
    credentials: { public_key: "pk_test_0001" },
  });
};

describe("paidyPayload", () => {
  it("adds the reader's name and address to what the server answered", () => {
    const address = {
      city: "Shibuya-ku",
      line1: "Omotesando Building 401",
      line2: "1-2-3 Jingumae",
      state: "Tokyo",
      zip: "150-0001",
    };

    expect(paidyPayload({ buyer, payload })).toStrictEqual({
      amount: 300,
      buyer: { email: "reader@example.com", name1: "Yamada Taro" },
      buyer_data: { billing_address: address, ltv: 1200, user_id: "R1" },
      currency: "JPY",
      shipping_address: address,
    });
  });

  it("leaves out a building the reader left empty", () => {
    const launched = paidyPayload({
      buyer: { ...buyer, building: "" },
      payload: {},
    });

    expect(launched.shipping_address).toStrictEqual({
      city: "Shibuya-ku",
      line2: "1-2-3 Jingumae",
      state: "Tokyo",
      zip: "150-0001",
    });
    expect(launched.buyer).toStrictEqual({ name1: "Yamada Taro" });
  });
});

describe("the Paidy script", () => {
  afterEach(() => {
    delete window.Paidy;
  });

  it("is configured with the tenant's public key", async () => {
    const { configure, launched } = fakePaidy({
      id: "pay_0001",
      status: "authorized",
    });

    await launchPaidy();

    expect(configure).toHaveBeenCalledWith(
      expect.objectContaining({ api_key: "pk_test_0001" })
    );
    expect(launched).toHaveBeenCalledWith(paidyPayload({ buyer, payload }));
  });

  it.each(["authorized", "AUTHORIZED"])(
    "answers a payment the script reports %s",
    async (status) => {
      fakePaidy({ id: "pay_0001", status });

      await expect(launchPaidy()).resolves.toStrictEqual({
        authorized: true,
        paymentId: "pay_0001",
      });
    }
  );

  it.each([
    ["closed", { status: "closed" }],
    ["rejected", { id: "pay_0001", status: "rejected" }],
    ["authorized without a payment", { status: "authorized" }],
  ])("answers no payment for a checkout %s", async (_name, callbackData) => {
    fakePaidy(callbackData);

    await expect(launchPaidy()).resolves.toStrictEqual({ authorized: false });
  });

  it("rejects before the script has loaded", async () => {
    await expect(launchPaidy()).rejects.toThrow("paidy.js has not loaded");
  });
});

describe("checkoutScriptOf", () => {
  it.each(["stripe", "toString", ""])("knows no script of %j", (providerId) => {
    expect(checkoutScriptOf(providerId)).toBeNull();
  });
});
