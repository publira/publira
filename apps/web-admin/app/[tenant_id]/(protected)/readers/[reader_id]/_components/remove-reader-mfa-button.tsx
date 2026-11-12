import * as ActionForm from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import * as ConfirmDialog from "@publira/ui-components/confirm-dialog";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";

import { resetReaderMfaAction } from "../_lib/actions";

interface RemoveReaderMfaButtonProps {
  /** The name the confirmation calls the reader by. */
  name: string;
  publicId: string;
  readerId: string;
  tenantId: string;
}

/**
 * Removes the reader's two-step verification once staff confirm it, for a
 * reader who has lost their authenticator and every recovery code. The
 * confirmation is where staff are told to make sure who is asking, since
 * whoever signs in next needs the password alone. Success comes back to the
 * reader's page, whose flash flag raises the toast.
 */
export const RemoveReaderMfaButton = ({
  name,
  publicId,
  readerId,
  tenantId,
}: RemoveReaderMfaButtonProps) => {
  const formId = `remove-reader-mfa-${publicId}`;

  return (
    <ActionForm.Root
      action={resetReaderMfaAction}
      className="grid gap-1"
      id={formId}
    >
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="public_id" type="hidden" value={publicId} />
      <input name="reader_id" type="hidden" value={readerId} />
      <ConfirmDialog.Root>
        <ConfirmDialog.Trigger
          render={<Button type="button" variant="outline" />}
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
            <ActionForm.Idle>
              <Message message="admin.readers.mfa_remove" />
            </ActionForm.Idle>
            <ActionForm.Pending>
              <Message message="admin.readers.mfa_removing" />
            </ActionForm.Pending>
          </Suspense>
        </ConfirmDialog.Trigger>
        <ConfirmDialog.Content>
          <ConfirmDialog.Header>
            <ConfirmDialog.Title>
              <Suspense fallback={<SkeletonLine className="h-5 w-48" />}>
                <Message
                  message="admin.readers.mfa_remove_confirm_title"
                  values={{ name }}
                />
              </Suspense>
            </ConfirmDialog.Title>
            <ConfirmDialog.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                <Message message="admin.readers.mfa_remove_confirm_description" />
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
                <Message message="admin.readers.mfa_remove_confirm_action" />
              </Suspense>
            </ConfirmDialog.Action>
          </ConfirmDialog.Footer>
        </ConfirmDialog.Content>
      </ConfirmDialog.Root>
    </ActionForm.Root>
  );
};
