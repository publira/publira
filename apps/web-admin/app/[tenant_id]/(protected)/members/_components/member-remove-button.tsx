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

import { removeTenantMemberAction } from "../_lib/actions";

interface MemberRemoveButtonProps {
  name: string;
  userPublicId: string;
}

/**
 * Takes every console role away from one member, once the admin has
 * confirmed it. A refusal stays next to the row: removing the tenant's last
 * admin is the case the API turns down, and the row is still there to say so.
 */
export const MemberRemoveButton = ({
  name,
  userPublicId,
}: MemberRemoveButtonProps) => {
  const tenantId = useTenantId();
  const { add } = useToastManager();
  const formRef = useRef<HTMLFormElement>(null);
  // The row goes away with the member, so success is announced by a toast.
  const [state, formAction, isPending] = useActionState(
    async (
      previousState: FormActionState,
      formData: FormData
    ): Promise<FormActionState> => {
      const nextState = await removeTenantMemberAction(previousState, formData);
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
      <input name="user_public_id" type="hidden" value={userPublicId} />
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
                <ClientMessage message="admin.members.remove_action" />
              </ActionFormIdle>
              <ActionFormPending>
                <ClientMessage message="admin.members.removing" />
              </ActionFormPending>
            </Button>
          }
        />
        <ConfirmDialogContent>
          <ConfirmDialogHeader>
            <ConfirmDialogTitle>
              <ClientMessage message="admin.members.remove_confirm_title" />
            </ConfirmDialogTitle>
            <ConfirmDialogDescription>
              <ClientMessage
                message="admin.members.remove_confirm_description"
                values={{ name }}
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
              <ClientMessage message="admin.members.remove_confirm_action" />
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
