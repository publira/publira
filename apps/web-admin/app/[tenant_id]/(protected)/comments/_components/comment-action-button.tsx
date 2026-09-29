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

import { approveCommentAction, restoreCommentAction } from "../_lib/actions";

/**
 * The two moderation actions that need nothing from the operator but the
 * decision itself.
 *
 * Both put a comment back into circulation, and neither is destructive — an
 * approval can be undone by removing the comment again, and a restore by
 * removing it again too — so neither asks for a confirmation. The reason field
 * the API accepts is left empty for the same reason: it exists for the
 * removals a tenant may have to account for.
 */
export type PlainCommentAction = "approve" | "restore";

interface CommentActionButtonProps {
  action: PlainCommentAction;
  commentId: string;
  tenantId: string;
}

/**
 * The Action drops the comment cache tag itself, so the list and the
 * navigation badge both come back updated, and success is a toast because the
 * row it would sit under has changed.
 */
export const CommentActionButton = ({
  action,
  commentId,
  tenantId,
}: CommentActionButtonProps) => (
  <ActionForm
    action={action === "approve" ? approveCommentAction : restoreCommentAction}
    className="grid gap-1"
    showSuccess={false}
  >
    <input name="tenant_id" type="hidden" value={tenantId} />
    <input name="comment_id" type="hidden" value={commentId} />
    <SettledToast />
    <ActionFormSubmit
      size="sm"
      variant={action === "approve" ? "default" : "outline"}
    >
      <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
        {action === "approve" ? (
          <>
            <ActionFormIdle>
              <Message message="admin.comments.approve" />
            </ActionFormIdle>
            <ActionFormPending>
              <Message message="admin.comments.approving" />
            </ActionFormPending>
          </>
        ) : (
          <>
            <ActionFormIdle>
              <Message message="admin.comments.restore" />
            </ActionFormIdle>
            <ActionFormPending>
              <Message message="admin.comments.restoring" />
            </ActionFormPending>
          </>
        )}
      </Suspense>
    </ActionFormSubmit>
  </ActionForm>
);
