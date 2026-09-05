"use server";

import { getMessage } from "@publira/i18n";
import type { FormActionState } from "@publira/ui-components/action-form";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { updateTag } from "next/cache";
import { z } from "zod";

import { tenantIdSchema } from "#lib/auth-input";
import {
  requirePublicSession,
  withPublicSessionReauth,
} from "#lib/auth-session";
import { tenantEpisodeCommentsTag } from "#lib/cache-tags";
import { postEpisodeComment, withdrawEpisodeComment } from "#lib/comments";
import { assertSameOrigin } from "#lib/csrf";
import {
  LOCALE_FIELD_NAME,
  localeFormSchema,
  requireFormLocale,
} from "#lib/locale-form";
import { loadHostMessages } from "#lib/messages";
import type { HostMessages } from "#lib/messages";

/**
 * The body limit the API enforces, counted the same way it counts it: Unicode
 * code points, so the same text costs a reader the same length whatever script
 * it is written in. Rejecting an over-long body here is what puts the reason
 * next to the box instead of turning a round trip into a generic failure.
 */
const MAX_COMMENT_BODY_LENGTH = 1000;

const publicIdFormSchema = z.string().trim().min(1).max(64);

/**
 * The comment form's own rules. It is a function of the catalog rather than a
 * module constant: its wording follows the locale the form was submitted from.
 */
const postCommentSchema = (messages: HostMessages) =>
  z.object({
    body: z
      .string()
      .trim()
      .min(1, {
        error: getMessage(messages, "host.episode.comments.body_required"),
      })
      .refine((value) => [...value].length <= MAX_COMMENT_BODY_LENGTH, {
        error: getMessage(messages, "host.episode.comments.body_too_long", {
          max: MAX_COMMENT_BODY_LENGTH,
        }),
      }),
    episodePublicId: publicIdFormSchema,
    locale: localeFormSchema,
    returnTo: z.string().trim().min(1).max(2048),
    tenantId: tenantIdSchema,
  });

const withdrawCommentSchema = z.object({
  commentPublicId: publicIdFormSchema,
  episodePublicId: publicIdFormSchema,
  locale: localeFormSchema,
  returnTo: z.string().trim().min(1).max(2048),
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
  const messages = await loadHostMessages(submittedLocale);
  const parsed = postCommentSchema(messages).safeParse(
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
    message: getMessage(
      messages,
      result.awaitingApproval
        ? "host.episode.comments.posted_awaiting_approval"
        : "host.episode.comments.posted"
    ),
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
  const messages = await loadHostMessages(locale);
  return {
    message: getMessage(messages, "host.episode.comments.deleted"),
    ok: true,
  };
};
