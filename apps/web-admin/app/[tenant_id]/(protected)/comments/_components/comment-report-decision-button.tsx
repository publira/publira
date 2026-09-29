import {
  ActionForm,
  ActionFormIdle,
  ActionFormPending,
  ActionFormSubmit,
} from "@publira/ui-components/action-form";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import { SettledToast } from "#components/settled-toast";

import { resolveCommentReportAction } from "../_lib/actions";
import type { CommentReportResolution } from "../comment-types";

interface CommentReportDecisionButtonProps {
  reportId: string;
  resolution: CommentReportResolution;
  tenantId: string;
}

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
  tenantId,
}: CommentReportDecisionButtonProps) => (
  <ActionForm
    action={resolveCommentReportAction}
    className="grid gap-1"
    showSuccess={false}
  >
    <input name="tenant_id" type="hidden" value={tenantId} />
    <input name="report_id" type="hidden" value={reportId} />
    <input name="resolution" type="hidden" value={resolution} />
    <SettledToast />
    <ActionFormSubmit
      size="sm"
      variant={resolution === "resolved" ? "default" : "outline"}
    >
      <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
        {resolution === "resolved" ? (
          <>
            <ActionFormIdle>
              <Message message="admin.comments.reports.resolve" />
            </ActionFormIdle>
            <ActionFormPending>
              <Message message="admin.comments.reports.resolving" />
            </ActionFormPending>
          </>
        ) : (
          <>
            <ActionFormIdle>
              <Message message="admin.comments.reports.reject" />
            </ActionFormIdle>
            <ActionFormPending>
              <Message message="admin.comments.reports.rejecting" />
            </ActionFormPending>
          </>
        )}
      </Suspense>
    </ActionFormSubmit>
  </ActionForm>
);
