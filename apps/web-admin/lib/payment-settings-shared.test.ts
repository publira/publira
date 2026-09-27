import { describe, expect, it } from "vitest";

import {
  emptyTenantPaymentSettings,
  paymentSettingsStatus,
} from "./payment-settings-shared";
import type { TenantPaymentSettings } from "./payment-settings-shared";

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
