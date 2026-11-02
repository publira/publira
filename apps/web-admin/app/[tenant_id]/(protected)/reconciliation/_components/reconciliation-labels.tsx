import type { BadgeTone } from "@publira/ui-components/badge";
import { StatusChip } from "@publira/ui-components/badge";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import type { AdminMessageAccessor } from "#lib/messages";
import type {
  PaymentReconciliationFindingKindValue,
  PaymentReconciliationItem,
  PaymentReconciliationStatusValue,
} from "#lib/payment-reconciliation";

/**
 * The source a run read: the provider's name as the server declares it, or
 * the store. `providerNames` maps a provider's id to its name; an id missing
 * from it is shown as it is.
 */
export const ReconciliationSource = ({
  providerNames,
  run,
}: {
  providerNames: ReadonlyMap<string, string>;
  run: Pick<PaymentReconciliationItem, "provider" | "store">;
}) => {
  if (run.provider) {
    return providerNames.get(run.provider) ?? run.provider;
  }

  switch (run.store) {
    case "app_store": {
      return (
        <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
          <Message message="admin.reconciliation.source.app_store" />
        </Suspense>
      );
    }

    case "google_play": {
      return (
        <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
          <Message message="admin.reconciliation.source.google_play" />
        </Suspense>
      );
    }

    default: {
      return run.store;
    }
  }
};

/**
 * {@link ReconciliationSource} as a string, for an accessible name that has to
 * tell apart the runs of one period.
 */
export const reconciliationSourceName = (
  run: Pick<PaymentReconciliationItem, "provider" | "store">,
  providerNames: ReadonlyMap<string, string>,
  t: AdminMessageAccessor
): string => {
  if (run.provider) {
    return providerNames.get(run.provider) ?? run.provider;
  }

  switch (run.store) {
    case "app_store": {
      return t("admin.reconciliation.source.app_store");
    }

    case "google_play": {
      return t("admin.reconciliation.source.google_play");
    }

    default: {
      return run.store;
    }
  }
};

const statusTone: Record<PaymentReconciliationStatusValue, BadgeTone> = {
  failed: "destructive",
  pending: "muted",
  running: "info",
  succeeded: "success",
};

/**
 * The status, worded one branch at a time so each key stays where anything
 * reading this file for the screen's strings can see it.
 */
const StatusLabel = ({
  status,
}: {
  status: PaymentReconciliationStatusValue;
}) => {
  switch (status) {
    case "failed": {
      return <Message message="admin.reconciliation.status.failed" />;
    }

    case "pending": {
      return <Message message="admin.reconciliation.status.pending" />;
    }

    case "running": {
      return <Message message="admin.reconciliation.status.running" />;
    }

    case "succeeded": {
      return <Message message="admin.reconciliation.status.succeeded" />;
    }

    default: {
      return null;
    }
  }
};

export const ReconciliationStatusChip = ({
  status,
}: {
  status: PaymentReconciliationStatusValue;
}) => (
  <StatusChip status={statusTone[status]}>
    <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
      <StatusLabel status={status} />
    </Suspense>
  </StatusChip>
);

/** Why a run failed, which says what to do about it. */
export const ReconciliationFailure = ({
  run,
}: {
  run: Pick<PaymentReconciliationItem, "failure">;
}) => {
  switch (run.failure) {
    case "credentials": {
      return <Message message="admin.reconciliation.failure.credentials" />;
    }

    case "unavailable": {
      return <Message message="admin.reconciliation.failure.unavailable" />;
    }

    default: {
      return null;
    }
  }
};

/** What a line of a run is. */
export const FindingKindLabel = ({
  kind,
}: {
  kind: PaymentReconciliationFindingKindValue;
}) => {
  switch (kind) {
    case "amount_mismatch": {
      return <Message message="admin.reconciliation.kind.amount_mismatch" />;
    }

    case "held_dispute": {
      return <Message message="admin.reconciliation.kind.held_dispute" />;
    }

    case "held_refund": {
      return <Message message="admin.reconciliation.kind.held_refund" />;
    }

    case "purchase_unmatched": {
      return <Message message="admin.reconciliation.kind.purchase_unmatched" />;
    }

    case "record_unmatched": {
      return <Message message="admin.reconciliation.kind.record_unmatched" />;
    }

    default: {
      return <Message message="admin.reconciliation.kind.other" />;
    }
  }
};
