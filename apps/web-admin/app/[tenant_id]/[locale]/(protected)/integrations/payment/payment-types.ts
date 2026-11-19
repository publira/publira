import type { StorePaymentSettingsFieldErrors } from "#lib/store-payment-settings";

/** Keyed by `credential_<field name>`, the name each credential posts as. */
export type TenantPaymentSettingsFieldErrors = Partial<Record<string, string>>;

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

export type TenantPaymentProviderRemoveFormState =
  | { ok: true; message: string }
  | { ok: false; message: string }
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

export type TenantTipSettingsFormState =
  | {
      ok: true;
      message: string;
    }
  | {
      ok: false;
      message: string;
      fieldErrors?: { tipAmounts?: string };
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
