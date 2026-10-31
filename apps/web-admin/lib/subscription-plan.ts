import {
  SubscriptionInterval,
  SubscriptionPlanScope,
} from "@publira/api-client/admin/types";
import type { AdminSubscriptionPlan } from "@publira/api-client/admin/types";
import { rpcErrorMessage } from "@publira/api-client/error-messages";
import type { RpcErrorMessageOverrides } from "@publira/api-client/error-messages";
import {
  RPC_ERROR_REASON,
  rethrowUnclassifiedRpcError,
  rpcErrorDisposition,
  rpcErrorHasFieldViolation,
  rpcErrorHasReason,
} from "@publira/api-client/errors";
import type { Locale } from "@publira/i18n";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";
import { cacheTag } from "next/cache";

import {
  isUnauthenticatedError,
  rethrowUnauthenticatedRpcError,
} from "./admin-auth-shared";
import { apiClient, withSessionHeaders } from "./api";
import type { CachedRead } from "./cached-read";
import { settleCachedRead } from "./cached-read";
import { getMessagesFor } from "./messages";
import { getAccessToken } from "./session";
import type {
  SubscriptionIntervalValue,
  SubscriptionPlanItem,
  SubscriptionPlanScopeValue,
} from "./subscription-plan-shared";

export type ListSubscriptionPlansResult =
  | { ok: true; plans: SubscriptionPlanItem[] }
  | {
      ok: false;
      message: string;
      plans: SubscriptionPlanItem[];
      /** The API rejected the session — the page raises the login redirect. */
      requiresSignIn: boolean;
    };

/**
 * `notFound: true` is the "there is nothing to show here" failure the edit
 * screen turns into `notFound()`, carrying no message for the same reason
 * `GetCampaignBannerResult` carries none.
 */
export type GetSubscriptionPlanResult =
  | { ok: true; plan: SubscriptionPlanItem }
  | { notFound: true; ok: false }
  | {
      message: string;
      notFound?: false;
      ok: false;
      /** The API rejected the session — the page raises the login redirect. */
      requiresSignIn: boolean;
    };

export type SaveSubscriptionPlanResult =
  | { ok: true; plan: SubscriptionPlanItem }
  | { ok: false; message: string };

export type DeleteSubscriptionPlanResult =
  | { ok: true }
  | { ok: false; message: string };

/** The tag every plan read is filed under, and every plan write drops. */
export const subscriptionPlansCacheTag = (tenantId: string): string =>
  `subscription-plans-${tenantId}`;

const SCOPE_ENUM: Record<SubscriptionPlanScopeValue, SubscriptionPlanScope> = {
  all: SubscriptionPlanScope.ALL,
  label: SubscriptionPlanScope.LABEL,
  series: SubscriptionPlanScope.SERIES,
};

const INTERVAL_VALUES = new Map<
  SubscriptionInterval,
  SubscriptionIntervalValue
>([
  [SubscriptionInterval.DAY, "day"],
  [SubscriptionInterval.WEEK, "week"],
  [SubscriptionInterval.MONTH, "month"],
  [SubscriptionInterval.YEAR, "year"],
]);

/**
 * A read never answers the unspecified scope, so one that does — a response
 * that carried no field — is shown as the whole catalog, which is what a plan
 * naming neither labels nor series opens.
 */
const toScopeValue = (
  scope: SubscriptionPlanScope | undefined
): SubscriptionPlanScopeValue => {
  if (scope === SubscriptionPlanScope.LABEL) {
    return "label";
  }

  if (scope === SubscriptionPlanScope.SERIES) {
    return "series";
  }

  return "all";
};

/** The generated `AdminSubscriptionPlan` fields {@link mapSubscriptionPlan} reads. */
type RawSubscriptionPlan = Pick<
  AdminSubscriptionPlan,
  | "currency"
  | "description"
  | "id"
  | "interval"
  | "intervalCount"
  | "labelIds"
  | "name"
  | "priceAmount"
  | "publicId"
  | "published"
  | "scope"
  | "seriesIds"
  | "stripePriceId"
  | "subscriberCount"
>;

const mapSubscriptionPlan = (
  plan: RawSubscriptionPlan
): SubscriptionPlanItem => ({
  currency: plan.currency ?? "",
  description: plan.description ?? "",
  id: plan.id ?? "",
  interval: INTERVAL_VALUES.get(plan.interval) ?? "",
  intervalCount: plan.intervalCount ?? 0,
  labelIds: plan.labelIds ?? [],
  name: plan.name ?? "",
  priceAmount: plan.priceAmount ?? 0,
  publicId: plan.publicId ?? "",
  published: plan.published ?? false,
  scope: toScopeValue(plan.scope),
  seriesIds: plan.seriesIds ?? [],
  stripePriceId: plan.stripePriceId ?? "",
  subscriberCount: plan.subscriberCount ?? 0,
});

/**
 * The rules the API holds a create and an update to. `invalid-argument` names
 * the field it refused, so each gets the wording that tells the operator what
 * to change; `conflict` is a Price another plan already bills; and
 * `precondition` is either the tenant's plan limit or a tenant that takes no
 * payments through Stripe, which is the only provider that sells plans.
 */
const saveOverrides = async (
  error: unknown,
  locale: Locale
): Promise<RpcErrorMessageOverrides> => {
  const t = await getMessagesFor(locale);

  const invalidArgument = (): string => {
    if (rpcErrorHasFieldViolation(error, "plan.stripe_price_id")) {
      return t("admin.subscription_plans.validation.price_invalid");
    }

    // The form refuses an empty name before it is sent, so a refused name
    // is one the API counts longer than the form did.
    if (rpcErrorHasFieldViolation(error, "plan.name")) {
      return t("admin.subscription_plans.validation.name_too_long");
    }

    if (rpcErrorHasFieldViolation(error, "plan.description")) {
      return t("admin.subscription_plans.validation.description_too_long");
    }

    if (
      rpcErrorHasFieldViolation(error, "plan.scope") ||
      rpcErrorHasFieldViolation(error, "plan.label_ids") ||
      rpcErrorHasFieldViolation(error, "plan.series_ids")
    ) {
      return t("admin.subscription_plans.validation.targets_invalid");
    }

    return t("errors.validation");
  };

  return {
    conflict: t("admin.subscription_plans.price_in_use"),
    "invalid-argument": invalidArgument(),
    precondition: rpcErrorHasReason(
      error,
      RPC_ERROR_REASON.subscriptionPlanLimit
    )
      ? t("admin.subscription_plans.limit_reached")
      : t("admin.subscription_plans.stripe_not_ready"),
  };
};

const listSubscriptionPlansForSession = async (
  tenantId: string,
  locale: Locale,
  sessionId: string
): Promise<CachedRead<ListSubscriptionPlansResult>> => {
  "use cache: private";
  cacheTag(subscriptionPlansCacheTag(tenantId));

  const t = await getMessagesFor(locale);

  if (!sessionId) {
    dropFailedCacheEntry();

    return {
      message: t("errors.rpc.unauthenticated"),
      ok: false,
      plans: [],
      requiresSignIn: true,
    };
  }

  try {
    const response = await apiClient.subscriptionPlans.listSubscriptionPlans(
      { tenant: { tenantId } },
      withSessionHeaders(sessionId)
    );

    return {
      ok: true,
      plans: (response.plans ?? []).map((plan) => mapSubscriptionPlan(plan)),
    };
  } catch (error) {
    // A `"use cache"` scope cannot rethrow: the fill would fail the whole
    // request. The entry is dropped instead, so the list comes back as soon
    // as the API does, and an unexpected failure is thrown by the caller.
    dropFailedCacheEntry();

    return {
      message: rpcErrorMessage(
        error,
        t("admin.subscription_plans.list_failed"),
        { locale }
      ),
      ok: false,
      plans: [],
      requiresSignIn: isUnauthenticatedError(error),
      unexpected: rpcErrorDisposition(error) === "unexpected",
    };
  }
};

/**
 * Every plan of the tenant, unpublished ones included, in the order they were
 * created, each with how many readers hold it.
 *
 * The API caps a tenant at 20 plans and answers them in one response.
 *
 * Read with the operator's session: the API admits only a tenant admin on
 * `ListSubscriptionPlans`, so the read stays private to the operator.
 */
export const listSubscriptionPlans = async (
  tenantId: string,
  locale: Locale
): Promise<ListSubscriptionPlansResult> =>
  settleCachedRead(
    await listSubscriptionPlansForSession(
      tenantId,
      locale,
      await getAccessToken()
    )
  );

/**
 * One plan of the tenant, for the screen it is edited on.
 *
 * Picked out of {@link listSubscriptionPlans}, which the console already reads
 * whole and files under the same tag, rather than read again by its own RPC.
 */
export const getSubscriptionPlan = async (
  input: { publicId: string; tenantId: string },
  locale: Locale
): Promise<GetSubscriptionPlanResult> => {
  const result = await listSubscriptionPlans(input.tenantId, locale);

  if (!result.ok) {
    return {
      message: result.message,
      ok: false,
      requiresSignIn: result.requiresSignIn,
    };
  }

  const plan = result.plans.find(
    (candidate) => candidate.publicId === input.publicId
  );

  return plan ? { ok: true, plan } : { notFound: true, ok: false };
};

/** What a create and an update both carry. */
export interface SubscriptionPlanFields {
  tenantId: string;
  name: string;
  description: string;
  stripePriceId: string;
  scope: SubscriptionPlanScopeValue;
  /** Sent only for a plan of labels; the API refuses them on any other. */
  labelIds: string[];
  /** Sent only for a plan of series; the API refuses them on any other. */
  seriesIds: string[];
  published: boolean;
}

const toPlanInput = (input: SubscriptionPlanFields) => ({
  description: input.description,
  labelIds: input.scope === "label" ? input.labelIds : [],
  name: input.name,
  published: input.published,
  scope: SCOPE_ENUM[input.scope],
  seriesIds: input.scope === "series" ? input.seriesIds : [],
  stripePriceId: input.stripePriceId,
});

/**
 * Creates a plan. The API asks the tenant's Stripe account for the Price
 * before it stores anything, and keeps the amount and the interval it answers.
 */
export const createSubscriptionPlan = async (
  input: SubscriptionPlanFields,
  locale: Locale
): Promise<SaveSubscriptionPlanResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);

  if (!sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    const response = await apiClient.subscriptionPlans.createSubscriptionPlan(
      { plan: toPlanInput(input), tenant: { tenantId: input.tenantId } },
      withSessionHeaders(sessionId)
    );

    if (!response.plan?.id?.trim()) {
      return {
        message: t("admin.subscription_plans.save_failed"),
        ok: false,
      };
    }

    return { ok: true, plan: mapSubscriptionPlan(response.plan) };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);

    return {
      message: rpcErrorMessage(
        error,
        t("admin.subscription_plans.save_failed"),
        { locale, overrides: await saveOverrides(error, locale) }
      ),
      ok: false,
    };
  }
};

/**
 * Replaces every field of the plan. A subscription already started keeps the
 * Price it was started at, whatever this changes.
 */
export const updateSubscriptionPlan = async (
  input: SubscriptionPlanFields & { id: string },
  locale: Locale
): Promise<SaveSubscriptionPlanResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);

  if (!sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    const response = await apiClient.subscriptionPlans.updateSubscriptionPlan(
      {
        plan: toPlanInput(input),
        subscriptionPlanId: input.id,
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );

    if (!response.plan?.id?.trim()) {
      return {
        message: t("admin.subscription_plans.save_failed"),
        ok: false,
      };
    }

    return { ok: true, plan: mapSubscriptionPlan(response.plan) };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);

    return {
      message: rpcErrorMessage(
        error,
        t("admin.subscription_plans.save_failed"),
        { locale, overrides: await saveOverrides(error, locale) }
      ),
      ok: false,
    };
  }
};

/**
 * Removes a plan nobody has subscribed to. One a subscription or a reader's
 * latest checkout names is refused, and is unpublished instead.
 */
export const deleteSubscriptionPlan = async (
  input: { tenantId: string; id: string },
  locale: Locale
): Promise<DeleteSubscriptionPlanResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);

  if (!sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    await apiClient.subscriptionPlans.deleteSubscriptionPlan(
      {
        subscriptionPlanId: input.id,
        tenant: { tenantId: input.tenantId },
      },
      withSessionHeaders(sessionId)
    );

    return { ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);

    return {
      message: rpcErrorMessage(
        error,
        t("admin.subscription_plans.delete_failed"),
        {
          locale,
          overrides: {
            precondition: rpcErrorHasReason(
              error,
              RPC_ERROR_REASON.subscriptionPlanInUse
            )
              ? t("admin.subscription_plans.delete_in_use")
              : undefined,
          },
        }
      ),
      ok: false,
    };
  }
};
