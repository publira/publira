import {
  ActionForm,
  ActionFormFieldset,
  ActionFormIdle,
  ActionFormPending,
} from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
  DialogViewport,
} from "@publira/ui-components/dialog";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense, useId } from "react";

import { Message } from "#components/message";
import { SettledToast } from "#components/settled-toast";

import { hideCommentAction, purgeCommentAction } from "../_lib/actions";
import { CommentReasonInput } from "./comment-reason-input";

/**
 * The two moderation actions that take a written reason.
 *
 * A removal is what a tenant may later have to give its author a statement of
 * reasons for, and a purge leaves the audit entry as the only record that the
 * comment ever existed — so the API requires the reason there and merely
 * records it here.
 */
export type ReasonCommentAction = "hide" | "purge";

interface CommentReasonDialogProps {
  action: ReasonCommentAction;
  commentId: string;
  tenantId: string;
}

export const CommentReasonDialog = ({
  action,
  commentId,
  tenantId,
}: CommentReasonDialogProps) => {
  // The comments screen shows a reported comment in the report queue and in
  // the list, so the comment's id alone would name two forms.
  const formId = useId();

  return (
    // The form wraps the dialog rather than sitting in its popup, and the
    // reason field joins it through `form=`, so confirming submits a form that
    // is still mounted while the popup is being torn down.
    <ActionForm
      action={action === "hide" ? hideCommentAction : purgeCommentAction}
      className="grid gap-1"
      id={formId}
      showSuccess={false}
    >
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="comment_id" type="hidden" value={commentId} />
      <SettledToast />
      <ActionFormFieldset className="grid">
        <Dialog>
          <DialogTrigger
            render={
              <Button
                size="sm"
                type="button"
                variant={action === "purge" ? "destructive" : "outline"}
              />
            }
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
              {action === "hide" ? (
                <>
                  <ActionFormIdle>
                    <Message message="admin.comments.hide" />
                  </ActionFormIdle>
                  <ActionFormPending>
                    <Message message="admin.comments.hiding" />
                  </ActionFormPending>
                </>
              ) : (
                <>
                  <ActionFormIdle>
                    <Message message="admin.comments.purge" />
                  </ActionFormIdle>
                  <ActionFormPending>
                    <Message message="admin.comments.purging" />
                  </ActionFormPending>
                </>
              )}
            </Suspense>
          </DialogTrigger>
          <DialogPortal>
            <DialogBackdrop />
            <DialogViewport>
              <DialogPopup>
                <DialogHeader>
                  <DialogTitle className="text-lg font-semibold">
                    <Suspense fallback={<SkeletonLine className="h-5 w-48" />}>
                      {action === "hide" ? (
                        <Message message="admin.comments.hide_confirm_title" />
                      ) : (
                        <Message message="admin.comments.purge_confirm_title" />
                      )}
                    </Suspense>
                  </DialogTitle>
                  <DialogDescription className="text-sm text-muted-foreground">
                    <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                      {action === "hide" ? (
                        <Message message="admin.comments.hide_confirm_description" />
                      ) : (
                        <Message message="admin.comments.purge_confirm_description" />
                      )}
                    </Suspense>
                  </DialogDescription>
                </DialogHeader>

                <Field className="mt-4">
                  <FieldLabel required={action === "purge"}>
                    <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                      {action === "hide" ? (
                        <Message message="admin.comments.reason_optional" />
                      ) : (
                        <Message message="admin.comments.reason_required" />
                      )}
                    </Suspense>
                  </FieldLabel>
                  <FieldContent>
                    <Suspense fallback={<Skeleton className="h-24 w-full" />}>
                      <CommentReasonInput formId={formId} />
                    </Suspense>
                  </FieldContent>
                </Field>

                <DialogFooter>
                  <DialogClose
                    render={<Button type="button" variant="outline" />}
                  >
                    <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                      <Message message="admin.common.cancel" />
                    </Suspense>
                  </DialogClose>
                  <DialogClose
                    form={formId}
                    render={
                      <Button
                        variant={action === "purge" ? "destructive" : "default"}
                      />
                    }
                    type="submit"
                  >
                    <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                      {action === "hide" ? (
                        <Message message="admin.comments.hide_confirm_action" />
                      ) : (
                        <Message message="admin.comments.purge_confirm_action" />
                      )}
                    </Suspense>
                  </DialogClose>
                </DialogFooter>
              </DialogPopup>
            </DialogViewport>
          </DialogPortal>
        </Dialog>
      </ActionFormFieldset>
    </ActionForm>
  );
};
