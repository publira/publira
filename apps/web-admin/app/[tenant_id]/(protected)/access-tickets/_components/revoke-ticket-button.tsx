"use client";

import { useToastManager } from "@publira/ui-components";
import { Button } from "@publira/ui-components/button";
import { ConfirmDialog } from "@publira/ui-components/dialog";
import { FormMessage } from "@publira/ui-components/form-message";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useEffectEvent, useRef } from "react";

import { useTenantId } from "#lib/use-tenant-id";

import { revokeAccessTicketAction } from "../_lib/actions";

interface RevokeTicketButtonProps {
  publicId: string;
}

export const RevokeTicketButton = ({ publicId }: RevokeTicketButtonProps) => {
  const tenantId = useTenantId();
  const router = useRouter();
  const { add } = useToastManager();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, isPending] = useActionState(
    revokeAccessTicketAction,
    null
  );

  const onRevoked = useEffectEvent(() => {
    add({ title: "チケットを失効しました。", type: "success" });
    router.refresh();
  });

  useEffect(() => {
    if (!state?.ok || state.publicId !== publicId) {
      return;
    }
    onRevoked();
  }, [publicId, state]);

  return (
    <div className="grid gap-1">
      <form action={formAction} className="hidden" ref={formRef}>
        <input name="tenant_id" type="hidden" value={tenantId} />
        <input name="public_id" type="hidden" value={publicId} />
      </form>
      <ConfirmDialog
        actionText="失効する"
        actionVariant="destructive"
        description="失効したチケットでは対象エピソードを閲覧できなくなります。同じユーザーへ再度付与するには、失効後に発行し直してください。"
        onAction={() => {
          formRef.current?.requestSubmit();
        }}
        title="このチケットを失効しますか？"
        trigger={
          <Button
            disabled={isPending}
            size="sm"
            type="button"
            variant="outline"
          >
            {isPending ? "失効中…" : "失効"}
          </Button>
        }
      />
      {state && !state.ok && state.publicId === publicId ? (
        <FormMessage variant="destructive">{state.message}</FormMessage>
      ) : null}
    </div>
  );
};
