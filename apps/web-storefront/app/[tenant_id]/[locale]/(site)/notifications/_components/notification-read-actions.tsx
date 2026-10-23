import * as ActionForm from "@publira/ui-components/action-form";
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
  <ActionForm.Root
    action={markNotificationAsReadAction}
    className="grid justify-items-start gap-1"
    showSuccess={false}
  >
    <LocaleField />
    <input name="tenantId" type="hidden" value={tenantId} />
    <input name="notificationId" type="hidden" value={notificationId} />
    <ActionForm.Submit aria-label={ariaLabel} size="sm" variant="outline">
      <ActionForm.Idle>
        <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
          <Message message="storefront.common.mark_read" />
        </Suspense>
      </ActionForm.Idle>
      <ActionForm.Pending>
        <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
          <Message message="storefront.common.updating" />
        </Suspense>
      </ActionForm.Pending>
    </ActionForm.Submit>
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
    <LocaleField />
    <input name="tenantId" type="hidden" value={tenantId} />
    <ActionForm.Submit size="sm" variant="outline">
      <ActionForm.Idle>
        <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
          <Message message="storefront.common.mark_all_read" />
        </Suspense>
      </ActionForm.Idle>
      <ActionForm.Pending>
        <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
          <Message message="storefront.common.updating" />
        </Suspense>
      </ActionForm.Pending>
    </ActionForm.Submit>
  </ActionForm.Root>
);
