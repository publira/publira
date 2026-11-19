import * as ActionForm from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import * as ConfirmDialog from "@publira/ui-components/confirm-dialog";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";

import { deleteReaderAction } from "../_lib/actions";

interface DeleteReaderButtonProps {
  /** The name the confirmation calls the reader by. */
  name: string;
  publicId: string;
  readerId: string;
  tenantId: string;
}

/**
 * Deletes the reader's account once staff confirm it. Success leaves for the
 * readers list, which raises the toast.
 */
export const DeleteReaderButton = ({
  name,
  publicId,
  readerId,
  tenantId,
}: DeleteReaderButtonProps) => {
  const formId = `delete-reader-${publicId}`;

  return (
    <ActionForm.Root
      action={deleteReaderAction}
      className="grid gap-1"
      id={formId}
    >
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="public_id" type="hidden" value={publicId} />
      <input name="reader_id" type="hidden" value={readerId} />
      <ConfirmDialog.Root>
        <ConfirmDialog.Trigger
          render={<Button type="button" variant="destructive" />}
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
            <ActionForm.Idle>
              <Message message="admin.readers.delete" />
            </ActionForm.Idle>
            <ActionForm.Pending>
              <Message message="admin.readers.deleting" />
            </ActionForm.Pending>
          </Suspense>
        </ConfirmDialog.Trigger>
        <ConfirmDialog.Content>
          <ConfirmDialog.Header>
            <ConfirmDialog.Title>
              <Suspense fallback={<SkeletonLine className="h-5 w-48" />}>
                <Message
                  message="admin.readers.delete_confirm_title"
                  values={{ name }}
                />
              </Suspense>
            </ConfirmDialog.Title>
            <ConfirmDialog.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                <Message message="admin.readers.delete_confirm_description" />
              </Suspense>
            </ConfirmDialog.Description>
          </ConfirmDialog.Header>
          <ConfirmDialog.Footer>
            <ConfirmDialog.Cancel>
              <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                <Message message="admin.common.cancel" />
              </Suspense>
            </ConfirmDialog.Cancel>
            <ConfirmDialog.Action form={formId}>
              <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                <Message message="admin.readers.delete_confirm_action" />
              </Suspense>
            </ConfirmDialog.Action>
          </ConfirmDialog.Footer>
        </ConfirmDialog.Content>
      </ConfirmDialog.Root>
    </ActionForm.Root>
  );
};
