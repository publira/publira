import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import {
  ActionForm,
  ActionFormIdle,
  ActionFormPending,
  ActionFormSubmit,
} from "#components/action-form";
import { Message } from "#components/message";

import { markContactMessageHandledAction } from "../_lib/actions";

interface MarkHandledButtonProps {
  publicId: string;
  tenantId: string;
}

/**
 * Marks the message dealt with, without a confirmation: it takes nothing away,
 * and putting the message back among the waiting undoes it.
 */
export const MarkHandledButton = ({
  publicId,
  tenantId,
}: MarkHandledButtonProps) => (
  <ActionForm action={markContactMessageHandledAction} className="grid gap-1">
    <input name="tenant_id" type="hidden" value={tenantId} />
    <input name="public_id" type="hidden" value={publicId} />
    <ActionFormSubmit>
      <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
        <ActionFormIdle>
          <Message message="admin.contact_messages.mark_handled" />
        </ActionFormIdle>
        <ActionFormPending>
          <Message message="admin.contact_messages.marking_handled" />
        </ActionFormPending>
      </Suspense>
    </ActionFormSubmit>
  </ActionForm>
);
