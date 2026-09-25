"use client";

import {
  ActionFormIdle,
  ActionFormPending,
} from "@publira/ui-components/action-form";
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

import { ClientMessage, useClientMessages } from "#components/client-message";
import { useTenantId } from "#lib/use-tenant-id";

import { revokeAccessTicketAction } from "../_lib/actions";
import type { RevokeAccessTicketActionState } from "../ticket-types";

interface RevokeTicketButtonProps {
  publicId: string;
}

export const RevokeTicketButton = ({ publicId }: RevokeTicketButtonProps) => {
  const t = useClientMessages();
  const tenantId = useTenantId();
  const { add } = useToastManager();
  const formRef = useRef<HTMLFormElement>(null);
  // Confirming the dialog is what raises the toast. The Action revalidates the
  // ticket list itself, so nothing here has to ask the router for a refresh.
  const [state, formAction, isPending] = useActionState(
    async (
      previousState: RevokeAccessTicketActionState,
      formData: FormData
    ): Promise<RevokeAccessTicketActionState> => {
      const nextState = await revokeAccessTicketAction(previousState, formData);
      if (nextState?.ok) {
        add({
          title: t("admin.access_tickets.revoked"),
          type: "success",
        });
      }
      return nextState;
    },
    null
  );

  return (
    <form action={formAction} className="grid gap-1" ref={formRef}>
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="public_id" type="hidden" value={publicId} />
      <ConfirmDialog>
        <ConfirmDialogTrigger
          render={
            <Button
              disabled={isPending}
              size="sm"
              type="button"
              variant="outline"
            >
              <ActionFormIdle>
                <ClientMessage message="admin.access_tickets.revoke" />
              </ActionFormIdle>
              <ActionFormPending>
                <ClientMessage message="admin.access_tickets.revoking" />
              </ActionFormPending>
            </Button>
          }
        />
        <ConfirmDialogContent>
          <ConfirmDialogHeader>
            <ConfirmDialogTitle>
              <ClientMessage message="admin.access_tickets.revoke_confirm_title" />
            </ConfirmDialogTitle>
            <ConfirmDialogDescription>
              <ClientMessage message="admin.access_tickets.revoke_confirm_description" />
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
              <ClientMessage message="admin.access_tickets.revoke_confirm_action" />
            </ConfirmDialogAction>
          </ConfirmDialogFooter>
        </ConfirmDialogContent>
      </ConfirmDialog>
      {state && !state.ok && state.publicId === publicId ? (
        <FormMessage variant="destructive">{state.message}</FormMessage>
      ) : null}
    </form>
  );
};
