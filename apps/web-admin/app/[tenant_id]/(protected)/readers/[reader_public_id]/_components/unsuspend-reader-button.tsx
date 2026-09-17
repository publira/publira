"use client";

import { useToastManager } from "@publira/ui-components";
import { Button } from "@publira/ui-components/button";
import { FormMessage } from "@publira/ui-components/form-message";
import { useActionState } from "react";

import { useClientMessages } from "#components/client-message";
import { useTenantId } from "#lib/use-tenant-id";

import type { ReaderActionState } from "../../reader-types";
import { unsuspendReaderAction } from "../_lib/actions";

interface UnsuspendReaderButtonProps {
  publicId: string;
}

/**
 * Lifts the suspension without a confirmation: it takes nothing away, and
 * suspending again undoes it.
 */
export const UnsuspendReaderButton = ({
  publicId,
}: UnsuspendReaderButtonProps) => {
  const t = useClientMessages();
  const tenantId = useTenantId();
  const { add } = useToastManager();
  const [state, formAction, isPending] = useActionState(
    async (
      previousState: ReaderActionState,
      formData: FormData
    ): Promise<ReaderActionState> => {
      const nextState = await unsuspendReaderAction(previousState, formData);
      if (nextState?.ok) {
        add({ title: t("admin.readers.unsuspended"), type: "success" });
      }
      return nextState;
    },
    null
  );

  return (
    <form action={formAction} className="grid gap-1">
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="public_id" type="hidden" value={publicId} />
      <Button disabled={isPending} type="submit" variant="outline">
        {isPending
          ? t("admin.readers.unsuspending")
          : t("admin.readers.unsuspend")}
      </Button>
      {state && !state.ok ? (
        <FormMessage variant="destructive">{state.message}</FormMessage>
      ) : null}
    </form>
  );
};
