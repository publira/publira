"use server";

import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { updateTag } from "next/cache";

import type { FormActionState } from "#components/action-form";
import { platformAuditLogsCacheTag } from "#lib/audit-logs";
import { withPlatformSessionReauth } from "#lib/auth-session";
import { assertSameOrigin } from "#lib/csrf";
import { getPlatformLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import {
  platformPolicyCacheTag,
  platformRetentionDefaultsCacheTag,
  updatePlatformCommunityLimits,
  updatePlatformRetentionDefaults,
  updatePlatformSecurityPolicy,
} from "#lib/platform-policy";

import {
  communityLimitsFormFields,
  communityLimitsFormSchema,
  retentionDefaultsFormFields,
  retentionDefaultsFormSchema,
  securityPolicyFormFields,
  securityPolicyFormSchema,
} from "./policy-form-schemas";

export const updatePlatformSecurityPolicyAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const locale = await getPlatformLocale();
  const schema = await securityPolicyFormSchema(locale);

  const parsed = schema.safeParse(
    toFormDataInput(formData, securityPolicyFormFields)
  );
  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const { data } = parsed;
  const result = await withPlatformSessionReauth(() =>
    updatePlatformSecurityPolicy(
      {
        mailRequestsPerAddress: {
          perDay: data.mailPerAddressPerDay,
          perHour: data.mailPerAddressPerHour,
        },
        mailRequestsPerSource: {
          perDay: data.mailPerSourcePerDay,
          perHour: data.mailPerSourcePerHour,
        },
        mfaRequiredForTenantAdmin: data.mfaRequiredForTenantAdmin,
        passwordVerification: {
          perDay: data.passwordVerificationPerDay,
          perMinute: data.passwordVerificationPerMinute,
        },
        storePurchaseConfirmation: {
          perDay: data.storePurchaseConfirmationPerDay,
          perMinute: data.storePurchaseConfirmationPerMinute,
        },
      },
      data.revision,
      locale
    )
  );
  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  updateTag(platformPolicyCacheTag);
  updateTag(platformAuditLogsCacheTag);

  const t = await getMessagesFor(locale);
  return { message: t("platform.policy.security.saved"), ok: true };
};

export const updatePlatformCommunityLimitsAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const locale = await getPlatformLocale();
  const schema = await communityLimitsFormSchema(locale);

  const parsed = schema.safeParse(
    toFormDataInput(formData, communityLimitsFormFields)
  );
  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const { data } = parsed;
  const result = await withPlatformSessionReauth(() =>
    updatePlatformCommunityLimits(
      {
        commentPost: {
          perDay: data.commentPostPerDay,
          perMinute: data.commentPostPerMinute,
        },
        commentReport: {
          perDay: data.commentReportPerDay,
          perMinute: data.commentReportPerMinute,
        },
        contactMessagePerAccount: {
          perDay: data.contactPerAccountPerDay,
          perHour: data.contactPerAccountPerHour,
        },
        contactMessagePerClient: {
          perDay: data.contactPerClientPerDay,
          perHour: data.contactPerClientPerHour,
        },
        duplicateCommentWindowMinutes: data.duplicateCommentWindowMinutes,
        episodeRating: {
          perDay: data.episodeRatingPerDay,
          perMinute: data.episodeRatingPerMinute,
        },
        viewerPreferences: {
          perDay: data.viewerPreferencesPerDay,
          perMinute: data.viewerPreferencesPerMinute,
        },
      },
      data.revision,
      locale
    )
  );
  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  updateTag(platformPolicyCacheTag);
  updateTag(platformAuditLogsCacheTag);

  const t = await getMessagesFor(locale);
  return { message: t("platform.policy.community.saved"), ok: true };
};

export const updatePlatformRetentionDefaultsAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const locale = await getPlatformLocale();
  const schema = await retentionDefaultsFormSchema(locale);

  const parsed = schema.safeParse(
    toFormDataInput(formData, retentionDefaultsFormFields)
  );
  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const { revision, ...defaults } = parsed.data;
  const result = await withPlatformSessionReauth(() =>
    updatePlatformRetentionDefaults(defaults, revision, locale)
  );
  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  updateTag(platformRetentionDefaultsCacheTag);
  updateTag(platformAuditLogsCacheTag);

  const t = await getMessagesFor(locale);
  return { message: t("platform.policy.retention.saved"), ok: true };
};
