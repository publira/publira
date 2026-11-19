import * as ActionForm from "@publira/ui-components/action-form";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import { getMessages } from "#lib/get-messages";

import {
  markAllNotificationsAsReadAction,
  markNotificationAsReadAction,
} from "../_lib/actions";

/**
 * The submit control of one row, named after the notification it marks. An
 * `aria-label` cannot be a node, so this one control resolves the catalog.
 */
const MarkNotificationAsReadSubmit = async ({ label }: { label: string }) => {
  const t = await getMessages();

  return (
    <ActionForm.Submit
      aria-label={t("admin.notifications.mark_read_aria", { label })}
      size="sm"
      variant="outline"
    >
      <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
        <ActionForm.Idle>
          <Message message="admin.notifications.mark_read" />
        </ActionForm.Idle>
        <ActionForm.Pending>
          <Message message="admin.notifications.updating" />
        </ActionForm.Pending>
      </Suspense>
    </ActionForm.Submit>
  );
};

export const MarkNotificationAsReadButton = ({
  label,
  notificationId,
  tenantId,
}: {
  label: string;
  notificationId: string;
  tenantId: string;
}) => (
  <ActionForm.Root
    action={markNotificationAsReadAction}
    className="grid justify-items-end gap-1"
    showSuccess={false}
  >
    <input name="tenant_id" type="hidden" value={tenantId} />
    <input name="notification_id" type="hidden" value={notificationId} />
    <Suspense fallback={<Skeleton className="h-8 w-24" />}>
      <MarkNotificationAsReadSubmit label={label} />
    </Suspense>
  </ActionForm.Root>
);

export const MarkAllNotificationsAsReadButton = ({
  tenantId,
}: {
  tenantId: string;
}) => (
  <ActionForm.Root
    action={markAllNotificationsAsReadAction}
    className="grid justify-items-end gap-1"
    showSuccess={false}
  >
    <input name="tenant_id" type="hidden" value={tenantId} />
    <ActionForm.Submit size="sm" variant="outline">
      <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
        <ActionForm.Idle>
          <Message message="admin.notifications.mark_all_read" />
        </ActionForm.Idle>
        <ActionForm.Pending>
          <Message message="admin.notifications.updating" />
        </ActionForm.Pending>
      </Suspense>
    </ActionForm.Submit>
  </ActionForm.Root>
);
