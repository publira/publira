/**
 * What a subscription plan opens: the tenant's whole catalog, the series of
 * some labels, or some series.
 *
 * Strings rather than the generated `SubscriptionPlanScope` enum, because that
 * is what the form posts. `subscription-plan.ts` is where they meet the enum,
 * and it is in the server graph — this module is the half a Client Component
 * may import.
 */
export const SUBSCRIPTION_PLAN_SCOPES = ["all", "label", "series"] as const;

export type SubscriptionPlanScopeValue =
  (typeof SUBSCRIPTION_PLAN_SCOPES)[number];

export const isSubscriptionPlanScopeValue = (
  value: string
): value is SubscriptionPlanScopeValue =>
  SUBSCRIPTION_PLAN_SCOPES.some((scope) => scope === value);

/** The unit a plan's Price bills every so many of, as Stripe names it. */
export type SubscriptionIntervalValue = "day" | "month" | "week" | "year";

/** The bounds the API holds a plan to. */
export const SUBSCRIPTION_PLAN_NAME_MAX_LENGTH = 100;
export const SUBSCRIPTION_PLAN_DESCRIPTION_MAX_LENGTH = 2000;
export const SUBSCRIPTION_PLAN_MAX_TARGETS = 100;
export const SUBSCRIPTION_PLAN_STORE_PRODUCT_ID_MAX_LENGTH = 100;

/** A plan as the console shows and edits it. */
export interface SubscriptionPlanItem {
  /** The primary key every plan write addresses the plan by. */
  id: string;
  /** What the plan's edit screen is addressed by in the URL. */
  publicId: string;
  name: string;
  /** Plain text; empty when the tenant wrote none. */
  description: string;
  /** The recurring Price on the tenant's Stripe account (`price_…`). */
  stripePriceId: string;
  /** What one period costs, in the minor unit of {@link currency}. */
  priceAmount: number;
  currency: string;
  /** Empty for an interval this console does not know. */
  interval: "" | SubscriptionIntervalValue;
  intervalCount: number;
  scope: SubscriptionPlanScopeValue;
  labelIds: string[];
  seriesIds: string[];
  published: boolean;
  /** Readers whose subscription is trialing, active, or past due. */
  subscriberCount: number;
  /**
   * The auto-renewable subscription the plan is sold as in the tenant's iOS
   * app; empty when the app does not sell it there.
   */
  appStoreProductId: string;
  /** The same in the Android app, as the Play Console names it. */
  googlePlayProductId: string;
}

/** A label or a series a plan can name, as the scope picker offers it. */
export interface SubscriptionPlanTargetOption {
  id: string;
  name: string;
}
