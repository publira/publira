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
import { useActionState, useRef } from "react";
import type { ReactNode } from "react";

import { ClientMessage } from "#components/client-message";
import { useTenantId } from "#lib/use-tenant-id";

import { closeRoyaltyStatementAction } from "../_lib/actions";

interface CloseStatementButtonProps {
  period: string;
  /** Names the month, already worded for the reader. */
  confirmTitle: ReactNode;
  /** States the total payout the close fixes, already worded for the reader. */
  confirmDescription: ReactNode;
}

/**
 * Closes one month after the operator has confirmed its period and payout. The
 * button stays disabled while the close is in flight, and a successful close
 * leaves this screen for the statement, so the same month is never sent twice
 * from here; a second close from elsewhere is refused by the API.
 */
export const CloseStatementButton = ({
  confirmDescription,
  confirmTitle,
  period,
}: CloseStatementButtonProps) => {
  const tenantId = useTenantId();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, isPending] = useActionState(
    closeRoyaltyStatementAction,
    null
  );

  return (
    <form
      action={formAction}
      className="grid justify-items-start gap-2"
      ref={formRef}
    >
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="period" type="hidden" value={period} />
      <ConfirmDialog>
        <ConfirmDialogTrigger
          render={<Button disabled={isPending} type="button" />}
        >
          <ActionFormIdle>
            <ClientMessage message="admin.royalties.close.button" />
          </ActionFormIdle>
          <ActionFormPending>
            <ClientMessage message="admin.royalties.close.closing" />
          </ActionFormPending>
        </ConfirmDialogTrigger>
        <ConfirmDialogContent>
          <ConfirmDialogHeader>
            <ConfirmDialogTitle>{confirmTitle}</ConfirmDialogTitle>
            <ConfirmDialogDescription>
              {confirmDescription}
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
              <ClientMessage message="admin.royalties.close.confirm_action" />
            </ConfirmDialogAction>
          </ConfirmDialogFooter>
        </ConfirmDialogContent>
      </ConfirmDialog>
      {state ? (
        <FormMessage variant="destructive">{state.message}</FormMessage>
      ) : null}
    </form>
  );
};
