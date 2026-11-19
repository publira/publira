import * as ActionForm from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import * as ConfirmDialog from "@publira/ui-components/confirm-dialog";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";

import { deleteCreatorRoleAction } from "../_lib/actions";

interface CreatorRoleDeleteButtonProps {
  id: string;
  name: string;
  tenantId: string;
}

/**
 * Removes one role, once the editor has confirmed it.
 *
 * A refusal is the interesting outcome rather than the exception: a role that
 * a series or an episode is still credited in cannot be deleted, and the
 * message saying so is what sends the editor to re-credit them. Success needs
 * no message — the row it was attached to is gone.
 */
export const CreatorRoleDeleteButton = ({
  id,
  name,
  tenantId,
}: CreatorRoleDeleteButtonProps) => {
  const formId = `delete-creator-role-${id}`;

  return (
    <ActionForm.Root
      action={deleteCreatorRoleAction}
      className="grid gap-1"
      id={formId}
      showSuccess={false}
    >
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="creator_role_id" type="hidden" value={id} />
      <ActionForm.Fieldset className="grid">
        <ConfirmDialog.Root>
          <ConfirmDialog.Trigger
            render={<Button size="sm" type="button" variant="destructive" />}
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
              <ActionForm.Idle>
                <Message message="admin.creator_roles.delete_action" />
              </ActionForm.Idle>
              <ActionForm.Pending>
                <Message message="admin.creator_roles.deleting" />
              </ActionForm.Pending>
            </Suspense>
          </ConfirmDialog.Trigger>
          <ConfirmDialog.Content>
            <ConfirmDialog.Header>
              <ConfirmDialog.Title>
                <Suspense fallback={<SkeletonLine className="h-5 w-48" />}>
                  <Message message="admin.creator_roles.delete_confirm_title" />
                </Suspense>
              </ConfirmDialog.Title>
              <ConfirmDialog.Description>
                <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                  <Message
                    message="admin.creator_roles.delete_confirm_description"
                    values={{ name }}
                  />
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
                  <Message message="admin.creator_roles.delete_confirm_action" />
                </Suspense>
              </ConfirmDialog.Action>
            </ConfirmDialog.Footer>
          </ConfirmDialog.Content>
        </ConfirmDialog.Root>
      </ActionForm.Fieldset>
    </ActionForm.Root>
  );
};
