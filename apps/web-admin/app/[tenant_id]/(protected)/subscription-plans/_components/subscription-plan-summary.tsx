import type { Locale } from "@publira/i18n";
import { StatusChip } from "@publira/ui-components/badge";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import { formatTenantAmount, readCurrency } from "#lib/price";
import type { SubscriptionPlanItem } from "#lib/subscription-plan-shared";

/**
 * What one period of the plan costs and how often it is billed, as the Price
 * stated them when the plan was saved. Each branch names its key inside the
 * `<Message>` it returns, so the key is where a translation extractor sees it.
 */
const SubscriptionPlanBillingMessage = ({
  locale,
  plan,
}: {
  locale: Locale;
  plan: Pick<
    SubscriptionPlanItem,
    "currency" | "interval" | "intervalCount" | "priceAmount"
  >;
}) => {
  const price = formatTenantAmount(plan.priceAmount, {
    currency: readCurrency(plan.currency),
    locale,
  });

  const values = { count: plan.intervalCount, price };

  switch (plan.interval) {
    case "day": {
      return (
        <Message
          message="admin.subscription_plans.billing.day"
          values={values}
        />
      );
    }

    case "week": {
      return (
        <Message
          message="admin.subscription_plans.billing.week"
          values={values}
        />
      );
    }

    case "month": {
      return (
        <Message
          message="admin.subscription_plans.billing.month"
          values={values}
        />
      );
    }

    case "year": {
      return (
        <Message
          message="admin.subscription_plans.billing.year"
          values={values}
        />
      );
    }

    default: {
      return price;
    }
  }
};

export const SubscriptionPlanBilling = ({
  locale,
  plan,
}: {
  locale: Locale;
  plan: Pick<
    SubscriptionPlanItem,
    "currency" | "interval" | "intervalCount" | "priceAmount"
  >;
}) => (
  <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
    <SubscriptionPlanBillingMessage locale={locale} plan={plan} />
  </Suspense>
);

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
