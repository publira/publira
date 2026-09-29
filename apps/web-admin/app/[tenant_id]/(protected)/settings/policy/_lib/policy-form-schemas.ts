import type { Locale } from "@publira/i18n";
import { z } from "zod";

import { optionalBoundedIntFormSchema } from "#lib/form-schemas";
import { getMessagesFor } from "#lib/messages";
import type { TenantCommunityLimitOverrides } from "#lib/tenant-community-limits";
import type { HourDayLimit, MinuteDayLimit } from "#lib/tenant-policy-shared";
import {
  MAX_COMMUNITY_LIMIT,
  MAX_DUPLICATE_COMMENT_WINDOW_MINUTES,
  MAX_RETENTION_DAYS,
  MIN_POLICY_VALUE,
} from "#lib/tenant-policy-shared";
import type { TenantRetentionOverrides } from "#lib/tenant-retention-settings";

type Translate = Awaited<ReturnType<typeof getMessagesFor>>;

/**
 * The revision the form was rendered at, so the server can refuse a stale save.
 * Zero is a tenant that has saved nothing yet, not a missing field.
 */
const revisionSchema = (t: Translate) =>
  z.preprocess(
    (value) => (typeof value === "string" ? value.trim() : ""),
    z
      .string()
      .regex(/^\d{1,19}$/u, t("admin.settings.policy.revision_invalid"))
      .transform(BigInt)
  );

const limitSchema = (t: Translate, setting: string) =>
  optionalBoundedIntFormSchema(
    t("admin.settings.policy.community.validation.limit_invalid", { setting }),
    {
      max: MAX_COMMUNITY_LIMIT,
      maxMessage: t(
        "admin.settings.policy.community.validation.limit_too_large",
        { setting }
      ),
      min: MIN_POLICY_VALUE,
    }
  );

/**
 * Both halves of one limit, or neither: `day` may not be below the shorter
 * window, and a form that submitted one half describes no limit at all.
 */
interface LimitPair<K extends string> {
  day: K;
  dayBelowShortMessage: string;
  incompleteMessage: string;
  short: K;
}

const refineLimitPairs =
  <K extends string>(pairs: LimitPair<K>[]) =>
  (value: Record<K, number | undefined>, ctx: z.RefinementCtx) => {
    for (const {
      day,
      dayBelowShortMessage,
      incompleteMessage,
      short,
    } of pairs) {
      const perDay = value[day];
      const perShort = value[short];
      if ((perDay === undefined) !== (perShort === undefined)) {
        ctx.addIssue({
          code: "custom",
          message: incompleteMessage,
          path: [day],
        });
      } else if (
        perDay !== undefined &&
        perShort !== undefined &&
        perDay < perShort
      ) {
        ctx.addIssue({
          code: "custom",
          message: dayBelowShortMessage,
          path: [day],
        });
      }
    }
  };

const minuteDayLimit = (
  perMinute: number | undefined,
  perDay: number | undefined
): MinuteDayLimit | undefined =>
  perMinute === undefined || perDay === undefined
    ? undefined
    : { perDay, perMinute };

const hourDayLimit = (
  perHour: number | undefined,
  perDay: number | undefined
): HourDayLimit | undefined =>
  perHour === undefined || perDay === undefined
    ? undefined
    : { perDay, perHour };

export const communityLimitsFormFields = {
  commentPostPerDay: { kind: "value", name: "comment_post_per_day" },
  commentPostPerMinute: { kind: "value", name: "comment_post_per_minute" },
  commentReportPerDay: { kind: "value", name: "comment_report_per_day" },
  commentReportPerMinute: { kind: "value", name: "comment_report_per_minute" },
  contactPerAccountPerDay: {
    kind: "value",
    name: "contact_message_per_account_per_day",
  },
  contactPerAccountPerHour: {
    kind: "value",
    name: "contact_message_per_account_per_hour",
  },
  contactPerClientPerDay: {
    kind: "value",
    name: "contact_message_per_client_per_day",
  },
  contactPerClientPerHour: {
    kind: "value",
    name: "contact_message_per_client_per_hour",
  },
  duplicateCommentWindowMinutes: {
    kind: "value",
    name: "duplicate_comment_window_minutes",
  },
  episodeRatingPerDay: { kind: "value", name: "episode_rating_per_day" },
  episodeRatingPerMinute: { kind: "value", name: "episode_rating_per_minute" },
  revision: "value",
  viewerPreferencesPerDay: {
    kind: "value",
    name: "viewer_preferences_per_day",
  },
  viewerPreferencesPerMinute: {
    kind: "value",
    name: "viewer_preferences_per_minute",
  },
} as const;

export interface CommunityLimitsFormValues {
  expectedRevision: bigint;
  overrides: TenantCommunityLimitOverrides;
}

export const communityLimitsFormSchema = async (
  locale: Locale
): Promise<z.ZodType<CommunityLimitsFormValues, unknown>> => {
  const t = await getMessagesFor(locale);
  const commentPost = t("admin.settings.policy.community.comment_post_legend");
  const commentReport = t(
    "admin.settings.policy.community.comment_report_legend"
  );
  const episodeRating = t(
    "admin.settings.policy.community.episode_rating_legend"
  );
  const perAccount = t(
    "admin.settings.policy.community.contact_per_account_legend"
  );
  const perClient = t(
    "admin.settings.policy.community.contact_per_client_legend"
  );
  const viewerPreferences = t(
    "admin.settings.policy.community.viewer_preferences_legend"
  );
  const dayBelowMinute = (setting: string) =>
    t("admin.settings.policy.community.validation.day_below_minute", {
      setting,
    });
  const dayBelowHour = (setting: string) =>
    t("admin.settings.policy.community.validation.day_below_hour", { setting });
  const incomplete = (setting: string) =>
    t("admin.settings.policy.community.validation.incomplete", { setting });

  return z
    .object({
      commentPostPerDay: limitSchema(t, commentPost),
      commentPostPerMinute: limitSchema(t, commentPost),
      commentReportPerDay: limitSchema(t, commentReport),
      commentReportPerMinute: limitSchema(t, commentReport),
      contactPerAccountPerDay: limitSchema(t, perAccount),
      contactPerAccountPerHour: limitSchema(t, perAccount),
      contactPerClientPerDay: limitSchema(t, perClient),
      contactPerClientPerHour: limitSchema(t, perClient),
      duplicateCommentWindowMinutes: optionalBoundedIntFormSchema(
        t("admin.settings.policy.community.validation.window_invalid"),
        {
          max: MAX_DUPLICATE_COMMENT_WINDOW_MINUTES,
          min: MIN_POLICY_VALUE,
        }
      ),
      episodeRatingPerDay: limitSchema(t, episodeRating),
      episodeRatingPerMinute: limitSchema(t, episodeRating),
      revision: revisionSchema(t),
      viewerPreferencesPerDay: limitSchema(t, viewerPreferences),
      viewerPreferencesPerMinute: limitSchema(t, viewerPreferences),
    })
    .superRefine(
      refineLimitPairs([
        {
          day: "commentPostPerDay",
          dayBelowShortMessage: dayBelowMinute(commentPost),
          incompleteMessage: incomplete(commentPost),
          short: "commentPostPerMinute",
        },
        {
          day: "commentReportPerDay",
          dayBelowShortMessage: dayBelowMinute(commentReport),
          incompleteMessage: incomplete(commentReport),
          short: "commentReportPerMinute",
        },
        {
          day: "episodeRatingPerDay",
          dayBelowShortMessage: dayBelowMinute(episodeRating),
          incompleteMessage: incomplete(episodeRating),
          short: "episodeRatingPerMinute",
        },
        {
          day: "contactPerAccountPerDay",
          dayBelowShortMessage: dayBelowHour(perAccount),
          incompleteMessage: incomplete(perAccount),
          short: "contactPerAccountPerHour",
        },
        {
          day: "contactPerClientPerDay",
          dayBelowShortMessage: dayBelowHour(perClient),
          incompleteMessage: incomplete(perClient),
          short: "contactPerClientPerHour",
        },
        {
          day: "viewerPreferencesPerDay",
          dayBelowShortMessage: dayBelowMinute(viewerPreferences),
          incompleteMessage: incomplete(viewerPreferences),
          short: "viewerPreferencesPerMinute",
        },
      ])
    )
    .transform((data) => ({
      expectedRevision: data.revision,
      overrides: {
        commentPost: minuteDayLimit(
          data.commentPostPerMinute,
          data.commentPostPerDay
        ),
        commentReport: minuteDayLimit(
          data.commentReportPerMinute,
          data.commentReportPerDay
        ),
        contactMessagePerAccount: hourDayLimit(
          data.contactPerAccountPerHour,
          data.contactPerAccountPerDay
        ),
        contactMessagePerClient: hourDayLimit(
          data.contactPerClientPerHour,
          data.contactPerClientPerDay
        ),
        duplicateCommentWindowMinutes: data.duplicateCommentWindowMinutes,
        episodeRating: minuteDayLimit(
          data.episodeRatingPerMinute,
          data.episodeRatingPerDay
        ),
        viewerPreferences: minuteDayLimit(
          data.viewerPreferencesPerMinute,
          data.viewerPreferencesPerDay
        ),
      },
    }));
};

export const retentionSettingsFormFields = {
  contentEventDays: { kind: "value", name: "content_event_days" },
  dailyRankingSnapshotDays: {
    kind: "value",
    name: "daily_ranking_snapshot_days",
  },
  revision: "value",
  weeklyRankingSnapshotDays: {
    kind: "value",
    name: "weekly_ranking_snapshot_days",
  },
  withdrawnCommentDays: { kind: "value", name: "withdrawn_comment_days" },
} as const;

export interface RetentionSettingsFormValues {
  expectedRevision: bigint;
  overrides: TenantRetentionOverrides;
}

export const retentionSettingsFormSchema = async (
  locale: Locale
): Promise<z.ZodType<RetentionSettingsFormValues, unknown>> => {
  const t = await getMessagesFor(locale);
  const days = (setting: string) =>
    optionalBoundedIntFormSchema(
      t("admin.settings.policy.retention.validation.days_invalid", { setting }),
      { max: MAX_RETENTION_DAYS, min: MIN_POLICY_VALUE }
    );

  return z
    .object({
      contentEventDays: days(
        t("admin.settings.policy.retention.content_event_legend")
      ),
      dailyRankingSnapshotDays: days(
        t("admin.settings.policy.retention.daily_ranking_legend")
      ),
      revision: revisionSchema(t),
      weeklyRankingSnapshotDays: days(
        t("admin.settings.policy.retention.weekly_ranking_legend")
      ),
      withdrawnCommentDays: days(
        t("admin.settings.policy.retention.withdrawn_comment_legend")
      ),
    })
    .transform(({ revision, ...overrides }) => ({
      expectedRevision: revision,
      overrides,
    }));
};
