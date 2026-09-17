import { Button } from "@publira/ui-components/button";
import {
  ConfirmDialog,
  ConfirmDialogAction,
  ConfirmDialogCancel,
  ConfirmDialogContent,
  ConfirmDialogDescription,
  ConfirmDialogFooter,
  ConfirmDialogHeader,
  ConfirmDialogTitle,
  ConfirmDialogTrigger,
} from "@publira/ui-components/dialog";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import {
  ActionForm,
  ActionFormIdle,
  ActionFormPending,
} from "#components/action-form";
import { Message } from "#components/message";

import { deleteReaderAction } from "../_lib/actions";

interface DeleteReaderButtonProps {
  /** The name the confirmation calls the reader by. */
  name: string;
  publicId: string;
  tenantId: string;
}

/**
 * Deletes the reader's account once staff confirm it. Success leaves for the
 * readers list, which raises the toast.
 */
export const DeleteReaderButton = ({
  name,
  publicId,
  tenantId,
}: DeleteReaderButtonProps) => {
  const formId = `delete-reader-${publicId}`;

  return (
    <ActionForm action={deleteReaderAction} className="grid gap-1" id={formId}>
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="public_id" type="hidden" value={publicId} />
      <ConfirmDialog>
        <ConfirmDialogTrigger
          render={<Button type="button" variant="destructive" />}
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
            <ActionFormIdle>
              <Message message="admin.readers.delete" />
            </ActionFormIdle>
            <ActionFormPending>
              <Message message="admin.readers.deleting" />
            </ActionFormPending>
          </Suspense>
        </ConfirmDialogTrigger>
        <ConfirmDialogContent>
          <ConfirmDialogHeader>
            <ConfirmDialogTitle>
              <Suspense fallback={<SkeletonLine className="h-5 w-48" />}>
                <Message
                  message="admin.readers.delete_confirm_title"
                  values={{ name }}
                />
              </Suspense>
            </ConfirmDialogTitle>
            <ConfirmDialogDescription>
              <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                <Message message="admin.readers.delete_confirm_description" />
              </Suspense>
            </ConfirmDialogDescription>
          </ConfirmDialogHeader>
          <ConfirmDialogFooter>
            <ConfirmDialogCancel>
              <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                <Message message="admin.common.cancel" />
              </Suspense>
            </ConfirmDialogCancel>
            <ConfirmDialogAction form={formId}>
              <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                <Message message="admin.readers.delete_confirm_action" />
              </Suspense>
            </ConfirmDialogAction>
          </ConfirmDialogFooter>
        </ConfirmDialogContent>
      </ConfirmDialog>
    </ActionForm>
  );
};
