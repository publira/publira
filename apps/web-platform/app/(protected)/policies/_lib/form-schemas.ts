import type { Locale } from "@publira/i18n";
import { z } from "zod";

import {
  boundedIntFormSchema,
  optionalTrimmedString,
  revisionFormSchema,
} from "#lib/form-schemas";
import { getMessagesFor } from "#lib/messages";

/**
 * The largest limit the API can carry (`int32`). The server sets no lower
 * ceiling of its own, and neither does the form.
 */
const MAX_LIMIT = 2_147_483_647;

/** Mirrors `platformpolicy.MaxDuplicateCommentWindow` (one week). */
const MAX_DUPLICATE_COMMENT_WINDOW_MINUTES = 10_080;

/**
 * Mirrors `platformpolicy.MaxDisposableEmailDomainsURLLength`, which Go counts
 * in UTF-8 bytes rather than in the UTF-16 units a JavaScript string has.
 */
const MAX_LIST_URL_BYTES = 2048;

/**
 * The scheme and the start of the host, spelled out. The WHATWG parser behind
 * `URL` also reads `https:host/path` and `https:///host/path` as having a host,
 * where Go's `net/url` finds none, so the raw value is checked rather than the
 * normalized one.
 */
const LIST_URL_START_RE = /^https?:\/\/[^/?#]/iu;

/** A `%` that starts no escape, which `net/url` refuses and WHATWG keeps. */
const BROKEN_ESCAPE_RE = /%(?![0-9a-f]{2})/iu;

/** Mirrors `platformpolicy.validateListURL`: empty, or http(s) with a host. */
const isListUrl = (value: string): boolean =>
  value === "" ||
  (LIST_URL_START_RE.test(value) &&
    !BROKEN_ESCAPE_RE.test(value) &&
    URL.canParse(value) &&
    new URL(value).host !== "");

const fitsListUrlBytes = (value: string): boolean =>
  new TextEncoder().encode(value).length <= MAX_LIST_URL_BYTES;

/**
 * Mirrors `platformpolicy.EdgeReadLimits()`: what the sample edge
 * configurations admit from one client in 10 seconds, which is the least an
 * anonymous read limit may be.
 */
export const MIN_ANONYMOUS_READS = {
  images: 1200,
  publicApi: 320,
  search: 40,
} as const;

/** Mirrors `retention.MaxDays`. */
const MAX_RETENTION_DAYS = 36_500;

/** Mirrors `retention.MinContentEventDays`. */
export const MIN_CONTENT_EVENT_DAYS = 30;

type Translate = Awaited<ReturnType<typeof getMessagesFor>>;

const limitSchema = (t: Translate, setting: string) =>
  boundedIntFormSchema(t("platform.policy.limit_invalid", { setting }), {
    max: MAX_LIMIT,
    maxMessage: t("platform.policy.limit_too_large", { setting }),
    min: 1,
  });

const anonymousReadSchema = (t: Translate, setting: string, min: number) =>
  boundedIntFormSchema(
    t("platform.policy.security.anonymous_read_invalid", { min, setting }),
    {
      max: MAX_LIMIT,
      maxMessage: t("platform.policy.limit_too_large", { setting }),
      min,
    }
  );

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
  anonymousReadImages: {
    kind: "value",
    name: "anonymous_read_images_per_10_seconds",
  },
  anonymousReadPublicApi: {
    kind: "value",
    name: "anonymous_read_public_api_per_10_seconds",
  },
  anonymousReadSearch: {
    kind: "value",
    name: "anonymous_read_search_per_10_seconds",
  },
  apiKeyRequestPerDay: {
    kind: "value",
    name: "api_key_request_per_day",
  },
  apiKeyRequestPerMinute: {
    kind: "value",
    name: "api_key_request_per_minute",
  },
  coinPaymentPerDay: {
    kind: "value",
    name: "coin_payment_per_day",
  },
  coinPaymentPerMinute: {
    kind: "value",
    name: "coin_payment_per_minute",
  },
  dataExportPerDay: {
    kind: "value",
    name: "data_export_per_day",
  },
  dataExportPerHour: {
    kind: "value",
    name: "data_export_per_hour",
  },
  disposableEmailDomainsUrl: {
    kind: "value",
    name: "disposable_email_domains_url",
  },
  iconChangePerDay: {
    kind: "value",
    name: "icon_change_per_day",
  },
  iconChangePerMinute: {
    kind: "value",
    name: "icon_change_per_minute",
  },
  identityLinkPerDay: {
    kind: "value",
    name: "identity_link_per_day",
  },
  identityLinkPerMinute: {
    kind: "value",
    name: "identity_link_per_minute",
  },
  legalPageAgreementPerDay: {
    kind: "value",
    name: "legal_page_agreement_per_day",
  },
  legalPageAgreementPerMinute: {
    kind: "value",
    name: "legal_page_agreement_per_minute",
  },
  loginAttemptsPerAccountPerDay: {
    kind: "value",
    name: "login_attempts_per_account_per_day",
  },
  loginAttemptsPerAccountPerMinute: {
    kind: "value",
    name: "login_attempts_per_account_per_minute",
  },
  loginAttemptsPerSourcePerDay: {
    kind: "value",
    name: "login_attempts_per_source_per_day",
  },
  loginAttemptsPerSourcePerHour: {
    kind: "value",
    name: "login_attempts_per_source_per_hour",
  },
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
  mfaRequiredForPlatformOperator: {
    kind: "value",
    name: "mfa_required_for_platform_operator",
  },
  mfaRequiredForTenantAdmin: {
    kind: "value",
    name: "mfa_required_for_tenant_admin",
  },
  passkeyPerDay: {
    kind: "value",
    name: "passkey_per_day",
  },
  passkeyPerMinute: {
    kind: "value",
    name: "passkey_per_minute",
  },
  passwordVerificationPerDay: {
    kind: "value",
    name: "password_verification_per_day",
  },
  passwordVerificationPerMinute: {
    kind: "value",
    name: "password_verification_per_minute",
  },
  promotionCodeAttemptPerDay: {
    kind: "value",
    name: "promotion_code_attempt_per_day",
  },
  promotionCodeAttemptPerMinute: {
    kind: "value",
    name: "promotion_code_attempt_per_minute",
  },
  purchaseCheckoutPerDay: {
    kind: "value",
    name: "purchase_checkout_per_day",
  },
  purchaseCheckoutPerMinute: {
    kind: "value",
    name: "purchase_checkout_per_minute",
  },
  revision: "value",
  seriesRemainderCheckoutPerDay: {
    kind: "value",
    name: "series_remainder_checkout_per_day",
  },
  seriesRemainderCheckoutPerMinute: {
    kind: "value",
    name: "series_remainder_checkout_per_minute",
  },
  storePurchaseConfirmationPerDay: {
    kind: "value",
    name: "store_purchase_confirmation_per_day",
  },
  storePurchaseConfirmationPerMinute: {
    kind: "value",
    name: "store_purchase_confirmation_per_minute",
  },
  subscriptionCheckoutPerDay: {
    kind: "value",
    name: "subscription_checkout_per_day",
  },
  subscriptionCheckoutPerMinute: {
    kind: "value",
    name: "subscription_checkout_per_minute",
  },
  tenantCoinsAllowed: {
    kind: "value",
    name: "tenant_coins_allowed",
  },
  waitFreeTicketUsePerDay: {
    kind: "value",
    name: "wait_free_ticket_use_per_day",
  },
  waitFreeTicketUsePerMinute: {
    kind: "value",
    name: "wait_free_ticket_use_per_minute",
  },
} as const;

export const securityPolicyFormSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);
  const password = t("platform.policy.security.password_title");
  const perAddress = t("platform.policy.security.mail_per_address_legend");
  const perSource = t("platform.policy.security.mail_per_source_legend");
  const storePurchase = t("platform.policy.security.store_purchase_title");

  const waitFreeTicketUse = t(
    "platform.policy.security.wait_free_ticket_use_title"
  );

  const loginPerAccount = t(
    "platform.policy.security.login_attempts_per_account_title"
  );

  const loginPerSource = t(
    "platform.policy.security.login_attempts_per_source_title"
  );

  const legalPageAgreement = t(
    "platform.policy.security.legal_page_agreement_title"
  );

  const identityLink = t("platform.policy.security.identity_link_title");

  const iconChange = t("platform.policy.security.icon_change_title");

  const passkey = t("platform.policy.security.passkey_title");

  const seriesRemainderCheckout = t(
    "platform.policy.security.series_remainder_checkout_title"
  );

  const subscriptionCheckout = t(
    "platform.policy.security.subscription_checkout_title"
  );

  const coinPayment = t("platform.policy.security.coin_payment_title");

  const purchaseCheckout = t(
    "platform.policy.security.purchase_checkout_title"
  );

  const promotionCodeAttempt = t(
    "platform.policy.security.promotion_code_attempt_title"
  );

  const dataExport = t("platform.policy.security.data_export_title");

  const apiKeyRequest = t("platform.policy.security.api_key_request_title");

  const listUrlInvalid = t(
    "platform.policy.security.disposable_email_domains_url_invalid"
  );

  return z
    .object({
      anonymousReadImages: anonymousReadSchema(
        t,
        t("platform.policy.security.anonymous_read_images_title"),
        MIN_ANONYMOUS_READS.images
      ),
      anonymousReadPublicApi: anonymousReadSchema(
        t,
        t("platform.policy.security.anonymous_read_public_api_title"),
        MIN_ANONYMOUS_READS.publicApi
      ),
      anonymousReadSearch: anonymousReadSchema(
        t,
        t("platform.policy.security.anonymous_read_search_title"),
        MIN_ANONYMOUS_READS.search
      ),
      apiKeyRequestPerDay: limitSchema(t, apiKeyRequest),
      apiKeyRequestPerMinute: limitSchema(t, apiKeyRequest),
      coinPaymentPerDay: limitSchema(t, coinPayment),
      coinPaymentPerMinute: limitSchema(t, coinPayment),
      dataExportPerDay: limitSchema(t, dataExport),
      dataExportPerHour: limitSchema(t, dataExport),
      disposableEmailDomainsUrl: optionalTrimmedString(
        MAX_LIST_URL_BYTES,
        listUrlInvalid
      )
        .refine(fitsListUrlBytes, listUrlInvalid)
        .refine(isListUrl, listUrlInvalid),
      iconChangePerDay: limitSchema(t, iconChange),
      iconChangePerMinute: limitSchema(t, iconChange),
      identityLinkPerDay: limitSchema(t, identityLink),
      identityLinkPerMinute: limitSchema(t, identityLink),
      legalPageAgreementPerDay: limitSchema(t, legalPageAgreement),
      legalPageAgreementPerMinute: limitSchema(t, legalPageAgreement),
      loginAttemptsPerAccountPerDay: limitSchema(t, loginPerAccount),
      loginAttemptsPerAccountPerMinute: limitSchema(t, loginPerAccount),
      loginAttemptsPerSourcePerDay: limitSchema(t, loginPerSource),
      loginAttemptsPerSourcePerHour: limitSchema(t, loginPerSource),
      mailPerAddressPerDay: limitSchema(t, perAddress),
      mailPerAddressPerHour: limitSchema(t, perAddress),
      mailPerSourcePerDay: limitSchema(t, perSource),
      mailPerSourcePerHour: limitSchema(t, perSource),
      mfaRequiredForPlatformOperator: z.preprocess(
        (value) => value === "on",
        z.boolean()
      ),
      mfaRequiredForTenantAdmin: z.preprocess(
        (value) => value === "on",
        z.boolean()
      ),
      passkeyPerDay: limitSchema(t, passkey),
      passkeyPerMinute: limitSchema(t, passkey),
      passwordVerificationPerDay: limitSchema(t, password),
      passwordVerificationPerMinute: limitSchema(t, password),
      promotionCodeAttemptPerDay: limitSchema(t, promotionCodeAttempt),
      promotionCodeAttemptPerMinute: limitSchema(t, promotionCodeAttempt),
      purchaseCheckoutPerDay: limitSchema(t, purchaseCheckout),
      purchaseCheckoutPerMinute: limitSchema(t, purchaseCheckout),
      revision: revisionFormSchema(t("platform.policy.revision_invalid")),
      seriesRemainderCheckoutPerDay: limitSchema(t, seriesRemainderCheckout),
      seriesRemainderCheckoutPerMinute: limitSchema(t, seriesRemainderCheckout),
      storePurchaseConfirmationPerDay: limitSchema(t, storePurchase),
      storePurchaseConfirmationPerMinute: limitSchema(t, storePurchase),
      subscriptionCheckoutPerDay: limitSchema(t, subscriptionCheckout),
      subscriptionCheckoutPerMinute: limitSchema(t, subscriptionCheckout),
      tenantCoinsAllowed: z.preprocess((value) => value === "on", z.boolean()),
      waitFreeTicketUsePerDay: limitSchema(t, waitFreeTicketUse),
      waitFreeTicketUsePerMinute: limitSchema(t, waitFreeTicketUse),
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
        {
          day: "storePurchaseConfirmationPerDay",
          message: t("platform.policy.day_below_minute", {
            setting: storePurchase,
          }),
          short: "storePurchaseConfirmationPerMinute",
        },
        {
          day: "waitFreeTicketUsePerDay",
          message: t("platform.policy.day_below_minute", {
            setting: waitFreeTicketUse,
          }),
          short: "waitFreeTicketUsePerMinute",
        },
        {
          day: "loginAttemptsPerAccountPerDay",
          message: t("platform.policy.day_below_minute", {
            setting: loginPerAccount,
          }),
          short: "loginAttemptsPerAccountPerMinute",
        },
        {
          day: "loginAttemptsPerSourcePerDay",
          message: t("platform.policy.day_below_hour", {
            setting: loginPerSource,
          }),
          short: "loginAttemptsPerSourcePerHour",
        },
        {
          day: "legalPageAgreementPerDay",
          message: t("platform.policy.day_below_minute", {
            setting: legalPageAgreement,
          }),
          short: "legalPageAgreementPerMinute",
        },
        {
          day: "identityLinkPerDay",
          message: t("platform.policy.day_below_minute", {
            setting: identityLink,
          }),
          short: "identityLinkPerMinute",
        },
        {
          day: "iconChangePerDay",
          message: t("platform.policy.day_below_minute", {
            setting: iconChange,
          }),
          short: "iconChangePerMinute",
        },
        {
          day: "passkeyPerDay",
          message: t("platform.policy.day_below_minute", {
            setting: passkey,
          }),
          short: "passkeyPerMinute",
        },
        {
          day: "seriesRemainderCheckoutPerDay",
          message: t("platform.policy.day_below_minute", {
            setting: seriesRemainderCheckout,
          }),
          short: "seriesRemainderCheckoutPerMinute",
        },
        {
          day: "subscriptionCheckoutPerDay",
          message: t("platform.policy.day_below_minute", {
            setting: subscriptionCheckout,
          }),
          short: "subscriptionCheckoutPerMinute",
        },
        {
          day: "coinPaymentPerDay",
          message: t("platform.policy.day_below_minute", {
            setting: coinPayment,
          }),
          short: "coinPaymentPerMinute",
        },
        {
          day: "purchaseCheckoutPerDay",
          message: t("platform.policy.day_below_minute", {
            setting: purchaseCheckout,
          }),
          short: "purchaseCheckoutPerMinute",
        },
        {
          day: "promotionCodeAttemptPerDay",
          message: t("platform.policy.day_below_minute", {
            setting: promotionCodeAttempt,
          }),
          short: "promotionCodeAttemptPerMinute",
        },
        {
          day: "dataExportPerDay",
          message: t("platform.policy.day_below_hour", {
            setting: dataExport,
          }),
          short: "dataExportPerHour",
        },
        {
          day: "apiKeyRequestPerDay",
          message: t("platform.policy.day_below_minute", {
            setting: apiKeyRequest,
          }),
          short: "apiKeyRequestPerMinute",
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
  notificationSettingsPerDay: {
    kind: "value",
    name: "notification_settings_per_day",
  },
  notificationSettingsPerMinute: {
    kind: "value",
    name: "notification_settings_per_minute",
  },
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

  const notificationSettings = t(
    "platform.policy.community.notification_settings_legend"
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
      notificationSettingsPerDay: limitSchema(t, notificationSettings),
      notificationSettingsPerMinute: limitSchema(t, notificationSettings),
      revision: revisionFormSchema(t("platform.policy.revision_invalid")),
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
        {
          day: "notificationSettingsPerDay",
          message: t("platform.policy.day_below_minute", {
            setting: notificationSettings,
          }),
          short: "notificationSettingsPerMinute",
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
    contentEventDays: boundedIntFormSchema(
      t("platform.policy.retention.content_event_days_invalid", {
        setting: t("platform.policy.retention.content_event_label"),
      }),
      { max: MAX_RETENTION_DAYS, min: MIN_CONTENT_EVENT_DAYS }
    ),
    dailyRankingSnapshotDays: days(
      t("platform.policy.retention.daily_ranking_label")
    ),
    revision: revisionFormSchema(t("platform.policy.revision_invalid")),
    weeklyRankingSnapshotDays: days(
      t("platform.policy.retention.weekly_ranking_label")
    ),
    withdrawnCommentDays: days(
      t("platform.policy.retention.withdrawn_comment_label")
    ),
  });
};
