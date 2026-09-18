import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import {
  ActionForm,
  ActionFormIdle,
  ActionFormPending,
  ActionFormSubmit,
} from "#components/action-form";
import { Message } from "#components/message";

import { reopenContactMessageAction } from "../_lib/actions";

interface ReopenMessageButtonProps {
  publicId: string;
  tenantId: string;
}

/** Puts the message back among the ones still waiting for an answer. */
export const ReopenMessageButton = ({
  publicId,
  tenantId,
}: ReopenMessageButtonProps) => (
  <ActionForm action={reopenContactMessageAction} className="grid gap-1">
    <input name="tenant_id" type="hidden" value={tenantId} />
    <input name="public_id" type="hidden" value={publicId} />
    <ActionFormSubmit variant="outline">
      <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
        <ActionFormIdle>
          <Message message="admin.contact_messages.reopen" />
        </ActionFormIdle>
        <ActionFormPending>
          <Message message="admin.contact_messages.reopening" />
        </ActionFormPending>
      </Suspense>
    </ActionFormSubmit>
  </ActionForm>
);
