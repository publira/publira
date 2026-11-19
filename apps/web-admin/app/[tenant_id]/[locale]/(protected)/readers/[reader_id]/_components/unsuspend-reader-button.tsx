import * as ActionForm from "@publira/ui-components/action-form";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";

import { unsuspendReaderAction } from "../_lib/actions";

interface UnsuspendReaderButtonProps {
  publicId: string;
  readerId: string;
  tenantId: string;
}

/**
 * Lifts the suspension without a confirmation: it takes nothing away, and
 * suspending again undoes it.
 */
export const UnsuspendReaderButton = ({
  publicId,
  readerId,
  tenantId,
}: UnsuspendReaderButtonProps) => (
  <ActionForm.Root action={unsuspendReaderAction} className="grid gap-1">
    <input name="tenant_id" type="hidden" value={tenantId} />
    <input name="public_id" type="hidden" value={publicId} />
    <input name="reader_id" type="hidden" value={readerId} />
    <ActionForm.Submit variant="outline">
      <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
        <ActionForm.Idle>
          <Message message="admin.readers.unsuspend" />
        </ActionForm.Idle>
        <ActionForm.Pending>
          <Message message="admin.readers.unsuspending" />
        </ActionForm.Pending>
      </Suspense>
    </ActionForm.Submit>
  </ActionForm.Root>
);
