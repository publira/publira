import {
  ActionForm,
  ActionFormFieldset,
  ActionFormIdle,
  ActionFormPending,
} from "@publira/ui-components/action-form";
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
    <ActionForm
      action={deleteCreatorRoleAction}
      className="grid gap-1"
      id={formId}
      showSuccess={false}
    >
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="creator_role_id" type="hidden" value={id} />
      <ActionFormFieldset className="grid">
        <ConfirmDialog>
          <ConfirmDialogTrigger
            render={<Button size="sm" type="button" variant="destructive" />}
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
              <ActionFormIdle>
                <Message message="admin.creator_roles.delete_action" />
              </ActionFormIdle>
              <ActionFormPending>
                <Message message="admin.creator_roles.deleting" />
              </ActionFormPending>
            </Suspense>
          </ConfirmDialogTrigger>
          <ConfirmDialogContent>
            <ConfirmDialogHeader>
              <ConfirmDialogTitle>
                <Suspense fallback={<SkeletonLine className="h-5 w-48" />}>
                  <Message message="admin.creator_roles.delete_confirm_title" />
                </Suspense>
              </ConfirmDialogTitle>
              <ConfirmDialogDescription>
                <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                  <Message
                    message="admin.creator_roles.delete_confirm_description"
                    values={{ name }}
                  />
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
                  <Message message="admin.creator_roles.delete_confirm_action" />
                </Suspense>
              </ConfirmDialogAction>
            </ConfirmDialogFooter>
          </ConfirmDialogContent>
        </ConfirmDialog>
      </ActionFormFieldset>
    </ActionForm>
  );
};
