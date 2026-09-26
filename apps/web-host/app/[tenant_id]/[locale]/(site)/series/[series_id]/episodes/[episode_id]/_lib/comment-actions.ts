"use server";

import type { Locale } from "@publira/i18n";
import type { FormActionState } from "@publira/ui-components/action-form";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { updateTag } from "next/cache";
import { z } from "zod";

import { returnToFormSchema, tenantIdSchema } from "#lib/auth-input";
import {
  requirePublicSession,
  withPublicSessionReauth,
} from "#lib/auth-session";
import { tenantEpisodeCommentsTag } from "#lib/cache-tags";
import {
  EPISODE_COMMENT_REPORT_REASONS,
  postEpisodeComment,
  reportEpisodeComment,
  withdrawEpisodeComment,
} from "#lib/comments";
import { assertSameOrigin } from "#lib/csrf";
import {
  LOCALE_FIELD_NAME,
  localeFormSchema,
  requireFormLocale,
} from "#lib/locale-form";
import { getMessagesFor } from "#lib/messages";

/**
 * The body limit the API enforces, counted the same way it counts it: Unicode
 * code points, so the same text costs a reader the same length whatever script
 * it is written in. Rejecting an over-long body here is what puts the reason
 * next to the box instead of turning a round trip into a generic failure.
 */
const MAX_COMMENT_BODY_LENGTH = 1000;

const publicIdFormSchema = z.string().trim().min(1).max(64);

/**
 * The comment form's own rules. It is a function of the locale rather than a
 * module constant: its wording follows the locale the form was submitted from,
 * and it resolves that copy itself.
 */
const postCommentSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z.object({
    body: z
      .string()
      .trim()
      .min(1, {
        error: t("host.episode.comments.body_required"),
      })
      .refine((value) => [...value].length <= MAX_COMMENT_BODY_LENGTH, {
        error: t("host.episode.comments.body_too_long", {
          max: MAX_COMMENT_BODY_LENGTH,
        }),
      }),
    episodePublicId: publicIdFormSchema,
    locale: localeFormSchema,
    returnTo: returnToFormSchema,
    tenantId: tenantIdSchema,
  });
};

/**
 * The note limit the API enforces, counted in Unicode code points as the body
 * limit is.
 */
const MAX_COMMENT_REPORT_NOTE_LENGTH = 1000;

/**
 * The report dialog's own rules, worded in the locale the dialog was submitted
 * from for the same reason {@link postCommentSchema} is.
 *
 * The reason is checked against the list the chooser was built from rather than
 * against a free string: a submission naming anything else did not come from
 * that chooser, and the RPC would answer it with a generic rejection the reader
 * could do nothing with.
 */
const reportCommentSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z.object({
    commentPublicId: publicIdFormSchema,
    locale: localeFormSchema,
    note: z
      .string()
      .trim()
      .refine((value) => [...value].length <= MAX_COMMENT_REPORT_NOTE_LENGTH, {
        error: t("host.episode.comments.report_note_too_long", {
          max: MAX_COMMENT_REPORT_NOTE_LENGTH,
        }),
      }),
    reason: z.enum(EPISODE_COMMENT_REPORT_REASONS, {
      error: t("host.episode.comments.report_reason_required"),
    }),
    returnTo: returnToFormSchema,
    tenantId: tenantIdSchema,
  });
};

const withdrawCommentSchema = z.object({
  commentPublicId: publicIdFormSchema,
  episodePublicId: publicIdFormSchema,
  locale: localeFormSchema,
  returnTo: returnToFormSchema,
  tenantId: tenantIdSchema,
});

/**
 * Post one comment on the episode the form names.
 *
 * The success message differs by what the tenant's mode did with the comment:
 * under `approval_required` the reader is told it is waiting, because nothing
 * they can see afterwards says so on its own.
 */
export const postEpisodeCommentAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  // The locale field parses on its own — it throws rather than falling back —
  // so every answer below is worded in the reader's language, the rejections
  // included.
  const submittedLocale = requireFormLocale(formData.get(LOCALE_FIELD_NAME));
  const [t, schema] = await Promise.all([
    getMessagesFor(submittedLocale),
    postCommentSchema(submittedLocale),
  ]);
  const parsed = schema.safeParse(
    toFormDataInput(formData, {
      body: "value",
      episodePublicId: "value",
      locale: "value",
      returnTo: "value",
      tenantId: "value",
    })
  );
  if (!parsed.success) {
    return {
      message: toFormErrorMessage(parsed.error, { locale: submittedLocale }),
      ok: false,
    };
  }

  const { body, episodePublicId, locale, returnTo, tenantId } = parsed.data;
  await requirePublicSession(locale, returnTo, tenantId);
  const result = await withPublicSessionReauth(
    locale,
    returnTo,
    () => postEpisodeComment({ body, episodePublicId, locale, tenantId }),
    tenantId
  );
  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  updateTag(tenantEpisodeCommentsTag(tenantId, episodePublicId));
  return {
    message: result.awaitingApproval
      ? t("host.episode.comments.posted_awaiting_approval")
      : t("host.episode.comments.posted"),
    ok: true,
  };
};

/**
 * Take one of the reader's own comments down. It leaves the section for the
 * author too, which is what makes the control a deletion rather than a hide.
 */
export const withdrawEpisodeCommentAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const submittedLocale = requireFormLocale(formData.get(LOCALE_FIELD_NAME));
  const parsed = withdrawCommentSchema.safeParse(
    toFormDataInput(formData, {
      commentPublicId: "value",
      episodePublicId: "value",
      locale: "value",
      returnTo: "value",
      tenantId: "value",
    })
  );
  if (!parsed.success) {
    return {
      message: toFormErrorMessage(parsed.error, { locale: submittedLocale }),
      ok: false,
    };
  }

  const { commentPublicId, episodePublicId, locale, returnTo, tenantId } =
    parsed.data;
  await requirePublicSession(locale, returnTo, tenantId);
  const result = await withPublicSessionReauth(
    locale,
    returnTo,
    () => withdrawEpisodeComment({ commentPublicId, locale, tenantId }),
    tenantId
  );
  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  updateTag(tenantEpisodeCommentsTag(tenantId, episodePublicId));
  const t = await getMessagesFor(locale);
  return {
    message: t("host.episode.comments.deleted"),
    ok: true,
  };
};

/**
 * Flag one comment as breaking the rules.
 *
 * The list is not invalidated afterwards. The comment the reporter can see is
 * unchanged by their report — what a report moves is a counter staff read — and
 * refreshing the section around a comment that has just been reported would be
 * the one visible difference between a comment nobody reported and one that has
 * been.
 */
export const reportEpisodeCommentAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const submittedLocale = requireFormLocale(formData.get(LOCALE_FIELD_NAME));
  const [t, schema] = await Promise.all([
    getMessagesFor(submittedLocale),
    reportCommentSchema(submittedLocale),
  ]);
  const parsed = schema.safeParse(
    toFormDataInput(formData, {
      commentPublicId: "value",
      locale: "value",
      note: "value",
      reason: "value",
      returnTo: "value",
      tenantId: "value",
    })
  );
  if (!parsed.success) {
    return {
      message: toFormErrorMessage(parsed.error, { locale: submittedLocale }),
      ok: false,
    };
  }

  const { commentPublicId, locale, note, reason, returnTo, tenantId } =
    parsed.data;
  await requirePublicSession(locale, returnTo, tenantId);
  const result = await withPublicSessionReauth(
    locale,
    returnTo,
    () =>
      reportEpisodeComment({ commentPublicId, locale, note, reason, tenantId }),
    tenantId
  );
  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  return {
    message: t("host.episode.comments.reported"),
    ok: true,
  };
};
