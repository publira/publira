import type { TenantSmtpSettings } from "#lib/email-settings";

export type TenantEmailSettingsFormState =
  | {
      ok: true;
      message: string;
      settings: TenantSmtpSettings;
    }
  | {
      ok: false;
      message: string;
    }
  | null;

export type TenantSmtpTestFormState =
  | {
      ok: true;
      message: string;
      recipientEmail: string;
    }
  | {
      ok: false;
      message: string;
    }
  | null;

/**
 * Keyed by the name each control posts as: `domain`, and `credential_<field
 * name>` for a credential the provider declares.
 */
export type TenantInboundEmailSettingsFieldErrors = Partial<
  Record<string, string>
>;

export type TenantInboundEmailSettingsFormState =
  | {
      ok: true;
      message: string;
    }
  | {
      ok: false;
      message: string;
      fieldErrors?: TenantInboundEmailSettingsFieldErrors;
    }
  | null;
