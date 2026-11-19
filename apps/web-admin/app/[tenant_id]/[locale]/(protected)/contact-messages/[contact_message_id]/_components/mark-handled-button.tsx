import * as ActionForm from "@publira/ui-components/action-form";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";

import { markContactMessageHandledAction } from "../_lib/actions";

interface MarkHandledButtonProps {
  contactMessageId: string;
  publicId: string;
  tenantId: string;
}

/**
 * Marks the message dealt with, without a confirmation: it takes nothing away,
 * and putting the message back among the waiting undoes it.
 */
export const MarkHandledButton = ({
  contactMessageId,
  publicId,
  tenantId,
}: MarkHandledButtonProps) => (
  <ActionForm.Root
    action={markContactMessageHandledAction}
    className="grid gap-1"
  >
    <input name="tenant_id" type="hidden" value={tenantId} />
    <input name="contact_message_id" type="hidden" value={contactMessageId} />
    <input name="public_id" type="hidden" value={publicId} />
    <ActionForm.Submit>
      <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
        <ActionForm.Idle>
          <Message message="admin.contact_messages.mark_handled" />
        </ActionForm.Idle>
        <ActionForm.Pending>
          <Message message="admin.contact_messages.marking_handled" />
        </ActionForm.Pending>
      </Suspense>
    </ActionForm.Submit>
  </ActionForm.Root>
);
