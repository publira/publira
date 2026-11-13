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
  /** ISO 4217 codes of the currencies the provider charges in. */
  currencies: string[];
  /** Whether it takes recurring payments, which a subscription plan needs. */
  subscriptions: boolean;
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
  /**
   * ISO 4217 code of the currency the tenant sells in, the platform's default
   * before one is saved. Empty only while the settings could not be read.
   */
  currency: string;
  /** Whether the tenant has a purchase, which keeps the currency as it is. */
  currencyLocked: boolean;
}

export const emptyTenantPaymentSettings: TenantPaymentSettings = {
  currency: "",
  currencyLocked: false,
  enabled: false,
  fields: [],
  provider: "",
  ready: false,
};

/** One payment provider the tenant holds, without its secrets. */
export interface TenantPaymentProviderSettings {
  provider: string;
  enabled: boolean;
  ready: boolean;
  /** One entry per field the provider declares. */
  fields: PaymentCredentialFieldState[];
  /**
   * Removed by the tenant and kept for what it already took: it starts no
   * checkout, and saving it adds it back.
   */
  retired: boolean;
}

/** Every payment provider the tenant holds, in the order it added them. */
export interface TenantPaymentProviders {
  providers: TenantPaymentProviderSettings[];
  /**
   * ISO 4217 code of the currency the tenant sells in, which every provider
   * it holds and has not removed charges in.
   */
  currency: string;
  /** Whether the tenant has a purchase, which keeps the currency as it is. */
  currencyLocked: boolean;
}

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

export type PaymentProviderStatus =
  | "disabled"
  | "incomplete"
  | "ready"
  | "removed";

/** Where one provider the tenant holds stands. */
export const paymentProviderStatus = (
  settings: Pick<TenantPaymentProviderSettings, "enabled" | "ready" | "retired">
): PaymentProviderStatus => {
  if (settings.retired) {
    return "removed";
  }

  if (settings.ready) {
    return "ready";
  }

  return settings.enabled ? "incomplete" : "disabled";
};

/**
 * The currencies `provider` could sell in beside the providers the tenant
 * already sells through: the ones it and every other provider it holds and has
 * not removed charge in, in the order `provider` declares them. Once the
 * currency is locked, only the tenant's own currency, where they all charge in
 * it.
 */
export const paymentProviderCurrencies = (
  provider: PaymentProvider,
  held: TenantPaymentProviders,
  registered: readonly PaymentProvider[]
): string[] => {
  const byId = new Map(registered.map((other) => [other.id, other]));
  const others: PaymentProvider[] = [];

  for (const settings of held.providers) {
    const other = byId.get(settings.provider);

    if (other && !settings.retired && other.id !== provider.id) {
      others.push(other);
    }
  }

  return provider.currencies.filter(
    (currency) =>
      (!held.currencyLocked || currency === held.currency) &&
      others.every((other) => other.currencies.includes(currency))
  );
};

/**
 * The provider the tenant's subscription plans are sold through, as the server
 * picks it: the first one it holds that is ready, has not been removed, and
 * takes recurring payments. Undefined while none is.
 */
export const subscriptionPlanProvider = (
  held: TenantPaymentProviders,
  registered: readonly PaymentProvider[]
): string | undefined =>
  held.providers.find(
    (settings) =>
      settings.ready &&
      !settings.retired &&
      registered.some(
        (candidate) =>
          candidate.id === settings.provider && candidate.subscriptions
      )
  )?.provider;
