"use client";

import { useToastManager } from "@publira/ui-components";
import { Button } from "@publira/ui-components/button";
import { FormMessage } from "@publira/ui-components/form-message";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense, useActionState } from "react";

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

/**
 * What one decision control says, idle and while it is in flight.
 *
 * Each branch names its key inside the `<ClientMessage>` it returns, the same
 * way the queue's server-rendered copy does, so the key stays where a
 * translation extractor can see it.
 */
const DecisionLabel = ({
  isPending,
  resolution,
}: {
  isPending: boolean;
  resolution: CommentReportResolution;
}) => {
  if (resolution === "resolved") {
    return isPending ? (
      <ClientMessage message="admin.comments.reports.resolving" />
    ) : (
      <ClientMessage message="admin.comments.reports.resolve" />
    );
  }

  return isPending ? (
    <ClientMessage message="admin.comments.reports.rejecting" />
  ) : (
    <ClientMessage message="admin.comments.reports.reject" />
  );
};

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
 *
 * The copy comes from `<ClientMessage>` rather than from a catalog this module
 * loads: a catalog imported here would ship every locale to the browser, and
 * each string keeps a boundary of its own this way.
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
          title: (
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <DecisionDone resolution={resolution} />
            </Suspense>
          ),
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
        <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
          <DecisionLabel isPending={isPending} resolution={resolution} />
        </Suspense>
      </Button>
      {state && !state.ok && state.reportId === reportId ? (
        <FormMessage variant="destructive">{state.message}</FormMessage>
      ) : null}
    </form>
  );
};
