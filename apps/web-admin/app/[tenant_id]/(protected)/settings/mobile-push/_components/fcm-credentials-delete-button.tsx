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

import { deleteFcmCredentialsAction } from "../_lib/actions";

const FORM_ID = "delete-fcm-credentials";

/** Removes the stored credentials once the administrator confirms it. */
export const FcmCredentialsDeleteButton = ({
  tenantId,
}: {
  tenantId: string;
}) => (
  <ActionForm
    action={deleteFcmCredentialsAction}
    className="grid gap-1"
    id={FORM_ID}
  >
    <input name="tenant_id" type="hidden" value={tenantId} />
    <ConfirmDialog>
      <ConfirmDialogTrigger
        render={<Button type="button" variant="destructive" />}
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
          <ActionFormIdle>
            <Message message="admin.settings.mobile_push.delete" />
          </ActionFormIdle>
          <ActionFormPending>
            <Message message="admin.settings.mobile_push.deleting" />
          </ActionFormPending>
        </Suspense>
      </ConfirmDialogTrigger>
      <ConfirmDialogContent>
        <ConfirmDialogHeader>
          <ConfirmDialogTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-48" />}>
              <Message message="admin.settings.mobile_push.delete_confirm_title" />
            </Suspense>
          </ConfirmDialogTitle>
          <ConfirmDialogDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
              <Message message="admin.settings.mobile_push.delete_confirm_description" />
            </Suspense>
          </ConfirmDialogDescription>
        </ConfirmDialogHeader>
        <ConfirmDialogFooter>
          <ConfirmDialogCancel>
            <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
              <Message message="admin.common.cancel" />
            </Suspense>
          </ConfirmDialogCancel>
          <ConfirmDialogAction form={FORM_ID}>
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="admin.settings.mobile_push.delete_confirm_action" />
            </Suspense>
          </ConfirmDialogAction>
        </ConfirmDialogFooter>
      </ConfirmDialogContent>
    </ConfirmDialog>
  </ActionForm>
);
