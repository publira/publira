import type { AdminMessageKey } from "./messages";

export const PAYMENT_PROVIDER_STRIPE = "stripe";

export const SECRET_UPDATE_MODE_UNCHANGED = 1;
export const SECRET_UPDATE_MODE_REPLACE = 2;

export interface TenantPaymentSettings {
  provider: string;
  enabled: boolean;
  secretKeyConfigured: boolean;
  webhookSecretConfigured: boolean;
  secretKeyHint: string;
  webhookSecretHint: string;
  ready: boolean;
}

export const emptyTenantPaymentSettings: TenantPaymentSettings = {
  enabled: false,
  provider: PAYMENT_PROVIDER_STRIPE,
  ready: false,
  secretKeyConfigured: false,
  secretKeyHint: "",
  webhookSecretConfigured: false,
  webhookSecretHint: "",
};

export type PaymentSettingsStatus =
  | "disabled"
  | "incomplete"
  | "ready"
  | "unset";

export const paymentSettingsStatus = (
  settings: TenantPaymentSettings
): PaymentSettingsStatus => {
  if (settings.ready) {
    return "ready";
  }
  if (settings.enabled) {
    return "incomplete";
  }
  if (settings.secretKeyConfigured || settings.webhookSecretConfigured) {
    return "disabled";
  }
  return "unset";
};

export const paymentSettingsStatusCopy: Record<
  PaymentSettingsStatus,
  { descriptionKey: AdminMessageKey; labelKey: AdminMessageKey }
> = {
  disabled: {
    descriptionKey: "admin.settings.payment.status.disabled_description",
    labelKey: "admin.settings.payment.status.disabled",
  },
  incomplete: {
    descriptionKey: "admin.settings.payment.status.incomplete_description",
    labelKey: "admin.settings.payment.status.incomplete",
  },
  ready: {
    descriptionKey: "admin.settings.payment.status.ready_description",
    labelKey: "admin.settings.payment.status.ready",
  },
  unset: {
    descriptionKey: "admin.settings.payment.status.unset_description",
    labelKey: "admin.settings.payment.status.unset",
  },
};
