import type { StorePaymentSettingsFieldErrors } from "#lib/store-payment-settings";

export type TenantPaymentSettingsFieldErrors = Partial<
  Record<"secretKey" | "webhookSecret", string>
>;

export type TenantPaymentSettingsFormState =
  | {
      ok: true;
      message: string;
    }
  | {
      ok: false;
      message: string;
      fieldErrors?: TenantPaymentSettingsFieldErrors;
    }
  | null;

export type TenantPurchaseSettingsFieldErrors = Partial<
  Record<"appStoreUrl" | "googlePlayUrl" | "purchaseAvailability", string>
>;

export type TenantPurchaseSettingsFormState =
  | {
      ok: true;
      message: string;
    }
  | {
      ok: false;
      message: string;
      fieldErrors?: TenantPurchaseSettingsFieldErrors;
    }
  | null;

export type TenantStorePaymentSettingsFormState =
  | {
      ok: true;
      message: string;
    }
  | {
      ok: false;
      message: string;
      fieldErrors?: StorePaymentSettingsFieldErrors;
    }
  | null;
