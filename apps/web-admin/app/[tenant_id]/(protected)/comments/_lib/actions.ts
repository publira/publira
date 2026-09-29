"use server";

import type { Locale } from "@publira/i18n";
import type { FormActionState } from "@publira/ui-components/action-form";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { refresh } from "next/cache";
import { z } from "zod";

import { getActionLocale } from "#lib/action-messages";
import { withAdminSessionReauth } from "#lib/auth-session";
import { moderateComment, resolveCommentReport } from "#lib/comment";
import type { CommentModerationAction } from "#lib/comment";
import { assertSameOrigin } from "#lib/csrf";
import {
  optionalTrimmedString,
  requiredRecordId,
  requiredTrimmedString,
} from "#lib/form-schemas";
import { getMessagesFor } from "#lib/messages";
import type { AdminMessageAccessor } from "#lib/messages";

import { COMMENT_REPORT_RESOLUTIONS } from "../comment-types";
import type { CommentReportResolution } from "../comment-types";

/**
 * The reason is stored on the audit log row, which is where a tenant reads
 * back why a comment was removed when it owes its author a statement of
 * reasons. It is optional here and required by {@link purgeCommentAction}: a
 * purged row leaves nothing behind but that entry.
 */
const moderationSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z.object({
    commentId: requiredRecordId(t("admin.comments.validation.target_missing")),
    reason: optionalTrimmedString(1000),
    tenantId: requiredTrimmedString(
      t("admin.comments.validation.tenant_missing")
    ),
  });
};
const moderationFormFields = {
  commentId: { kind: "value", name: "comment_id" },
  reason: "value",
  tenantId: { kind: "value", name: "tenant_id" },
} as const;

/** What the toast of a moderation that went through says. */
const moderatedMessage = (
  t: AdminMessageAccessor,
  action: CommentModerationAction
): string => {
  switch (action) {
    case "approve": {
      return t("admin.comments.approved");
    }
    case "hide": {
      return t("admin.comments.hidden");
    }
    case "purge": {
      return t("admin.comments.purged");
    }
    default: {
      return t("admin.comments.restored");
    }
  }
};

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
): Promise<FormActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const [t, schema] = await Promise.all([
    getMessagesFor(locale),
    moderationSchema(locale),
  ]);
  const parsed = schema.safeParse(
    toFormDataInput(formData, moderationFormFields)
  );
  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }
  if (options.requireReason === true && parsed.data.reason === "") {
    return {
      message: t("admin.comments.validation.reason_required"),
      ok: false,
    };
  }

  const result = await withAdminSessionReauth(() =>
    moderateComment(
      {
        action,
        commentId: parsed.data.commentId,
        reason: parsed.data.reason,
        tenantId: parsed.data.tenantId,
      },
      locale
    )
  );
  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  // Both reads are uncached (see `lib/comment.ts`), so there is no tag to
  // drop: the route is re-rendered instead, which is also what brings the
  // layout's queue badge back with the new count.
  refresh();
  return { message: moderatedMessage(t, action), ok: true };
};

// Every exported Action is written `async` rather than as an arrow returning
// the promise `moderate` already produces: Next.js rejects an exported Server
// Action that is not an async function, at build time.
export const approveCommentAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => await moderate("approve", formData);

export const hideCommentAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => await moderate("hide", formData);

export const restoreCommentAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => await moderate("restore", formData);

export const purgeCommentAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> =>
  await moderate("purge", formData, { requireReason: true });

/**
 * The report decision, which names a report rather than a comment: a comment
 * several readers reported is several rows in the queue, and each of them is
 * decided on its own.
 */
const reportDecisionSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z.object({
    reason: optionalTrimmedString(1000),
    reportId: requiredTrimmedString(
      t("admin.comments.validation.target_missing")
    ),
    resolution: z.enum(COMMENT_REPORT_RESOLUTIONS),
    tenantId: requiredTrimmedString(
      t("admin.comments.validation.tenant_missing")
    ),
  });
};
const reportDecisionFormFields = {
  reason: "value",
  reportId: { kind: "value", name: "report_id" },
  resolution: "value",
  tenantId: { kind: "value", name: "tenant_id" },
} as const;

/** What the toast of a decision that went through says. */
const decidedMessage = (
  t: AdminMessageAccessor,
  resolution: CommentReportResolution
): string =>
  resolution === "resolved"
    ? t("admin.comments.reports.resolved")
    : t("admin.comments.reports.rejected");

export const resolveCommentReportAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const schema = await reportDecisionSchema(locale);
  const parsed = schema.safeParse(
    toFormDataInput(formData, reportDecisionFormFields)
  );
  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const result = await withAdminSessionReauth(() =>
    resolveCommentReport(
      {
        reason: parsed.data.reason,
        reportId: parsed.data.reportId,
        resolution: parsed.data.resolution,
        tenantId: parsed.data.tenantId,
      },
      locale
    )
  );
  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  // The queue read is uncached like the comment list, so there is no tag to
  // drop: re-rendering the route is what brings the decided report back in the
  // state it is now in.
  refresh();
  const t = await getMessagesFor(locale);
  return { message: decidedMessage(t, parsed.data.resolution), ok: true };
};
