/**
 * Records created by `db/seeds/scenarios/680_docs_subscription_plans.sql` on
 * the tenant of `670_storefront_subscriptions.sql`.
 */

export const DOCS_SUBSCRIPTION_PLANS_SCENARIO = "680_docs_subscription_plans";

export const DOCS_SUBSCRIPTION_PLANS = {
  /** The plan of the whole catalog, which the tenant's reader holds. */
  allAccess: {
    name: "All-access pass",
    publicId: "DsubPLANAAA1",
  },
  /** The unpublished yearly plan of the tenant's label. */
  yearly: {
    name: "Night pass, yearly",
    publicId: "DsubPLANAAA2",
  },
} as const;
