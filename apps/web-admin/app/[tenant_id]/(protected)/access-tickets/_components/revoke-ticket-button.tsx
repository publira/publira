"use client";

import { getMessage } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import { useToastManager } from "@publira/ui-components";
import { Button } from "@publira/ui-components/button";
import { ConfirmDialog } from "@publira/ui-components/dialog";
import { FormMessage } from "@publira/ui-components/form-message";
import { useActionState, useContext, useRef } from "react";

import { AdminLocaleContext } from "#components/admin-locale-context";
import { useTenantId } from "#lib/use-tenant-id";

import { revokeAccessTicketAction } from "../_lib/actions";
import type { RevokeAccessTicketActionState } from "../ticket-types";

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
          title: getMessage(messages, "admin.access_tickets.revoked"),
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
      <ConfirmDialog
        actionText={getMessage(
          messages,
          "admin.access_tickets.revoke_confirm_action"
        )}
        actionVariant="destructive"
        cancelText={getMessage(messages, "admin.common.cancel")}
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
