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
import { SettledToast } from "#components/settled-toast";

import { removeTenantMemberAction } from "../_lib/actions";

interface MemberRemoveButtonProps {
  name: string;
  tenantId: string;
  userId: string;
}

/**
 * Takes every console role away from one member, once the admin has
 * confirmed it. The row goes away with the member, so success is a toast; a
 * refusal stays next to the row: removing the tenant's last admin is the case
 * the API turns down, and the row is still there to say so.
 */
export const MemberRemoveButton = ({
  name,
  tenantId,
  userId,
}: MemberRemoveButtonProps) => {
  const formId = `remove-member-${userId}`;

  return (
    <ActionForm
      action={removeTenantMemberAction}
      className="grid gap-1"
      id={formId}
      showSuccess={false}
    >
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="user_id" type="hidden" value={userId} />
      <SettledToast />
      <ActionFormFieldset className="grid">
        <ConfirmDialog>
          <ConfirmDialogTrigger
            render={<Button size="sm" type="button" variant="destructive" />}
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
              <ActionFormIdle>
                <Message message="admin.members.remove_action" />
              </ActionFormIdle>
              <ActionFormPending>
                <Message message="admin.members.removing" />
              </ActionFormPending>
            </Suspense>
          </ConfirmDialogTrigger>
          <ConfirmDialogContent>
            <ConfirmDialogHeader>
              <ConfirmDialogTitle>
                <Suspense fallback={<SkeletonLine className="h-5 w-48" />}>
                  <Message message="admin.members.remove_confirm_title" />
                </Suspense>
              </ConfirmDialogTitle>
              <ConfirmDialogDescription>
                <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                  <Message
                    message="admin.members.remove_confirm_description"
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
                  <Message message="admin.members.remove_confirm_action" />
                </Suspense>
              </ConfirmDialogAction>
            </ConfirmDialogFooter>
          </ConfirmDialogContent>
        </ConfirmDialog>
      </ActionFormFieldset>
    </ActionForm>
  );
};
