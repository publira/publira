import type { TenantSmtpSettings } from "../../../../lib/email-settings";
import type { TenantThemeSettings } from "../../../../lib/theme-settings";

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

export type ThemeSettingsFieldErrors = Partial<
  Record<"primaryColor" | "secondaryColor" | "accentColor", string>
>;

export type ThemeSettingsActionState =
  | {
      ok: true;
      message: string;
      theme: TenantThemeSettings;
    }
  | {
      ok: false;
      message: string;
      fieldErrors?: ThemeSettingsFieldErrors;
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
