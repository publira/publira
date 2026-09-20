import type { Locale } from "@publira/i18n";
import { z } from "zod";

import { boundedIntFormSchema } from "#lib/form-schemas";
import { getMessagesFor } from "#lib/messages";

/**
 * The largest limit the API can carry (`int32`). The server sets no lower
 * ceiling of its own, and neither does the form.
 */
const MAX_LIMIT = 2_147_483_647;

/** Mirrors `platformpolicy.MaxDuplicateCommentWindow` (one week). */
const MAX_DUPLICATE_COMMENT_WINDOW_MINUTES = 10_080;

/** Mirrors `retention.MaxDays`. */
const MAX_RETENTION_DAYS = 36_500;

type Translate = Awaited<ReturnType<typeof getMessagesFor>>;

/**
 * The revision the form was rendered at, sent back so the server can refuse a
 * save based on values another operator has since replaced.
 */
const revisionSchema = (t: Translate) =>
  z.preprocess(
    (value) => (typeof value === "string" ? value.trim() : ""),
    z
      .string()
      .regex(/^\d{1,19}$/u, t("platform.policy.revision_invalid"))
      .transform(BigInt)
  );

const limitSchema = (t: Translate, setting: string) =>
  boundedIntFormSchema(t("platform.policy.limit_invalid", { setting }), {
    max: MAX_LIMIT,
    maxMessage: t("platform.policy.limit_too_large", { setting }),
    min: 1,
  });

interface WindowPair<K extends string> {
  day: K;
  message: string;
  short: K;
}

/**
 * The server refuses a daily limit below its shorter window, because such a
 * burst rule can never bind. The check is repeated here so the operator hears
 * which setting it is.
 */
const refineWindowPairs =
  <K extends string>(pairs: WindowPair<K>[]) =>
  (value: Record<K, number>, ctx: z.RefinementCtx) => {
    for (const { day, message, short } of pairs) {
      if (value[day] < value[short]) {
        ctx.addIssue({ code: "custom", message, path: [day] });
      }
    }
  };

export const securityPolicyFormFields = {
  mailPerAddressPerDay: {
    kind: "value",
    name: "mail_requests_per_address_per_day",
  },
  mailPerAddressPerHour: {
    kind: "value",
    name: "mail_requests_per_address_per_hour",
  },
  mailPerSourcePerDay: {
    kind: "value",
    name: "mail_requests_per_source_per_day",
  },
  mailPerSourcePerHour: {
    kind: "value",
    name: "mail_requests_per_source_per_hour",
  },
  mfaRequiredForTenantAdmin: {
    kind: "value",
    name: "mfa_required_for_tenant_admin",
  },
  passwordVerificationPerDay: {
    kind: "value",
    name: "password_verification_per_day",
  },
  passwordVerificationPerMinute: {
    kind: "value",
    name: "password_verification_per_minute",
  },
  revision: "value",
} as const;

export const securityPolicyFormSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);
  const password = t("platform.policy.security.password_title");
  const perAddress = t("platform.policy.security.mail_per_address_legend");
  const perSource = t("platform.policy.security.mail_per_source_legend");

  return z
    .object({
      mailPerAddressPerDay: limitSchema(t, perAddress),
      mailPerAddressPerHour: limitSchema(t, perAddress),
      mailPerSourcePerDay: limitSchema(t, perSource),
      mailPerSourcePerHour: limitSchema(t, perSource),
      mfaRequiredForTenantAdmin: z.preprocess(
        (value) => value === "on",
        z.boolean()
      ),
      passwordVerificationPerDay: limitSchema(t, password),
      passwordVerificationPerMinute: limitSchema(t, password),
      revision: revisionSchema(t),
    })
    .superRefine(
      refineWindowPairs([
        {
          day: "passwordVerificationPerDay",
          message: t("platform.policy.day_below_minute", { setting: password }),
          short: "passwordVerificationPerMinute",
        },
        {
          day: "mailPerAddressPerDay",
          message: t("platform.policy.day_below_hour", { setting: perAddress }),
          short: "mailPerAddressPerHour",
        },
        {
          day: "mailPerSourcePerDay",
          message: t("platform.policy.day_below_hour", { setting: perSource }),
          short: "mailPerSourcePerHour",
        },
      ])
    );
};

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

export const communityLimitsFormSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);
  const commentPost = t("platform.policy.community.comment_post_legend");
  const commentReport = t("platform.policy.community.comment_report_legend");
  const perAccount = t("platform.policy.community.contact_per_account_legend");
  const perClient = t("platform.policy.community.contact_per_client_legend");
  const episodeRating = t("platform.policy.community.episode_rating_legend");
  const viewerPreferences = t(
    "platform.policy.community.viewer_preferences_legend"
  );

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
      duplicateCommentWindowMinutes: boundedIntFormSchema(
        t("platform.policy.community.duplicate_window_invalid"),
        { max: MAX_DUPLICATE_COMMENT_WINDOW_MINUTES, min: 1 }
      ),
      episodeRatingPerDay: limitSchema(t, episodeRating),
      episodeRatingPerMinute: limitSchema(t, episodeRating),
      revision: revisionSchema(t),
      viewerPreferencesPerDay: limitSchema(t, viewerPreferences),
      viewerPreferencesPerMinute: limitSchema(t, viewerPreferences),
    })
    .superRefine(
      refineWindowPairs([
        {
          day: "commentPostPerDay",
          message: t("platform.policy.day_below_minute", {
            setting: commentPost,
          }),
          short: "commentPostPerMinute",
        },
        {
          day: "commentReportPerDay",
          message: t("platform.policy.day_below_minute", {
            setting: commentReport,
          }),
          short: "commentReportPerMinute",
        },
        {
          day: "episodeRatingPerDay",
          message: t("platform.policy.day_below_minute", {
            setting: episodeRating,
          }),
          short: "episodeRatingPerMinute",
        },
        {
          day: "contactPerAccountPerDay",
          message: t("platform.policy.day_below_hour", { setting: perAccount }),
          short: "contactPerAccountPerHour",
        },
        {
          day: "contactPerClientPerDay",
          message: t("platform.policy.day_below_hour", { setting: perClient }),
          short: "contactPerClientPerHour",
        },
        {
          day: "viewerPreferencesPerDay",
          message: t("platform.policy.day_below_minute", {
            setting: viewerPreferences,
          }),
          short: "viewerPreferencesPerMinute",
        },
      ])
    );
};

export const retentionDefaultsFormFields = {
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

export const retentionDefaultsFormSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);
  const days = (setting: string) =>
    boundedIntFormSchema(
      t("platform.policy.retention.days_invalid", { setting }),
      { max: MAX_RETENTION_DAYS, min: 1 }
    );

  return z.object({
    contentEventDays: days(t("platform.policy.retention.content_event_label")),
    dailyRankingSnapshotDays: days(
      t("platform.policy.retention.daily_ranking_label")
    ),
    revision: revisionSchema(t),
    weeklyRankingSnapshotDays: days(
      t("platform.policy.retention.weekly_ranking_label")
    ),
    withdrawnCommentDays: days(
      t("platform.policy.retention.withdrawn_comment_label")
    ),
  });
};
