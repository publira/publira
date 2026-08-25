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
  { description: string; label: string }
> = {
  disabled: {
    description:
      "シークレットは保存されていますが、決済は無効です。Checkout と Webhook は動きません。",
    label: "無効",
  },
  incomplete: {
    description:
      "有効ですがシークレットが揃っていないため、決済は開始されません。",
    label: "設定不足",
  },
  ready: {
    description:
      "有料エピソードの Checkout と Webhook にこのテナントの設定が使われます。",
    label: "利用可能",
  },
  unset: {
    description:
      "Stripe のシークレットを登録すると、有料エピソードの決済を開始できます。",
    label: "未設定",
  },
};
