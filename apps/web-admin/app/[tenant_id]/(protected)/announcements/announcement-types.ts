import type { Locale } from "@publira/i18n";

import type { CursorPageTokens } from "#lib/cursor-page";

/**
 * Which readers an announcement's notification reaches: those whose
 * notification preferences take announcements, or every reader whatever their
 * preferences say.
 */
export type AnnouncementDeliveryValue = "everyone" | "preferred";

export interface AnnouncementItem {
  id: string;
  /** The title in the tenant's default language, else the oldest. */
  title: string;
  /** The body in the same language as {@link title}. */
  body: string;
  /** Every language the announcement was written in, in the registry's order. */
  translatedLocales: readonly Locale[];
  linkUrl: string;
  createdAt: string;
  delivery: AnnouncementDeliveryValue;
  /** Whether the site is showing this announcement as a banner right now. */
  pinned: boolean;
  /** The instant the banner stops at. Empty when it has no end. */
  pinnedUntil: string;
}

export type ListAnnouncementsResult = CursorPageTokens &
  (
    | {
        ok: true;
        announcements: AnnouncementItem[];
      }
    | {
        ok: false;
        message: string;
        announcements: AnnouncementItem[];
        /** The API rejected the session — the page raises the login redirect. */
        requiresSignIn: boolean;
      }
  );

export type CreateAnnouncementActionState =
  | {
      ok: false;
      message: string;
    }
  | {
      ok: true;
      message: string;
    }
  | null;

/** One language's title and body of an announcement being written. */
export interface AnnouncementTranslationInput {
  /** Empty names the tenant's default language. */
  locale: Locale | "";
  title: string;
  body: string;
}
