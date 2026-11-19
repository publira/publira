import * as ActionForm from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import * as ConfirmDialog from "@publira/ui-components/confirm-dialog";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";

import { deleteAnnouncementAction } from "../_lib/actions";
import type { AnnouncementItem } from "../announcement-types";

/**
 * Deletes a scheduled announcement once the operator has confirmed it.
 * Success leaves for the list it is gone from.
 */
export const AnnouncementDeleteButton = ({
  announcement,
  tenantId,
}: {
  announcement: Pick<AnnouncementItem, "id">;
  tenantId: string;
}) => {
  const formId = `delete-announcement-${announcement.id}`;

  return (
    <ActionForm.Root
      action={deleteAnnouncementAction}
      className="grid gap-1"
      id={formId}
      showSuccess={false}
    >
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="announcement_id" type="hidden" value={announcement.id} />
      <ActionForm.Fieldset className="grid justify-start">
        <ConfirmDialog.Root>
          <ConfirmDialog.Trigger
            render={<Button type="button" variant="destructive" />}
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
              <ActionForm.Idle>
                <Message message="admin.announcements.delete_action" />
              </ActionForm.Idle>
              <ActionForm.Pending>
                <Message message="admin.announcements.deleting" />
              </ActionForm.Pending>
            </Suspense>
          </ConfirmDialog.Trigger>
          <ConfirmDialog.Content>
            <ConfirmDialog.Header>
              <ConfirmDialog.Title>
                <Suspense fallback={<SkeletonLine className="h-5 w-56" />}>
                  <Message message="admin.announcements.delete_confirm" />
                </Suspense>
              </ConfirmDialog.Title>
              <ConfirmDialog.Description>
                <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                  <Message message="admin.announcements.delete_confirm_description" />
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
                  <Message message="admin.announcements.delete_confirm_action" />
                </Suspense>
              </ConfirmDialog.Action>
            </ConfirmDialog.Footer>
          </ConfirmDialog.Content>
        </ConfirmDialog.Root>
      </ActionForm.Fieldset>
    </ActionForm.Root>
  );
};
