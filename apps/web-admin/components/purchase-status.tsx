import type { BadgeTone } from "@publira/ui-components/badge";
import { StatusChip } from "@publira/ui-components/badge";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import type { PurchaseItem } from "#lib/purchase";

/**
 * Where a purchase stands at `now`, from what the API reports of it. A staff
 * refund revokes the purchase at once and is recorded refunded only when the
 * provider's notification of it arrives, so the two are told apart. A reading
 * period that ran out is reported after the money, which is what a refund
 * decision turns on.
 */
export type PurchaseStatus =
  | "active"
  | "disputed"
  | "expired"
  | "partly_refunded"
  | "refunded"
  | "refunding";

export const purchaseStatus = (
  purchase: Pick<
    PurchaseItem,
    "expiresAt" | "refundedAmount" | "refundedAt" | "revocationReason"
  >,
  now: Temporal.Instant
): PurchaseStatus => {
  if (purchase.revocationReason === "dispute") {
    return "disputed";
  }
  if (purchase.refundedAt || purchase.revocationReason === "refund") {
    return "refunded";
  }
  if (purchase.revocationReason === "staff") {
    return "refunding";
  }
  if (purchase.refundedAmount > 0) {
    return "partly_refunded";
  }
  if (
    purchase.expiresAt &&
    Temporal.Instant.compare(Temporal.Instant.from(purchase.expiresAt), now) <=
      0
  ) {
    return "expired";
  }
  return "active";
};

const statusTone: Record<PurchaseStatus, BadgeTone> = {
  active: "success",
  disputed: "destructive",
  expired: "muted",
  partly_refunded: "warning",
  refunded: "muted",
  refunding: "info",
};

/**
 * The status, worded one branch at a time so each key stays where anything
 * reading this file for the screen's strings can see it.
 */
const PurchaseStatusLabel = ({ status }: { status: PurchaseStatus }) => {
  switch (status) {
    case "active": {
      return <Message message="admin.purchases.status.active" />;
    }
    case "disputed": {
      return <Message message="admin.purchases.status.disputed" />;
    }
    case "expired": {
      return <Message message="admin.purchases.status.expired" />;
    }
    case "partly_refunded": {
      return <Message message="admin.purchases.status.partly_refunded" />;
    }
    case "refunded": {
      return <Message message="admin.purchases.status.refunded" />;
    }
    case "refunding": {
      return <Message message="admin.purchases.status.refunding" />;
    }
    default: {
      return null;
    }
  }
};

export const PurchaseStatusChip = ({
  now,
  purchase,
}: {
  now: Temporal.Instant;
  purchase: Pick<
    PurchaseItem,
    "expiresAt" | "refundedAmount" | "refundedAt" | "revocationReason" | "test"
  >;
}) => {
  const status = purchaseStatus(purchase, now);

  return (
    <span className="flex flex-wrap items-center gap-1">
      <StatusChip status={statusTone[status]}>
        <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
          <PurchaseStatusLabel status={status} />
        </Suspense>
      </StatusChip>
      {purchase.test ? (
        <StatusChip status="muted">
          <Suspense fallback={<SkeletonLine className="h-4 w-10" />}>
            <Message message="admin.purchases.test_payment" />
          </Suspense>
        </StatusChip>
      ) : null}
    </span>
  );
};

/**
 * Where the reader paid: the provider's name as the server declares it, the
 * store, or that no payment was made. `providerNames` maps a provider's id to
 * its name; an id missing from it is shown as it is.
 */
export const PurchasePaidThrough = ({
  providerNames,
  purchase,
}: {
  providerNames: ReadonlyMap<string, string>;
  purchase: Pick<PurchaseItem, "provider" | "store">;
}) => {
  if (purchase.provider) {
    return providerNames.get(purchase.provider) ?? purchase.provider;
  }
  switch (purchase.store) {
    case "": {
      return (
        <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
          <Message message="admin.purchases.paid_through.none" />
        </Suspense>
      );
    }
    case "app_store": {
      return (
        <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
          <Message message="admin.purchases.paid_through.app_store" />
        </Suspense>
      );
    }
    case "google_play": {
      return (
        <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
          <Message message="admin.purchases.paid_through.google_play" />
        </Suspense>
      );
    }
    default: {
      return purchase.store;
    }
  }
};
