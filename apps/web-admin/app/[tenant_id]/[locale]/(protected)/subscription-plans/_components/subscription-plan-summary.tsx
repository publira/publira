import { StatusChip } from "@publira/ui-components/badge";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import type { SubscriptionPlanItem } from "#lib/subscription-plan-shared";

/** What the plan opens: the whole catalog, or how many labels or series. */
export const SubscriptionPlanScopeSummary = ({
  plan,
}: {
  plan: Pick<SubscriptionPlanItem, "labelIds" | "scope" | "seriesIds">;
}) => (
  <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
    {plan.scope === "label" ? (
      <Message
        message="admin.subscription_plans.scope.label_count"
        values={{ count: plan.labelIds.length }}
      />
    ) : null}
    {plan.scope === "series" ? (
      <Message
        message="admin.subscription_plans.scope.series_count"
        values={{ count: plan.seriesIds.length }}
      />
    ) : null}
    {plan.scope === "all" ? (
      <Message message="admin.subscription_plans.scope.all" />
    ) : null}
  </Suspense>
);

/** Whether the site lists the plan and takes new subscriptions to it. */
export const SubscriptionPlanStatusChip = ({
  published,
}: {
  published: boolean;
}) => (
  <StatusChip status={published ? "success" : "muted"}>
    <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
      {published ? (
        <Message message="admin.subscription_plans.status.published" />
      ) : (
        <Message message="admin.subscription_plans.status.unpublished" />
      )}
    </Suspense>
  </StatusChip>
);

/**
 * The stores whose app sells the plan, one per line: those the plan names a
 * product of. The app sells it there only while it takes payments through the
 * stores, which this does not read.
 */
export const SubscriptionPlanStores = ({
  plan,
}: {
  plan: Pick<SubscriptionPlanItem, "appStoreProductId" | "googlePlayProductId">;
}) => {
  if (!(plan.appStoreProductId || plan.googlePlayProductId)) {
    return (
      <span className="text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
          <Message message="admin.subscription_plans.stores.none" />
        </Suspense>
      </span>
    );
  }

  return (
    <ul className="grid gap-0.5">
      {plan.appStoreProductId ? (
        <li>
          <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
            <Message message="admin.subscription_plans.stores.app_store" />
          </Suspense>
        </li>
      ) : null}
      {plan.googlePlayProductId ? (
        <li>
          <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
            <Message message="admin.subscription_plans.stores.google_play" />
          </Suspense>
        </li>
      ) : null}
    </ul>
  );
};
