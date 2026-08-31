"use client";

import { getMessage } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import { useToastManager } from "@publira/ui-components";
import { Button } from "@publira/ui-components/button";
import { ConfirmDialog } from "@publira/ui-components/dialog";
import { FormMessage } from "@publira/ui-components/form-message";
import { useRouter } from "next/navigation";
import {
  useActionState,
  useContext,
  useEffect,
  useEffectEvent,
  useRef,
} from "react";

import { AdminLocaleContext } from "#components/admin-locale-context";
import { useTenantId } from "#lib/use-tenant-id";

import { revokeAccessTicketAction } from "../_lib/actions";

interface RevokeTicketButtonProps {
  publicId: string;
}

export const RevokeTicketButton = ({ publicId }: RevokeTicketButtonProps) => {
  const locale = useContext(AdminLocaleContext);
  if (locale === null) {
    throw new Error("AdminLocaleProvider is required.");
  }
  const messages = sharedCatalog(locale);
  const tenantId = useTenantId();
  const router = useRouter();
  const { add } = useToastManager();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, isPending] = useActionState(
    revokeAccessTicketAction,
    null
  );

  const onRevoked = useEffectEvent(() => {
    add({
      title: getMessage(messages, "admin.access_tickets.revoked"),
      type: "success",
    });
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
        actionText={getMessage(
          messages,
          "admin.access_tickets.revoke_confirm_action"
        )}
        actionVariant="destructive"
        description={getMessage(
          messages,
          "admin.access_tickets.revoke_confirm_description"
        )}
        onAction={() => {
          formRef.current?.requestSubmit();
        }}
        title={getMessage(
          messages,
          "admin.access_tickets.revoke_confirm_title"
        )}
        trigger={
          <Button
            disabled={isPending}
            size="sm"
            type="button"
            variant="outline"
          >
            {isPending
              ? getMessage(messages, "admin.access_tickets.revoking")
              : getMessage(messages, "admin.access_tickets.revoke")}
          </Button>
        }
      />
      {state && !state.ok && state.publicId === publicId ? (
        <FormMessage variant="destructive">{state.message}</FormMessage>
      ) : null}
    </div>
  );
};
