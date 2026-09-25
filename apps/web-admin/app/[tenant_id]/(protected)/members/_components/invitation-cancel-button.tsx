"use client";

import {
  ActionFormIdle,
  ActionFormPending,
} from "@publira/ui-components/action-form";
import type { FormActionState } from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import {
  ConfirmDialog,
  ConfirmDialogAction,
  ConfirmDialogCancel,
  ConfirmDialogContent,
  ConfirmDialogDescription,
  ConfirmDialogFooter,
  ConfirmDialogHeader,
  ConfirmDialogTitle,
  ConfirmDialogTrigger,
} from "@publira/ui-components/dialog";
import { FormMessage } from "@publira/ui-components/form-message";
import { useToastManager } from "@publira/ui-components/toast";
import { useActionState, useRef } from "react";

import { ClientMessage } from "#components/client-message";
import { useTenantId } from "#lib/use-tenant-id";

import { cancelTenantAdminInvitationAction } from "../_lib/actions";

interface InvitationCancelButtonProps {
  email: string;
  invitationId: string;
}

/** Stops one pending invitation link from working, once confirmed. */
export const InvitationCancelButton = ({
  email,
  invitationId,
}: InvitationCancelButtonProps) => {
  const tenantId = useTenantId();
  const { add } = useToastManager();
  const formRef = useRef<HTMLFormElement>(null);
  // The row stays, relabelled as canceled, and loses this button with it, so
  // success is announced by a toast rather than next to the button.
  const [state, formAction, isPending] = useActionState(
    async (
      previousState: FormActionState,
      formData: FormData
    ): Promise<FormActionState> => {
      const nextState = await cancelTenantAdminInvitationAction(
        previousState,
        formData
      );
      if (nextState?.ok) {
        add({ title: nextState.message, type: "success" });
      }
      return nextState;
    },
    null
  );

  return (
    <form action={formAction} className="grid gap-1" ref={formRef}>
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="invitation_id" type="hidden" value={invitationId} />
      <ConfirmDialog>
        <ConfirmDialogTrigger
          render={
            <Button
              disabled={isPending}
              size="sm"
              type="button"
              variant="destructive"
            >
              <ActionFormIdle>
                <ClientMessage message="admin.members.cancel_action" />
              </ActionFormIdle>
              <ActionFormPending>
                <ClientMessage message="admin.members.canceling" />
              </ActionFormPending>
            </Button>
          }
        />
        <ConfirmDialogContent>
          <ConfirmDialogHeader>
            <ConfirmDialogTitle>
              <ClientMessage message="admin.members.cancel_confirm_title" />
            </ConfirmDialogTitle>
            <ConfirmDialogDescription>
              <ClientMessage
                message="admin.members.cancel_confirm_description"
                values={{ email }}
              />
            </ConfirmDialogDescription>
          </ConfirmDialogHeader>
          <ConfirmDialogFooter>
            <ConfirmDialogCancel>
              <ClientMessage message="admin.common.cancel" />
            </ConfirmDialogCancel>
            <ConfirmDialogAction
              onClick={() => {
                formRef.current?.requestSubmit();
              }}
            >
              <ClientMessage message="admin.members.cancel_confirm_action" />
            </ConfirmDialogAction>
          </ConfirmDialogFooter>
        </ConfirmDialogContent>
      </ConfirmDialog>
      {state && !state.ok ? (
        <FormMessage variant="destructive">{state.message}</FormMessage>
      ) : null}
    </form>
  );
};
