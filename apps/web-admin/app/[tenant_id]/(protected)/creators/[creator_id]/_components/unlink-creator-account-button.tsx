import {
  ActionForm,
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

import { unlinkCreatorAccountAction } from "../../_lib/actions";
import { CreatorAccountSettledToast } from "./creator-account-settled-toast";

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
    <ActionForm
      action={unlinkCreatorAccountAction}
      className="grid gap-1"
      id={formId}
      showSuccess={false}
    >
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="creator_id" type="hidden" value={creatorId} />
      <input name="creator_public_id" type="hidden" value={creatorPublicId} />
      <input name="reader_id" type="hidden" value={readerId} />
      <CreatorAccountSettledToast />
      <ConfirmDialog>
        <ConfirmDialogTrigger
          render={<Button size="sm" type="button" variant="outline" />}
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
            <ActionFormIdle>
              <Message message="admin.creators.accounts.unlink" />
            </ActionFormIdle>
            <ActionFormPending>
              <Message message="admin.creators.accounts.unlinking" />
            </ActionFormPending>
          </Suspense>
        </ConfirmDialogTrigger>
        <ConfirmDialogContent>
          <ConfirmDialogHeader>
            <ConfirmDialogTitle>
              <Suspense fallback={<SkeletonLine className="h-5 w-48" />}>
                <Message
                  message="admin.creators.accounts.unlink_confirm_title"
                  values={{ name }}
                />
              </Suspense>
            </ConfirmDialogTitle>
            <ConfirmDialogDescription>
              <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                <Message message="admin.creators.accounts.unlink_confirm_description" />
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
                <Message message="admin.creators.accounts.unlink_confirm_action" />
              </Suspense>
            </ConfirmDialogAction>
          </ConfirmDialogFooter>
        </ConfirmDialogContent>
      </ConfirmDialog>
    </ActionForm>
  );
};
