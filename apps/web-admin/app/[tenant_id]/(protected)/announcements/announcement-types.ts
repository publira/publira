import type { Locale } from "@publira/i18n";

import type { CursorPageTokens } from "#lib/cursor-page";

/**
 * Which readers an announcement's notification reaches: those whose
 * notification preferences take announcements, or every reader whatever their
 * preferences say.
 */
export type AnnouncementDeliveryValue = "everyone" | "preferred";

/** Whether a subscription condition asks for a live subscription or one that ended. */
export type AnnouncementSubscriptionStateValue = "active" | "ended";

/**
 * One condition of a targeted announcement's audience. Each type appears at
 * most once in an audience, and a reader has to meet every one.
 */
export type AnnouncementAudienceCondition =
  | { type: "follows_series"; seriesPublicId: string }
  | { type: "bought_series_episode"; seriesPublicId: string }
  | {
      type: "subscription";
      /** Empty for a subscription to any plan. */
      planPublicId: string;
      state: AnnouncementSubscriptionStateValue;
    }
  | { type: "never_purchased" }
  | { type: "last_read_days_ago"; days: number }
  | { type: "signed_up_within_days"; days: number }
  | { type: "locale"; locale: Locale }
  | { type: "has_mobile_push_device" };

export type AnnouncementConditionType = AnnouncementAudienceCondition["type"];

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
  /** Every language's title and body, the form's starting values on edit. */
  translations: readonly AnnouncementTranslation[];
  /** The readers it is addressed to; `null` addresses everyone who opens the site. */
  audience: readonly AnnouncementAudienceCondition[] | null;
  /**
   * The instant it was asked to go out at. Empty on one posted before an
   * announcement could be scheduled.
   */
  deliverAt: string;
  /** The instant it went out. Empty while it is scheduled, the one time it can be edited. */
  deliveredAt: string;
}

/** One language's title and body of an announcement as it was stored. */
export interface AnnouncementTranslation {
  locale: Locale;
  title: string;
  body: string;
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

/**
 * What a refused announcement says about one field: `deliverAt`, `audience`
 * for the set of conditions, or `audience.<type>` for one condition's inputs,
 * the names `ActionForm.FieldError` shows each under.
 */
export type AnnouncementFieldErrors = Partial<Record<string, string>>;

export type CreateAnnouncementActionState =
  | {
      ok: false;
      message: string;
      fieldErrors?: AnnouncementFieldErrors;
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
