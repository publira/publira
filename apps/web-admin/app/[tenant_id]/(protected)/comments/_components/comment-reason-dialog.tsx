"use client";

import {
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
import { FormMessage } from "@publira/ui-components/form-message";
import { Textarea } from "@publira/ui-components/textarea";
import { useToastManager } from "@publira/ui-components/toast";
import { useActionState, useContext, useRef } from "react";

import { AdminLocaleContext } from "#components/admin-locale-context";
import { ClientMessage, useClientMessages } from "#components/client-message";
import { useTenantId } from "#lib/use-tenant-id";

import { hideCommentAction, purgeCommentAction } from "../_lib/actions";
import type { CommentActionState } from "../comment-types";

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
  publicId: string;
}

/** What the toast says once the removal has landed. */
const ReasonActionDone = ({ action }: { action: ReasonCommentAction }) =>
  action === "hide" ? (
    <ClientMessage message="admin.comments.hidden" />
  ) : (
    <ClientMessage message="admin.comments.purged" />
  );

export const CommentReasonDialog = ({
  action,
  publicId,
}: CommentReasonDialogProps) => {
  const locale = useContext(AdminLocaleContext);
  if (locale === null) {
    throw new Error("AdminLocaleProvider is required.");
  }
  const t = useClientMessages();
  const tenantId = useTenantId();
  const { add } = useToastManager();
  // A public id is unique across the tenant, so it is enough to keep the two
  // dialogs of one row — and every other row on the screen — apart. `useId` is
  // avoided on purpose: its value carries characters an `id` reference does not
  // need to be tested against.
  const formId = `comment-${action}-${publicId}`;
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, isPending] = useActionState(
    async (
      previousState: CommentActionState,
      formData: FormData
    ): Promise<CommentActionState> => {
      const nextState = await (action === "hide"
        ? hideCommentAction(previousState, formData)
        : purgeCommentAction(previousState, formData));
      if (nextState?.ok) {
        add({ title: <ReasonActionDone action={action} />, type: "success" });
      }
      return nextState;
    },
    null
  );

  return (
    // The form wraps the dialog rather than sitting in its popup, and the reason
    // field joins it through `form=`, so confirming submits a form that is
    // still mounted while the popup is being torn down. Keeping the fields
    // inside the popup instead would race the unmount for the submit.
    <form action={formAction} className="grid gap-1" id={formId} ref={formRef}>
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="public_id" type="hidden" value={publicId} />
      <Dialog>
        <DialogTrigger
          render={
            <Button
              disabled={isPending}
              size="sm"
              type="button"
              variant={action === "purge" ? "destructive" : "outline"}
            >
              {action === "hide" ? (
                <>
                  <ActionFormIdle>
                    <ClientMessage message="admin.comments.hide" />
                  </ActionFormIdle>
                  <ActionFormPending>
                    <ClientMessage message="admin.comments.hiding" />
                  </ActionFormPending>
                </>
              ) : (
                <>
                  <ActionFormIdle>
                    <ClientMessage message="admin.comments.purge" />
                  </ActionFormIdle>
                  <ActionFormPending>
                    <ClientMessage message="admin.comments.purging" />
                  </ActionFormPending>
                </>
              )}
            </Button>
          }
        />
        <DialogPortal>
          <DialogBackdrop />
          <DialogViewport>
            <DialogPopup>
              <DialogHeader>
                <DialogTitle className="text-lg font-semibold">
                  {action === "hide" ? (
                    <ClientMessage message="admin.comments.hide_confirm_title" />
                  ) : (
                    <ClientMessage message="admin.comments.purge_confirm_title" />
                  )}
                </DialogTitle>
                <DialogDescription className="text-sm text-muted-foreground">
                  {action === "hide" ? (
                    <ClientMessage message="admin.comments.hide_confirm_description" />
                  ) : (
                    <ClientMessage message="admin.comments.purge_confirm_description" />
                  )}
                </DialogDescription>
              </DialogHeader>

              <Field className="mt-4">
                <FieldLabel required={action === "purge"}>
                  {action === "hide" ? (
                    <ClientMessage message="admin.comments.reason_optional" />
                  ) : (
                    <ClientMessage message="admin.comments.reason_required" />
                  )}
                </FieldLabel>
                <FieldContent>
                  <Textarea
                    form={formId}
                    name="reason"
                    placeholder={t("admin.comments.reason_placeholder")}
                  />
                </FieldContent>
              </Field>

              <DialogFooter>
                <DialogClose
                  render={
                    <Button type="button" variant="outline">
                      {t("admin.common.cancel")}
                    </Button>
                  }
                />
                <DialogClose
                  onClick={() => {
                    formRef.current?.requestSubmit();
                  }}
                  render={
                    <Button
                      type="button"
                      variant={action === "purge" ? "destructive" : "default"}
                    >
                      {action === "hide" ? (
                        <ClientMessage message="admin.comments.hide_confirm_action" />
                      ) : (
                        <ClientMessage message="admin.comments.purge_confirm_action" />
                      )}
                    </Button>
                  }
                />
              </DialogFooter>
            </DialogPopup>
          </DialogViewport>
        </DialogPortal>
      </Dialog>
      {state && !state.ok && state.publicId === publicId ? (
        <FormMessage variant="destructive">{state.message}</FormMessage>
      ) : null}
    </form>
  );
};
