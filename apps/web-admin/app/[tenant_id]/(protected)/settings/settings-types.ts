import type { Locale } from "@publira/i18n";

import type { TenantAgeVerification } from "#lib/tenant-age-verification-shared";
import type { TenantCommentMode } from "#lib/tenant-comment-settings-shared";

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

export type TenantCommentSettingsActionState =
  | {
      ok: true;
      message: string;
      commentMode: TenantCommentMode;
      autoHideReportThreshold: number;
    }
  | {
      ok: false;
      message: string;
    }
  | null;

export type TenantAgeVerificationActionState =
  | {
      ok: true;
      message: string;
      ageVerification: TenantAgeVerification;
    }
  | {
      ok: false;
      message: string;
    }
  | null;

export type TenantLegalPagesActionState =
  | {
      ok: true;
      message: string;
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
