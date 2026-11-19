import * as ActionForm from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import * as ConfirmDialog from "@publira/ui-components/confirm-dialog";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";

import { deleteFcmCredentialsAction } from "../_lib/actions";

const FORM_ID = "delete-fcm-credentials";

/** Removes the stored credentials once the administrator confirms it. */
export const FcmCredentialsDeleteButton = ({
  tenantId,
}: {
  tenantId: string;
}) => (
  <ActionForm.Root
    action={deleteFcmCredentialsAction}
    className="grid gap-1"
    id={FORM_ID}
  >
    <input name="tenant_id" type="hidden" value={tenantId} />
    <ConfirmDialog.Root>
      <ConfirmDialog.Trigger
        render={<Button type="button" variant="destructive" />}
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
          <ActionForm.Idle>
            <Message message="admin.settings.mobile_push.delete" />
          </ActionForm.Idle>
          <ActionForm.Pending>
            <Message message="admin.settings.mobile_push.deleting" />
          </ActionForm.Pending>
        </Suspense>
      </ConfirmDialog.Trigger>
      <ConfirmDialog.Content>
        <ConfirmDialog.Header>
          <ConfirmDialog.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-48" />}>
              <Message message="admin.settings.mobile_push.delete_confirm_title" />
            </Suspense>
          </ConfirmDialog.Title>
          <ConfirmDialog.Description>
            <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
              <Message message="admin.settings.mobile_push.delete_confirm_description" />
            </Suspense>
          </ConfirmDialog.Description>
        </ConfirmDialog.Header>
        <ConfirmDialog.Footer>
          <ConfirmDialog.Cancel>
            <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
              <Message message="admin.common.cancel" />
            </Suspense>
          </ConfirmDialog.Cancel>
          <ConfirmDialog.Action form={FORM_ID}>
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="admin.settings.mobile_push.delete_confirm_action" />
            </Suspense>
          </ConfirmDialog.Action>
        </ConfirmDialog.Footer>
      </ConfirmDialog.Content>
    </ConfirmDialog.Root>
  </ActionForm.Root>
);
