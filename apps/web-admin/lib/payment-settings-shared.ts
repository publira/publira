/** One credential a payment provider declares, as the server registers it. */
export interface PaymentCredentialField {
  name: string;
  /** Stored encrypted and answered back only as a masked hint. */
  secret: boolean;
  /** Handed to the reader's browser, so its value is shown as stored. */
  public: boolean;
  required: boolean;
}

export interface PaymentProvider {
  id: string;
  displayName: string;
  fields: PaymentCredentialField[];
  /** The storefront path the provider's notifications are received on. */
  webhookPath: string;
}

export interface PaymentCredentialFieldState {
  name: string;
  configured: boolean;
  /** The masked value of a secret field and the value itself of any other. */
  hint: string;
}

export interface TenantPaymentSettings {
  /** Empty until the tenant saves a provider. */
  provider: string;
  enabled: boolean;
  /** One entry per field the stored provider declares. */
  fields: PaymentCredentialFieldState[];
  ready: boolean;
}

export const emptyTenantPaymentSettings: TenantPaymentSettings = {
  enabled: false,
  fields: [],
  provider: "",
  ready: false,
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
  if (settings.fields.some((field) => field.configured)) {
    return "disabled";
  }
  return "unset";
};
