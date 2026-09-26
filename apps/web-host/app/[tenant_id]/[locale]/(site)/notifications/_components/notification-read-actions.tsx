import {
  ActionForm,
  ActionFormIdle,
  ActionFormPending,
  ActionFormSubmit,
} from "@publira/ui-components/action-form";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { LocaleField } from "#components/locale-field";
import { Message } from "#components/message";

import {
  markAllNotificationsAsReadAction,
  markNotificationAsReadAction,
} from "../_lib/actions";

/**
 * `aria-label` names the notification, so each row's control is told apart.
 */
export const MarkNotificationAsReadButton = ({
  "aria-label": ariaLabel,
  notificationId,
  tenantId,
}: {
  "aria-label": string;
  notificationId: string;
  tenantId: string;
}) => (
  <ActionForm
    action={markNotificationAsReadAction}
    className="grid justify-items-start gap-1"
    showSuccess={false}
  >
    <LocaleField />
    <input name="tenantId" type="hidden" value={tenantId} />
    <input name="notificationId" type="hidden" value={notificationId} />
    <ActionFormSubmit aria-label={ariaLabel} size="sm" variant="outline">
      <ActionFormIdle>
        <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
          <Message message="host.common.mark_read" />
        </Suspense>
      </ActionFormIdle>
      <ActionFormPending>
        <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
          <Message message="host.common.updating" />
        </Suspense>
      </ActionFormPending>
    </ActionFormSubmit>
  </ActionForm>
);

export const MarkAllNotificationsAsReadButton = ({
  tenantId,
}: {
  tenantId: string;
}) => (
  <ActionForm
    action={markAllNotificationsAsReadAction}
    className="grid justify-items-end gap-1"
    showSuccess={false}
  >
    <LocaleField />
    <input name="tenantId" type="hidden" value={tenantId} />
    <ActionFormSubmit size="sm" variant="outline">
      <ActionFormIdle>
        <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
          <Message message="host.common.mark_all_read" />
        </Suspense>
      </ActionFormIdle>
      <ActionFormPending>
        <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
          <Message message="host.common.updating" />
        </Suspense>
      </ActionFormPending>
    </ActionFormSubmit>
  </ActionForm>
);
