import * as ActionForm from "@publira/ui-components/action-form";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";

import { reopenContactMessageAction } from "../_lib/actions";

interface ReopenMessageButtonProps {
  contactMessageId: string;
  publicId: string;
  tenantId: string;
}

/** Puts the message back among the ones still waiting for an answer. */
export const ReopenMessageButton = ({
  contactMessageId,
  publicId,
  tenantId,
}: ReopenMessageButtonProps) => (
  <ActionForm.Root action={reopenContactMessageAction} className="grid gap-1">
    <input name="tenant_id" type="hidden" value={tenantId} />
    <input name="contact_message_id" type="hidden" value={contactMessageId} />
    <input name="public_id" type="hidden" value={publicId} />
    <ActionForm.Submit variant="outline">
      <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
        <ActionForm.Idle>
          <Message message="admin.contact_messages.reopen" />
        </ActionForm.Idle>
        <ActionForm.Pending>
          <Message message="admin.contact_messages.reopening" />
        </ActionForm.Pending>
      </Suspense>
    </ActionForm.Submit>
  </ActionForm.Root>
);
