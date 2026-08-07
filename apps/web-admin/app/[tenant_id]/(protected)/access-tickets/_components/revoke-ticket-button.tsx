"use client";

import { Button } from "@publira/ui-components/button";
import { FormMessage } from "@publira/ui-components/form-message";
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";

import { useTenantId } from "#lib/use-tenant-id";

import { revokeAccessTicketAction } from "../_lib/actions";

interface RevokeTicketButtonProps {
  publicId: string;
}

export const RevokeTicketButton = ({ publicId }: RevokeTicketButtonProps) => {
  const tenantId = useTenantId();
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(
    revokeAccessTicketAction,
    null
  );

  useEffect(() => {
    if (state?.ok) {
      router.refresh();
    }
  }, [router, state]);

  return (
    <form action={formAction} className="grid gap-1">
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="public_id" type="hidden" value={publicId} />
      <Button disabled={isPending} size="sm" type="submit" variant="outline">
        {isPending ? "失効中…" : "失効"}
      </Button>
      {state && !state.ok && state.publicId === publicId ? (
        <FormMessage variant="destructive">{state.message}</FormMessage>
      ) : null}
    </form>
  );
};
