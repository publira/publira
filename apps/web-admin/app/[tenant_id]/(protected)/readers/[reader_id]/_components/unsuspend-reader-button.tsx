import {
  ActionForm,
  ActionFormIdle,
  ActionFormPending,
  ActionFormSubmit,
} from "@publira/ui-components/action-form";
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
  <ActionForm action={unsuspendReaderAction} className="grid gap-1">
    <input name="tenant_id" type="hidden" value={tenantId} />
    <input name="public_id" type="hidden" value={publicId} />
    <input name="reader_id" type="hidden" value={readerId} />
    <ActionFormSubmit variant="outline">
      <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
        <ActionFormIdle>
          <Message message="admin.readers.unsuspend" />
        </ActionFormIdle>
        <ActionFormPending>
          <Message message="admin.readers.unsuspending" />
        </ActionFormPending>
      </Suspense>
    </ActionFormSubmit>
  </ActionForm>
);
