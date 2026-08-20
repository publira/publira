import type { Locale } from "@publira/utils/i18n";
import type { TenantThemeColors } from "@publira/utils/theme-css-variables";

import type { TenantSmtpSettings } from "#lib/email-settings";
import type { TenantBrandingImage } from "#lib/tenant-branding-image";

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
  Record<
    | "primaryColor"
    | "secondaryColor"
    | "accentColor"
    | "backgroundColor"
    | "foregroundColor"
    | "surfaceColor"
    | "surfaceForegroundColor"
    | "cardColor"
    | "cardForegroundColor"
    | "popoverColor"
    | "popoverForegroundColor"
    | "primaryForegroundColor"
    | "secondaryForegroundColor"
    | "accentForegroundColor"
    | "mutedColor"
    | "mutedForegroundColor"
    | "borderColor"
    | "inputColor"
    | "ringColor"
    | "successColor"
    | "successForegroundColor"
    | "warningColor"
    | "warningForegroundColor"
    | "destructiveColor"
    | "destructiveForegroundColor"
    | "infoColor"
    | "infoForegroundColor",
    string
  >
>;

export type ThemeSettingsActionState =
  | {
      ok: true;
      message: string;
      theme: TenantThemeColors;
    }
  | {
      ok: false;
      message: string;
      fieldErrors?: ThemeSettingsFieldErrors;
    }
  | null;

export type TenantIconActionState =
  | {
      ok: true;
      message: string;
      icon: TenantBrandingImage | null;
    }
  | {
      ok: false;
      message: string;
    }
  | null;

export type TenantLogoActionState =
  | {
      ok: true;
      message: string;
      logo: TenantBrandingImage | null;
    }
  | {
      ok: false;
      message: string;
    }
  | null;

export type TenantTimezoneActionState =
  | {
      ok: true;
      message: string;
      timezone: string;
    }
  | {
      ok: false;
      message: string;
    }
  | null;

export type TenantDefaultLocaleActionState =
  | {
      ok: true;
      message: string;
      defaultLocale: Locale;
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

export type EmailChangeActionState =
  | {
      ok: true;
      message: string;
    }
  | {
      ok: false;
      message: string;
    }
  | null;
