"use client";

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

import { ClientMessage, useClientMessages } from "#components/client-message";
import { useTenantId } from "#lib/use-tenant-id";

import { deleteReaderAction } from "../_lib/actions";

interface DeleteReaderButtonProps {
  /** The name the confirmation calls the reader by. */
  name: string;
  publicId: string;
}

/**
 * Deletes the reader's account once staff confirm it. Success leaves this page
 * for the readers list, which raises the toast.
 */
export const DeleteReaderButton = ({
  name,
  publicId,
}: DeleteReaderButtonProps) => {
  const t = useClientMessages();
  const tenantId = useTenantId();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, isPending] = useActionState(
    deleteReaderAction,
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
            <Button disabled={isPending} type="button" variant="destructive">
              {isPending
                ? t("admin.readers.deleting")
                : t("admin.readers.delete")}
            </Button>
          }
        />
        <ConfirmDialogContent>
          <ConfirmDialogHeader>
            <ConfirmDialogTitle>
              <ClientMessage
                message="admin.readers.delete_confirm_title"
                values={{ name }}
              />
            </ConfirmDialogTitle>
            <ConfirmDialogDescription>
              <ClientMessage message="admin.readers.delete_confirm_description" />
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
              <ClientMessage message="admin.readers.delete_confirm_action" />
            </ConfirmDialogAction>
          </ConfirmDialogFooter>
        </ConfirmDialogContent>
      </ConfirmDialog>
      {state && !state.ok ? (
        <FormMessage variant="destructive">{state.message}</FormMessage>
      ) : null}
    </div>
  );
};
