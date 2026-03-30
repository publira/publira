import type { TenantSmtpSettings } from "../../../../lib/email-settings";

export type SiteSettingsActionState =
  | {
      ok: true;
      message: string;
    }
  | {
      ok: false;
      message: string;
    }
  | null;

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
