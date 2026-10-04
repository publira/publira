import type { TenantEmailRejectionSettings } from "#lib/tenant-email-rejection-settings";

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

/**
 * A save answers the setting as the server stored it — entries trimmed,
 * lowercased, deduplicated, and sorted — so the card shows that rather than
 * what was typed.
 */
export type TenantEmailRejectionActionState =
  | {
      ok: true;
      message: string;
      settings: TenantEmailRejectionSettings;
      disposableDomainListAvailable: boolean;
    }
  | {
      ok: false;
      message: string;
      fieldErrors?: { entries?: string };
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
