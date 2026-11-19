import type * as ActionForm from "@publira/ui-components/action-form";
import { Skeleton } from "@publira/ui-components/skeleton";

import { listAllLabels } from "#lib/label";
import { listAllSeries } from "#lib/series";
import type { SubscriptionPlanItem } from "#lib/subscription-plan-shared";
import { getTenantId } from "#lib/tenant-id";

import { SubscriptionPlanForm } from "./subscription-plan-form";

/** What stands in for the plan form while its choices load. */
export const SubscriptionPlanFormSkeleton = () => (
  <div className="grid gap-4">
    <Skeleton className="h-20" />
    <Skeleton className="h-28" />
    <Skeleton className="h-20" />
    <Skeleton className="h-36" />
    <Skeleton className="ml-auto h-10 w-36" />
  </div>
);

/**
 * The plan form with every label and series of the tenant to choose from. A
 * list that cannot be read empties its picker and says why beside it, and the
 * plan keeps the labels or series it already names.
 */
export const SubscriptionPlanFormData = async ({
  action,
  initialPlan,
}: {
  action: (
    prevState: ActionForm.State,
    formData: FormData
  ) => Promise<ActionForm.State>;
  initialPlan?: SubscriptionPlanItem;
}) => {
  const [tenantId, labelsResult, seriesResult] = await Promise.all([
    getTenantId(),
    listAllLabels(),
    listAllSeries(),
  ]);

  return (
    <SubscriptionPlanForm
      action={action}
      initialPlan={initialPlan}
      key={initialPlan?.publicId}
      labels={labelsResult.labels.map((label) => ({
        id: label.id,
        name: label.name,
      }))}
      labelsErrorMessage={labelsResult.ok ? undefined : labelsResult.message}
      series={seriesResult.series.map((item) => ({
        id: item.id,
        name: item.title,
      }))}
      seriesErrorMessage={seriesResult.ok ? undefined : seriesResult.message}
      tenantId={tenantId}
    />
  );
};
