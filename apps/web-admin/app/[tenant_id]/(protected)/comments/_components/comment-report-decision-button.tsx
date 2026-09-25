"use client";

import {
  ActionFormIdle,
  ActionFormPending,
} from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import { FormMessage } from "@publira/ui-components/form-message";
import { useToastManager } from "@publira/ui-components/toast";
import { useActionState } from "react";

import { ClientMessage } from "#components/client-message";
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

/** What the toast says once the decision has landed. */
const DecisionDone = ({
  resolution,
}: {
  resolution: CommentReportResolution;
}) =>
  resolution === "resolved" ? (
    <ClientMessage message="admin.comments.reports.resolved" />
  ) : (
    <ClientMessage message="admin.comments.reports.rejected" />
  );

/**
 * One of the two ways a report is decided.
 *
 * Neither asks for a confirmation and neither takes a written reason: a
 * decision changes nothing about the comment, so there is nothing here a
 * tenant would later owe an author a statement of reasons for. Removing the
 * comment is a separate control on the same row, and that one does ask.
 */
export const CommentReportDecisionButton = ({
  reportId,
  resolution,
}: CommentReportDecisionButtonProps) => {
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
        // The toast renders outside this subtree, so the boundary its copy
        // needs travels with the node rather than sitting at this call site.
        add({
          title: <DecisionDone resolution={resolution} />,
          type: "success",
        });
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
        {resolution === "resolved" ? (
          <>
            <ActionFormIdle>
              <ClientMessage message="admin.comments.reports.resolve" />
            </ActionFormIdle>
            <ActionFormPending>
              <ClientMessage message="admin.comments.reports.resolving" />
            </ActionFormPending>
          </>
        ) : (
          <>
            <ActionFormIdle>
              <ClientMessage message="admin.comments.reports.reject" />
            </ActionFormIdle>
            <ActionFormPending>
              <ClientMessage message="admin.comments.reports.rejecting" />
            </ActionFormPending>
          </>
        )}
      </Button>
      {state && !state.ok && state.reportId === reportId ? (
        <FormMessage variant="destructive">{state.message}</FormMessage>
      ) : null}
    </form>
  );
};
