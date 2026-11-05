import * as ActionForm from "@publira/ui-components/action-form";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";

import { resendWebhookDeliveryAction } from "../_lib/actions";

/** Owes a dead delivery again, with the same body and a new budget of attempts. */
export const WebhookDeliveryResendButton = ({
  "aria-label": ariaLabel,
  deliveryId,
  tenantId,
}: {
  /** Names the delivery, since every dead row has one of these. */
  "aria-label": string;
  deliveryId: string;
  tenantId: string;
}) => (
  <ActionForm.Root
    action={resendWebhookDeliveryAction}
    className="grid justify-items-end gap-1"
  >
    <input name="tenant_id" type="hidden" value={tenantId} />
    <input name="delivery_id" type="hidden" value={deliveryId} />
    <ActionForm.Submit aria-label={ariaLabel} size="sm" variant="outline">
      <Suspense fallback={<SkeletonLine className="h-4 w-14" />}>
        <ActionForm.Idle>
          <Message message="admin.settings.webhooks.deliveries.resend" />
        </ActionForm.Idle>
        <ActionForm.Pending>
          <Message message="admin.settings.webhooks.deliveries.resending" />
        </ActionForm.Pending>
      </Suspense>
    </ActionForm.Submit>
  </ActionForm.Root>
);
