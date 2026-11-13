import { describe, expect, it } from "vitest";

import {
  emptyTenantPaymentSettings,
  paymentProviderCurrencies,
  paymentProviderStatus,
  paymentSettingsStatus,
  subscriptionPlanProvider,
} from "./payment-settings-shared";
import type {
  PaymentProvider,
  TenantPaymentProviderSettings,
  TenantPaymentProviders,
  TenantPaymentSettings,
} from "./payment-settings-shared";

const settings = (
  overrides: Partial<TenantPaymentSettings>
): TenantPaymentSettings => ({
  ...emptyTenantPaymentSettings,
  ...overrides,
});

describe("paymentSettingsStatus", () => {
  it("reports a ready configuration as usable", () => {
    expect(
      paymentSettingsStatus(
        settings({
          enabled: true,
          fields: [
            {
              configured: true,
              hint: "sk_test_••••••••KLMN",
              name: "secret_key",
            },
            {
              configured: true,
              hint: "whsec_••••••••WXYZ",
              name: "webhook_secret",
            },
          ],
          provider: "stripe",
          ready: true,
        })
      )
    ).toBe("ready");
  });

  it("reports missing configuration when it is enabled without every credential", () => {
    expect(paymentSettingsStatus(settings({ enabled: true }))).toBe(
      "incomplete"
    );
  });

  it("reports it as disabled when a credential is there but it is off", () => {
    expect(
      paymentSettingsStatus(
        settings({
          fields: [
            {
              configured: true,
              hint: "sk_test_••••••••KLMN",
              name: "secret_key",
            },
            { configured: false, hint: "", name: "webhook_secret" },
          ],
          provider: "stripe",
        })
      )
    ).toBe("disabled");
  });

  it("reports declared but unstored fields as unconfigured", () => {
    expect(
      paymentSettingsStatus(
        settings({
          fields: [{ configured: false, hint: "", name: "secret_key" }],
          provider: "stripe",
        })
      )
    ).toBe("unset");
  });

  it("reports it as unconfigured when there is nothing", () => {
    expect(paymentSettingsStatus(emptyTenantPaymentSettings)).toBe("unset");
  });
});

const provider = (
  id: string,
  currencies: string[],
  subscriptions: boolean
): PaymentProvider => ({
  currencies,
  displayName: id,
  fields: [],
  id,
  subscriptions,
  webhookPath: `/api/v1/webhook/payment/${id}`,
});

const stripe = provider("stripe", ["JPY", "USD"], true);
const payjp = provider("payjp", ["JPY"], false);
const examplePay = provider("examplepay", ["USD", "JPY"], true);

const held = (
  id: string,
  overrides: Partial<TenantPaymentProviderSettings> = {}
): TenantPaymentProviderSettings => ({
  enabled: true,
  fields: [],
  provider: id,
  ready: true,
  retired: false,
  ...overrides,
});

const holding = (
  providers: TenantPaymentProviderSettings[],
  overrides: Partial<TenantPaymentProviders> = {}
): TenantPaymentProviders => ({
  currency: "JPY",
  currencyLocked: false,
  providers,
  ...overrides,
});

describe("paymentProviderStatus", () => {
  it("puts a removed provider before whatever else it is", () => {
    expect(paymentProviderStatus(held("stripe", { retired: true }))).toBe(
      "removed"
    );
  });

  it("tells a ready, an incomplete, and a disabled provider apart", () => {
    expect(paymentProviderStatus(held("stripe"))).toBe("ready");
    expect(paymentProviderStatus(held("stripe", { ready: false }))).toBe(
      "incomplete"
    );
    expect(
      paymentProviderStatus(held("stripe", { enabled: false, ready: false }))
    ).toBe("disabled");
  });
});

describe("paymentProviderCurrencies", () => {
  const registered = [stripe, payjp, examplePay];

  it("offers what the provider charges in while it is the only one", () => {
    expect(
      paymentProviderCurrencies(stripe, holding([held("stripe")]), registered)
    ).toEqual(["JPY", "USD"]);
  });

  it("offers only what every other provider the tenant sells through charges in", () => {
    expect(
      paymentProviderCurrencies(
        stripe,
        holding([held("stripe"), held("payjp", { ready: false })]),
        registered
      )
    ).toEqual(["JPY"]);
  });

  it("holds a removed provider to no currency", () => {
    expect(
      paymentProviderCurrencies(
        stripe,
        holding([held("payjp", { retired: true })]),
        registered
      )
    ).toEqual(["JPY", "USD"]);
  });

  it("offers the tenant's currency alone once it is locked", () => {
    expect(
      paymentProviderCurrencies(
        examplePay,
        holding([held("stripe")], { currency: "USD", currencyLocked: true }),
        registered
      )
    ).toEqual(["USD"]);
    expect(
      paymentProviderCurrencies(
        payjp,
        holding([held("stripe")], { currency: "USD", currencyLocked: true }),
        registered
      )
    ).toEqual([]);
  });
});

describe("subscriptionPlanProvider", () => {
  const registered = [stripe, payjp, examplePay];

  it("is the first ready provider that takes recurring payments", () => {
    expect(
      subscriptionPlanProvider(
        holding([held("payjp"), held("examplepay"), held("stripe")]),
        registered
      )
    ).toBe("examplepay");
  });

  it("passes over one that is not ready or was removed", () => {
    expect(
      subscriptionPlanProvider(
        holding([
          held("examplepay", { ready: false }),
          held("stripe", { retired: true }),
        ]),
        registered
      )
    ).toBeUndefined();
  });
});
