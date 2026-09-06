"use client";

import { getMessage } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { useToastManager } from "@publira/ui-components";
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
import { useActionState, useContext, useRef } from "react";

import { AdminLocaleContext } from "#components/admin-locale-context";
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

interface ReasonDialogCopy {
  confirm: string;
  description: string;
  done: string;
  idle: string;
  pending: string;
  reasonLabel: string;
  reasonPlaceholder: string;
  title: string;
}

const hideCopy = (messages: SharedMessages): ReasonDialogCopy => ({
  confirm: getMessage(messages, "admin.comments.hide_confirm_action"),
  description: getMessage(messages, "admin.comments.hide_confirm_description"),
  done: getMessage(messages, "admin.comments.hidden"),
  idle: getMessage(messages, "admin.comments.hide"),
  pending: getMessage(messages, "admin.comments.hiding"),
  reasonLabel: getMessage(messages, "admin.comments.reason_optional"),
  reasonPlaceholder: getMessage(messages, "admin.comments.reason_placeholder"),
  title: getMessage(messages, "admin.comments.hide_confirm_title"),
});

const purgeCopy = (messages: SharedMessages): ReasonDialogCopy => ({
  confirm: getMessage(messages, "admin.comments.purge_confirm_action"),
  description: getMessage(messages, "admin.comments.purge_confirm_description"),
  done: getMessage(messages, "admin.comments.purged"),
  idle: getMessage(messages, "admin.comments.purge"),
  pending: getMessage(messages, "admin.comments.purging"),
  reasonLabel: getMessage(messages, "admin.comments.reason_required"),
  reasonPlaceholder: getMessage(messages, "admin.comments.reason_placeholder"),
  title: getMessage(messages, "admin.comments.purge_confirm_title"),
});

export const CommentReasonDialog = ({
  action,
  publicId,
}: CommentReasonDialogProps) => {
  const locale = useContext(AdminLocaleContext);
  if (locale === null) {
    throw new Error("AdminLocaleProvider is required.");
  }
  const messages = sharedCatalog(locale);
  const copy = action === "hide" ? hideCopy(messages) : purgeCopy(messages);
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
        add({ title: copy.done, type: "success" });
      }
      return nextState;
    },
    null
  );

  return (
    <div className="grid gap-1">
      {/*
        The form stays outside the dialog and the reason field joins it through
        `form=`, so confirming submits a form that is still mounted while the
        popup is being torn down. Keeping the fields inside the popup instead
        would race the unmount for the submit.
      */}
      <form action={formAction} className="hidden" id={formId} ref={formRef}>
        <input name="tenant_id" type="hidden" value={tenantId} />
        <input name="public_id" type="hidden" value={publicId} />
      </form>
      <Dialog>
        <DialogTrigger
          render={
            <Button
              disabled={isPending}
              size="sm"
              type="button"
              variant={action === "purge" ? "destructive" : "outline"}
            >
              {isPending ? copy.pending : copy.idle}
            </Button>
          }
        />
        <DialogPortal>
          <DialogBackdrop />
          <DialogViewport>
            <DialogPopup>
              <DialogHeader>
                <DialogTitle className="text-lg font-semibold">
                  {copy.title}
                </DialogTitle>
                <DialogDescription className="text-sm text-muted-foreground">
                  {copy.description}
                </DialogDescription>
              </DialogHeader>

              <Field className="mt-4">
                <FieldLabel required={action === "purge"}>
                  {copy.reasonLabel}
                </FieldLabel>
                <FieldContent>
                  <Textarea
                    form={formId}
                    name="reason"
                    placeholder={copy.reasonPlaceholder}
                  />
                </FieldContent>
              </Field>

              <DialogFooter>
                <DialogClose
                  render={
                    <Button type="button" variant="outline">
                      {getMessage(messages, "admin.common.cancel")}
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
                      {copy.confirm}
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
    </div>
  );
};
