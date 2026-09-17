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
import { useActionState, useRef } from "react";

import { ClientMessage, useClientMessages } from "#components/client-message";
import { useTenantId } from "#lib/use-tenant-id";

import type { ReaderActionState } from "../../reader-types";
import { suspendReaderAction } from "../_lib/actions";

interface SuspendReaderButtonProps {
  /** The name the confirmation calls the reader by. */
  name: string;
  publicId: string;
}

/** Suspends the reader once staff confirm it, since it signs them out too. */
export const SuspendReaderButton = ({
  name,
  publicId,
}: SuspendReaderButtonProps) => {
  const t = useClientMessages();
  const tenantId = useTenantId();
  const { add } = useToastManager();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, isPending] = useActionState(
    async (
      previousState: ReaderActionState,
      formData: FormData
    ): Promise<ReaderActionState> => {
      const nextState = await suspendReaderAction(previousState, formData);
      if (nextState?.ok) {
        add({ title: t("admin.readers.suspended"), type: "success" });
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
            <Button disabled={isPending} type="button" variant="outline">
              {isPending
                ? t("admin.readers.suspending")
                : t("admin.readers.suspend")}
            </Button>
          }
        />
        <ConfirmDialogContent>
          <ConfirmDialogHeader>
            <ConfirmDialogTitle>
              <ClientMessage
                message="admin.readers.suspend_confirm_title"
                values={{ name }}
              />
            </ConfirmDialogTitle>
            <ConfirmDialogDescription>
              <ClientMessage message="admin.readers.suspend_confirm_description" />
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
              <ClientMessage message="admin.readers.suspend_confirm_action" />
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
