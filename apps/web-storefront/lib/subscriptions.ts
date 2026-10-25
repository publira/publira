import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  Code,
  isRpcError,
  rethrowUnclassifiedRpcError,
} from "@publira/api-client/errors";
import {
  ClientSurface,
  SubscriptionInterval,
  SubscriptionPlanScope,
  SubscriptionStatus,
} from "@publira/api-client/public/types";
import type {
  Subscription,
  SubscriptionPlan,
} from "@publira/api-client/public/types";
import type { Locale } from "@publira/i18n";
import type { CachedReadResult } from "@publira/utils/cached-read";
import { cacheLife } from "next/cache";

import {
  apiClient,
  buildSessionHeaders,
  resolveAccessToken,
} from "./api-client";
import {
  applyCacheTag,
  tenantLabelsTag,
  tenantSeriesListTag,
} from "./cache-tags";
import { toLabelListItem, toSeriesListItem } from "./catalog";
import type { LabelListItem, SeriesListItem } from "./catalog";
import { getMessagesFor } from "./messages";
import { localizedReadFailure } from "./read-failure";

/** The unit a plan bills every `intervalCount` of. */
export type SubscriptionPlanInterval = "day" | "month" | "week" | "year";

/**
 * A plan the tenant has published: what one period costs, and what a reader
 * who pays it may read.
 */
export interface SubscriptionPlanItem {
  /** The primary key, which the checkout names the plan by. */
  id: string;
  name: string;
  /** Plain text; empty when the tenant wrote none. */
  description: string;
  /** What one period costs, in the minor unit of `currency`. */
  priceAmount: number;
  currency: string;
  interval: SubscriptionPlanInterval;
  intervalCount: number;
  /**
   * `all` opens every work of the site, `label` the works of `labels`, and
   * `series` the works of `series`. A scoped plan lists only what this site
   * shows, so either list may be shorter than what the tenant chose.
   */
  scope: "all" | "label" | "series";
  labels: LabelListItem[];
  series: SeriesListItem[];
}

/** A reader's subscription, as the payment provider last reported it. */
export interface SubscriptionItem {
  plan: { name: string };
  /** The provider's status of the same name. */
  status:
    | "active"
    | "canceled"
    | "incomplete"
    | "incomplete_expired"
    | "past_due"
    | "paused"
    | "trialing"
    | "unpaid";
  /** RFC 3339; the end of the period paid for. Empty when none was reported. */
  currentPeriodEnd: string;
  /** Whether the reader canceled it, which ends it at `currentPeriodEnd`. */
  cancelAtPeriodEnd: boolean;
}

export type GetMySubscriptionResult =
  | { ok: true; subscription: SubscriptionItem | null }
  | { message: string; ok: false; requiresSignIn: boolean };

const planIntervals: Partial<
  Record<SubscriptionInterval, SubscriptionPlanInterval>
> = {
  [SubscriptionInterval.DAY]: "day",
  [SubscriptionInterval.MONTH]: "month",
  [SubscriptionInterval.WEEK]: "week",
  [SubscriptionInterval.YEAR]: "year",
};

const planScopes: Partial<
  Record<SubscriptionPlanScope, SubscriptionPlanItem["scope"]>
> = {
  [SubscriptionPlanScope.ALL]: "all",
  [SubscriptionPlanScope.LABEL]: "label",
  [SubscriptionPlanScope.SERIES]: "series",
};

const subscriptionStatuses: Partial<
  Record<SubscriptionStatus, SubscriptionItem["status"]>
> = {
  [SubscriptionStatus.ACTIVE]: "active",
  [SubscriptionStatus.CANCELED]: "canceled",
  [SubscriptionStatus.INCOMPLETE]: "incomplete",
  [SubscriptionStatus.INCOMPLETE_EXPIRED]: "incomplete_expired",
  [SubscriptionStatus.PAST_DUE]: "past_due",
  [SubscriptionStatus.PAUSED]: "paused",
  [SubscriptionStatus.TRIALING]: "trialing",
  [SubscriptionStatus.UNPAID]: "unpaid",
};

/**
 * The generated `SubscriptionPlan` fields {@link toSubscriptionPlanItem}
 * reads. Naming them against the message type is what makes a proto rename
 * fail here — a restated structural type keeps compiling, and the plan page
 * then quotes a price of nothing with nothing pointing at the cause.
 */
type RawSubscriptionPlan = Pick<
  SubscriptionPlan,
  | "currency"
  | "description"
  | "id"
  | "interval"
  | "intervalCount"
  | "labels"
  | "name"
  | "priceAmount"
  | "scope"
  | "series"
>;

/**
 * A plan whose billing unit or scope this build has no name for is dropped:
 * the page could neither quote what it costs nor say what it opens.
 */
const toSubscriptionPlanItem = (
  plan: RawSubscriptionPlan
): SubscriptionPlanItem | null => {
  const interval = planIntervals[plan.interval];
  const scope = planScopes[plan.scope];
  const id = plan.id?.trim() ?? "";
  if (!(interval && scope && id)) {
    return null;
  }

  return {
    currency: plan.currency ?? "",
    description: plan.description ?? "",
    id,
    interval,
    intervalCount: plan.intervalCount ?? 0,
    labels: (plan.labels ?? []).map(toLabelListItem),
    name: plan.name ?? "",
    priceAmount: plan.priceAmount ?? 0,
    scope,
    series: (plan.series ?? []).map(toSeriesListItem),
  };
};

/**
 * Whether `plan` opens a work: every one for a plan of the whole site, and
 * otherwise one of the series it lists or one filed under a label it lists.
 */
export const subscriptionPlanOpens = (
  plan: Pick<SubscriptionPlanItem, "labels" | "scope" | "series">,
  work: { labelPublicId: string; seriesPublicId: string }
): boolean => {
  switch (plan.scope) {
    case "all": {
      return true;
    }
    case "label": {
      return (
        work.labelPublicId !== "" &&
        plan.labels.some((label) => label.publicId === work.labelPublicId)
      );
    }
    default: {
      return plan.series.some(
        (series) => series.publicId === work.seriesPublicId
      );
    }
  }
};

/**
 * Every plan the tenant has published, in the order it created them, each
 * naming the labels and works it opens in `locale`.
 *
 * The read names no reader, so one entry serves every visitor of a tenant.
 * The console saves a plan through the admin API, which tells this app
 * nothing, so the entry is refetched once it is a minute old; the catalog tags
 * it carries drop it as well when a work or a label it names changes.
 */
export const listSubscriptionPlans = async (
  tenantId: string,
  locale: Locale
): Promise<CachedReadResult<SubscriptionPlanItem[]>> => {
  "use cache";
  try {
    cacheLife("minutes");
  } catch {
    // Unit tests run without the Next.js cache runtime, same as applyCacheTag.
  }

  const normalizedTenantId = tenantId.trim();
  applyCacheTag(tenantSeriesListTag(normalizedTenantId));
  applyCacheTag(tenantLabelsTag(normalizedTenantId));

  let response: Awaited<
    ReturnType<typeof apiClient.subscription.listSubscriptionPlans>
  >;
  try {
    response = await apiClient.subscription.listSubscriptionPlans({
      locale,
      surface: ClientSurface.WEB,
      tenant: { tenantId: normalizedTenantId },
    });
  } catch (error) {
    return localizedReadFailure(error, locale, "storefront.plans.list_failed");
  }

  return {
    ok: true,
    value: (response.plans ?? []).flatMap((plan) => {
      const mapped = toSubscriptionPlanItem(plan);
      return mapped ? [mapped] : [];
    }),
  };
};

/**
 * The generated `Subscription` fields {@link toSubscriptionItem} reads, named
 * against the message type for the reason {@link RawSubscriptionPlan} is.
 */
type RawSubscription = Pick<
  Subscription,
  "cancelAtPeriodEnd" | "currentPeriodEnd" | "plan" | "status"
>;

/**
 * A subscription in a state this build has no name for reads as none: the
 * section could not say whether it is paid up or over.
 */
const toSubscriptionItem = (
  subscription: RawSubscription
): SubscriptionItem | null => {
  const status = subscriptionStatuses[subscription.status];
  if (!status) {
    return null;
  }

  return {
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd ?? false,
    currentPeriodEnd: subscription.currentPeriodEnd ?? "",
    plan: { name: subscription.plan?.name ?? "" },
    status,
  };
};

/**
 * Whether the reader holds a subscription a new checkout would be refused
 * for: one that is still billing, or one Stripe has stopped retrying but not
 * ended. Changing it is what the billing portal is for.
 */
export const holdsSubscription = (subscription: SubscriptionItem): boolean =>
  subscription.status === "active" ||
  subscription.status === "past_due" ||
  subscription.status === "paused" ||
  subscription.status === "trialing" ||
  subscription.status === "unpaid";

/**
 * The signed-in reader's subscription: the latest one that is not over, or
 * failing that the latest one that is, and `null` for a reader who has never
 * subscribed.
 *
 * Uncached, because it is one reader's own answer and it changes when Stripe's
 * notification reaches the API, which tells this app nothing — a reader coming
 * back from the checkout or the billing portal has to see the state as it now
 * stands.
 *
 * A session the API rejects is reported as `requiresSignIn` rather than as no
 * subscription, so a subscriber is never told they hold none.
 */
export const getMySubscription = async (
  tenantId: string,
  locale: Locale
): Promise<GetMySubscriptionResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    resolveAccessToken(),
  ]);
  if (!sessionId) {
    return {
      message: t("errors.rpc.unauthenticated"),
      ok: false,
      requiresSignIn: true,
    };
  }

  try {
    const response = await apiClient.subscription.getMySubscription(
      { tenant: { tenantId } },
      buildSessionHeaders(sessionId)
    );
    return {
      ok: true,
      subscription: response.subscription
        ? toSubscriptionItem(response.subscription)
        : null,
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(error, t("storefront.my.plan_failed"), {
        locale,
      }),
      ok: false,
      requiresSignIn: isRpcError(error, Code.Unauthenticated),
    };
  }
};
