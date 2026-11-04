import type { BadgeTone } from "@publira/ui-components/badge";
import { StatusChip } from "@publira/ui-components/badge";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import type { WebhookDeliveryStatusValue } from "#lib/webhooks";

const statusTone: Record<WebhookDeliveryStatusValue, BadgeTone> = {
  dead: "destructive",
  delivered: "success",
  failed: "warning",
  pending: "info",
};

/**
 * The status, worded one branch at a time so each key stays where anything
 * reading this file for the screen's strings can see it.
 */
const WebhookDeliveryStatusLabel = ({
  status,
}: {
  status: WebhookDeliveryStatusValue;
}) => {
  switch (status) {
    case "dead": {
      return (
        <Message message="admin.settings.webhooks.deliveries.status.dead" />
      );
    }

    case "delivered": {
      return (
        <Message message="admin.settings.webhooks.deliveries.status.delivered" />
      );
    }

    case "failed": {
      return (
        <Message message="admin.settings.webhooks.deliveries.status.failed" />
      );
    }

    case "pending": {
      return (
        <Message message="admin.settings.webhooks.deliveries.status.pending" />
      );
    }

    default: {
      return null;
    }
  }
};

export const WebhookDeliveryStatusChip = ({
  status,
}: {
  status: WebhookDeliveryStatusValue;
}) => (
  <StatusChip className="whitespace-nowrap" status={statusTone[status]}>
    <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
      <WebhookDeliveryStatusLabel status={status} />
    </Suspense>
  </StatusChip>
);
