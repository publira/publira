import * as ActionForm from "@publira/ui-components/action-form";
import type { ReactNode } from "react";

import {
  markAllNotificationsAsReadAction,
  markNotificationAsReadAction,
} from "../_lib/actions";

/** `aria-label` names the notification it marks, since every row has one. */
export const MarkNotificationAsReadButton = ({
  "aria-label": ariaLabel,
  children,
  notificationId,
}: {
  "aria-label": string;
  children: ReactNode;
  notificationId: string;
}) => (
  <ActionForm.Root
    action={markNotificationAsReadAction}
    className="grid justify-items-end gap-1"
    showSuccess={false}
  >
    <input name="notification_id" type="hidden" value={notificationId} />
    <ActionForm.Submit aria-label={ariaLabel} size="sm" variant="outline">
      {children}
    </ActionForm.Submit>
  </ActionForm.Root>
);

export const MarkAllNotificationsAsReadButton = ({
  children,
}: {
  children: ReactNode;
}) => (
  <ActionForm.Root
    action={markAllNotificationsAsReadAction}
    className="grid justify-items-end gap-1"
    showSuccess={false}
  >
    <ActionForm.Submit size="sm" variant="outline">
      {children}
    </ActionForm.Submit>
  </ActionForm.Root>
);
