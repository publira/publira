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
          ready: true,
          secretKeyConfigured: true,
          webhookSecretConfigured: true,
        })
      )
    ).toBe("ready");
  });

  it("reports missing configuration when it is enabled without every secret", () => {
    expect(paymentSettingsStatus(settings({ enabled: true }))).toBe(
      "incomplete"
    );
  });

  it("reports it as disabled when the secrets are there but it is off", () => {
    expect(paymentSettingsStatus(settings({ secretKeyConfigured: true }))).toBe(
      "disabled"
    );
  });

  it("reports it as unconfigured when there is nothing", () => {
    expect(paymentSettingsStatus(emptyTenantPaymentSettings)).toBe("unset");
  });
});
