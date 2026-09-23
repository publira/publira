import type { TenantPaymentSettings } from "#lib/payment-settings";
import type {
  StorePaymentSettingsFieldErrors,
  TenantStorePaymentSettings,
} from "#lib/store-payment-settings";
import type { TenantPurchaseSettings } from "#lib/tenant-purchase-settings";

export type TenantPaymentSettingsFieldErrors = Partial<
  Record<"secretKey" | "webhookSecret", string>
>;

export type TenantPaymentSettingsFormState =
  | {
      ok: true;
      message: string;
      settings: TenantPaymentSettings;
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
      settings: TenantPurchaseSettings;
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
      settings: TenantStorePaymentSettings;
    }
  | {
      ok: false;
      message: string;
      fieldErrors?: StorePaymentSettingsFieldErrors;
    }
  | null;
