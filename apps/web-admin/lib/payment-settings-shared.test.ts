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
  it("ready な設定は利用可能にする", () => {
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

  it("有効でもシークレットが揃っていなければ設定不足にする", () => {
    expect(paymentSettingsStatus(settings({ enabled: true }))).toBe(
      "incomplete"
    );
  });

  it("シークレットはあるが無効なら無効にする", () => {
    expect(paymentSettingsStatus(settings({ secretKeyConfigured: true }))).toBe(
      "disabled"
    );
  });

  it("何もなければ未設定にする", () => {
    expect(paymentSettingsStatus(emptyTenantPaymentSettings)).toBe("unset");
  });
});
