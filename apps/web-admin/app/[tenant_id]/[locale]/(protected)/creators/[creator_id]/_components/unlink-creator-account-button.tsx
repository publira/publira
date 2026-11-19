import * as ActionForm from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import * as ConfirmDialog from "@publira/ui-components/confirm-dialog";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import { SettledToast } from "#components/settled-toast";

import { unlinkCreatorAccountAction } from "../../_lib/actions";

interface UnlinkCreatorAccountButtonProps {
  creatorId: string;
  creatorPublicId: string;
  /** The name the confirmation calls the reader by. */
  name: string;
  readerId: string;
  readerPublicId: string;
  tenantId: string;
}

/** Removes one link once staff confirm it. */
export const UnlinkCreatorAccountButton = ({
  creatorId,
  creatorPublicId,
  name,
  readerId,
  readerPublicId,
  tenantId,
}: UnlinkCreatorAccountButtonProps) => {
  const formId = `unlink-creator-account-${readerPublicId}`;

  return (
    <ActionForm.Root
      action={unlinkCreatorAccountAction}
      className="grid gap-1"
      id={formId}
      showSuccess={false}
    >
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="creator_id" type="hidden" value={creatorId} />
      <input name="creator_public_id" type="hidden" value={creatorPublicId} />
      <input name="reader_id" type="hidden" value={readerId} />
      <SettledToast />
      <ConfirmDialog.Root>
        <ConfirmDialog.Trigger
          render={<Button size="sm" type="button" variant="outline" />}
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
            <ActionForm.Idle>
              <Message message="admin.creators.accounts.unlink" />
            </ActionForm.Idle>
            <ActionForm.Pending>
              <Message message="admin.creators.accounts.unlinking" />
            </ActionForm.Pending>
          </Suspense>
        </ConfirmDialog.Trigger>
        <ConfirmDialog.Content>
          <ConfirmDialog.Header>
            <ConfirmDialog.Title>
              <Suspense fallback={<SkeletonLine className="h-5 w-48" />}>
                <Message
                  message="admin.creators.accounts.unlink_confirm_title"
                  values={{ name }}
                />
              </Suspense>
            </ConfirmDialog.Title>
            <ConfirmDialog.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                <Message message="admin.creators.accounts.unlink_confirm_description" />
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
                <Message message="admin.creators.accounts.unlink_confirm_action" />
              </Suspense>
            </ConfirmDialog.Action>
          </ConfirmDialog.Footer>
        </ConfirmDialog.Content>
      </ConfirmDialog.Root>
    </ActionForm.Root>
  );
};
