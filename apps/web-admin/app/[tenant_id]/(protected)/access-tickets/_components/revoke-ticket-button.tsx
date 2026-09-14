"use client";

import { useToastManager } from "@publira/ui-components";
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
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense, useActionState, useRef } from "react";

import { useAdminMessages } from "#components/admin-locale-context";
import { ClientMessage } from "#components/client-message";
import { useTenantId } from "#lib/use-tenant-id";

import { revokeAccessTicketAction } from "../_lib/actions";
import type { RevokeAccessTicketActionState } from "../ticket-types";

interface RevokeTicketButtonProps {
  publicId: string;
}

export const RevokeTicketButton = ({ publicId }: RevokeTicketButtonProps) => {
  const t = useAdminMessages();
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
    <div className="grid gap-1">
      <form action={formAction} className="hidden" ref={formRef}>
        <input name="tenant_id" type="hidden" value={tenantId} />
        <input name="public_id" type="hidden" value={publicId} />
      </form>
      <ConfirmDialog>
        <ConfirmDialogTrigger
          render={
            <Button
              disabled={isPending}
              size="sm"
              type="button"
              variant="outline"
            >
              {isPending
                ? t("admin.access_tickets.revoking")
                : t("admin.access_tickets.revoke")}
            </Button>
          }
        />
        <ConfirmDialogContent>
          <ConfirmDialogHeader>
            <ConfirmDialogTitle>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <ClientMessage message="admin.access_tickets.revoke_confirm_title" />
              </Suspense>
            </ConfirmDialogTitle>
            <ConfirmDialogDescription>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <ClientMessage message="admin.access_tickets.revoke_confirm_description" />
              </Suspense>
            </ConfirmDialogDescription>
          </ConfirmDialogHeader>
          <ConfirmDialogFooter>
            <ConfirmDialogCancel>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <ClientMessage message="admin.common.cancel" />
              </Suspense>
            </ConfirmDialogCancel>
            <ConfirmDialogAction
              onClick={() => {
                formRef.current?.requestSubmit();
              }}
            >
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <ClientMessage message="admin.access_tickets.revoke_confirm_action" />
              </Suspense>
            </ConfirmDialogAction>
          </ConfirmDialogFooter>
        </ConfirmDialogContent>
      </ConfirmDialog>
      {state && !state.ok && state.publicId === publicId ? (
        <FormMessage variant="destructive">{state.message}</FormMessage>
      ) : null}
    </div>
  );
};
