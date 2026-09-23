import type { TenantTheme } from "@publira/utils/theme-css-variables";

import type { TenantBrandingImage } from "#lib/tenant-branding-image";

export type ThemeSettingsFieldErrors = Partial<
  Record<
    | "primaryColor"
    | "secondaryColor"
    | "accentColor"
    | "backgroundColor"
    | "foregroundColor"
    | "surfaceColor"
    | "surfaceForegroundColor"
    | "serifFontFamily"
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
    | "sansFontFamily"
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
      theme: TenantTheme;
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
