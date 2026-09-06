"use server";

import { getMessage } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { refresh } from "next/cache";
import { z } from "zod";

import { getActionLocale } from "#lib/action-messages";
import { withAdminSessionReauth } from "#lib/auth-session";
import { commentActionFailure, moderateComment } from "#lib/comment";
import type { CommentModerationAction } from "#lib/comment";
import { assertSameOrigin } from "#lib/csrf";
import {
  optionalTrimmedString,
  requiredTrimmedString,
} from "#lib/form-schemas";

import type { CommentActionState } from "../comment-types";

/**
 * The reason is stored on the audit log row, which is where a tenant reads
 * back why a comment was removed when it owes its author a statement of
 * reasons. It is optional here and required by {@link purgeCommentAction}: a
 * purged row leaves nothing behind but that entry.
 */
const moderationSchema = (messages: SharedMessages) =>
  z.object({
    publicId: requiredTrimmedString(
      getMessage(messages, "admin.comments.validation.target_missing")
    ),
    reason: optionalTrimmedString(1000),
    tenantId: requiredTrimmedString(
      getMessage(messages, "admin.comments.validation.tenant_missing")
    ),
  });

const moderationFormFields = {
  publicId: { kind: "value", name: "public_id" },
  reason: "value",
  tenantId: { kind: "value", name: "tenant_id" },
} as const;

/**
 * The body every moderation Action shares: authenticate the submission, read
 * the same three fields out of it, call the RPC the action names, and refresh
 * the route so the list and the navigation badge both come back updated.
 *
 * `requireReason` is the one thing that differs, and it differs because the
 * API requires it: a purge deletes the row, so the audit entry is the only
 * record left that the comment existed.
 */
const moderate = async (
  action: CommentModerationAction,
  formData: FormData,
  options: { requireReason?: boolean } = {}
): Promise<CommentActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const messages = sharedCatalog(locale);
  const input = toFormDataInput(formData, moderationFormFields);
  const publicId =
    typeof input.publicId === "string" ? input.publicId.trim() : "";
  const parsed = moderationSchema(messages).safeParse(input);
  if (!parsed.success) {
    return commentActionFailure(
      publicId,
      toFormErrorMessage(parsed.error, { locale })
    );
  }
  if (options.requireReason === true && parsed.data.reason === "") {
    return commentActionFailure(
      parsed.data.publicId,
      getMessage(messages, "admin.comments.validation.reason_required")
    );
  }

  const result = await withAdminSessionReauth(() =>
    moderateComment(
      {
        action,
        publicId: parsed.data.publicId,
        reason: parsed.data.reason,
        tenantId: parsed.data.tenantId,
      },
      locale
    )
  );
  if (!result.ok) {
    return commentActionFailure(parsed.data.publicId, result.message);
  }

  // Both reads are uncached (see `lib/comment.ts`), so there is no tag to
  // drop: the route is re-rendered instead, which is also what brings the
  // layout's queue badge back with the new count.
  refresh();
  return { message: "", ok: true, publicId: parsed.data.publicId };
};

// Every exported Action is written `async` rather than as an arrow returning
// the promise `moderate` already produces: Next.js rejects an exported Server
// Action that is not an async function, at build time.
export const approveCommentAction = async (
  _prevState: CommentActionState,
  formData: FormData
): Promise<CommentActionState> => await moderate("approve", formData);

export const hideCommentAction = async (
  _prevState: CommentActionState,
  formData: FormData
): Promise<CommentActionState> => await moderate("hide", formData);

export const restoreCommentAction = async (
  _prevState: CommentActionState,
  formData: FormData
): Promise<CommentActionState> => await moderate("restore", formData);

export const purgeCommentAction = async (
  _prevState: CommentActionState,
  formData: FormData
): Promise<CommentActionState> =>
  await moderate("purge", formData, { requireReason: true });
