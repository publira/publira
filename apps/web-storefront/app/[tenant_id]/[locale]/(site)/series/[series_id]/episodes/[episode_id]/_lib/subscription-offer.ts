import type { Locale } from "@publira/i18n";

import {
  listSubscriptionPlans,
  subscriptionPlanOpens,
} from "#lib/subscriptions";

/**
 * Whether the gate offers a plan: the site takes payments and one of the plans
 * it sells opens the work. A plan read that failed offers none, which leaves
 * the gate as it was before the site sold plans.
 */
export const offersSubscription = async (
  tenantId: string,
  locale: Locale,
  {
    acceptsPayments,
    labelPublicId,
    seriesPublicId,
  }: { acceptsPayments: boolean; labelPublicId: string; seriesPublicId: string }
): Promise<boolean> => {
  if (!acceptsPayments) {
    return false;
  }

  const result = await listSubscriptionPlans(tenantId, locale);

  return (
    result.ok &&
    result.value.some((plan) =>
      subscriptionPlanOpens(plan, { labelPublicId, seriesPublicId })
    )
  );
};
