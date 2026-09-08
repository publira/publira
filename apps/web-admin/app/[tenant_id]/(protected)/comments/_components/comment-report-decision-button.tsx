"use client";

import { getMessage } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { useToastManager } from "@publira/ui-components";
import { Button } from "@publira/ui-components/button";
import { FormMessage } from "@publira/ui-components/form-message";
import { useActionState, useContext } from "react";

import { AdminLocaleContext } from "#components/admin-locale-context";
import { useTenantId } from "#lib/use-tenant-id";

import { resolveCommentReportAction } from "../_lib/actions";
import type {
  CommentReportActionState,
  CommentReportResolution,
} from "../comment-types";

interface CommentReportDecisionButtonProps {
  reportId: string;
  resolution: CommentReportResolution;
}

/**
 * The two ways one report is decided.
 *
 * Neither asks for a confirmation and neither takes a written reason: a
 * decision changes nothing about the comment, so there is nothing here a
 * tenant would later owe an author a statement of reasons for. Removing the
 * comment is a separate control on the same row, and that one does ask.
 */
const labels = (
  resolution: CommentReportResolution,
  messages: SharedMessages
): { done: string; idle: string; pending: string } =>
  resolution === "resolved"
    ? {
        done: getMessage(messages, "admin.comments.reports.resolved"),
        idle: getMessage(messages, "admin.comments.reports.resolve"),
        pending: getMessage(messages, "admin.comments.reports.resolving"),
      }
    : {
        done: getMessage(messages, "admin.comments.reports.rejected"),
        idle: getMessage(messages, "admin.comments.reports.reject"),
        pending: getMessage(messages, "admin.comments.reports.rejecting"),
      };

export const CommentReportDecisionButton = ({
  reportId,
  resolution,
}: CommentReportDecisionButtonProps) => {
  const locale = useContext(AdminLocaleContext);
  if (locale === null) {
    throw new Error("AdminLocaleProvider is required.");
  }
  const messages = sharedCatalog(locale);
  const copy = labels(resolution, messages);
  const tenantId = useTenantId();
  const { add } = useToastManager();
  const [state, formAction, isPending] = useActionState(
    async (
      previousState: CommentReportActionState,
      formData: FormData
    ): Promise<CommentReportActionState> => {
      const nextState = await resolveCommentReportAction(
        previousState,
        formData
      );
      if (nextState?.ok) {
        add({ title: copy.done, type: "success" });
      }
      return nextState;
    },
    null
  );

  return (
    <form action={formAction} className="grid gap-1">
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="report_id" type="hidden" value={reportId} />
      <input name="resolution" type="hidden" value={resolution} />
      <Button
        disabled={isPending}
        size="sm"
        type="submit"
        variant={resolution === "resolved" ? "default" : "outline"}
      >
        {isPending ? copy.pending : copy.idle}
      </Button>
      {state && !state.ok && state.reportId === reportId ? (
        <FormMessage variant="destructive">{state.message}</FormMessage>
      ) : null}
    </form>
  );
};
