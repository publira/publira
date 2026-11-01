import type { Locale } from "@publira/i18n";
import { Button, LinkButton } from "@publira/ui-components/button";
import * as EmptyState from "@publira/ui-components/empty-state";
import * as SectionError from "@publira/ui-components/section-error";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { formatPrice } from "@publira/utils";
import { Suspense } from "react";

import { LocaleField } from "#components/locale-field";
import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import * as SeriesShelf from "#components/series-shelf";
import { resolveAccessToken } from "#lib/api-client";
import { getLocale } from "#lib/locale";
import {
  getMySubscription,
  holdsSubscription,
  listSubscriptionPlans,
} from "#lib/subscriptions";
import type {
  SubscriptionItem,
  SubscriptionPlanItem,
} from "#lib/subscriptions";
import { getTenantSiteInfo } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

import { startSubscriptionCheckoutAction } from "../_lib/actions";
import { plansPath } from "../_lib/plans-path";

/**
 * What one period of the plan costs, worded by its billing unit. Each unit
 * writes its own key out, so every key this screen renders is spelled here.
 */
const PlanPrice = ({
  locale,
  plan,
}: {
  locale: Locale;
  plan: SubscriptionPlanItem;
}) => {
  const values = {
    count: plan.intervalCount,
    price: formatPrice(plan.priceAmount, { currency: plan.currency, locale }),
  };

  switch (plan.interval) {
    case "day": {
      return <Message message="storefront.plans.billing.day" values={values} />;
    }

    case "week": {
      return (
        <Message message="storefront.plans.billing.week" values={values} />
      );
    }

    case "month": {
      return (
        <Message message="storefront.plans.billing.month" values={values} />
      );
    }

    default: {
      return (
        <Message message="storefront.plans.billing.year" values={values} />
      );
    }
  }
};

/**
 * What the plan opens: the whole site, or the labels and works it names. A
 * scoped plan whose every label and work is off the site says so rather than
 * showing an empty list.
 */
const PlanScope = ({
  locale,
  plan,
}: {
  locale: Locale;
  plan: SubscriptionPlanItem;
}) => {
  if (plan.scope === "all") {
    return (
      <p className="text-sm">
        <Suspense fallback={<SkeletonLine className="h-4 w-56" />}>
          <Message message="storefront.plans.scope_all" />
        </Suspense>
      </p>
    );
  }

  if (plan.labels.length === 0 && plan.series.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-56" />}>
          <Message message="storefront.plans.scope_none_shown" />
        </Suspense>
      </p>
    );
  }

  if (plan.scope === "label") {
    return (
      <div className="grid gap-2">
        <p className="text-sm">
          <Suspense fallback={<SkeletonLine className="h-4 w-56" />}>
            <Message message="storefront.plans.scope_label" />
          </Suspense>
        </p>
        <ul className="flex flex-wrap gap-x-4 gap-y-2">
          {plan.labels.map((label) => (
            <li key={label.publicId}>
              <LocaleLink
                className="text-sm text-primary underline underline-offset-4"
                href={`/labels/${label.publicId}`}
              >
                {label.name}
              </LocaleLink>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <p className="text-sm">
        <Suspense fallback={<SkeletonLine className="h-4 w-56" />}>
          <Message message="storefront.plans.scope_series" />
        </Suspense>
      </p>
      <SeriesShelf.Root locale={locale} series={plan.series} />
    </div>
  );
};

/**
 * Which plan the reader already holds, and which store bills it when one
 * does. Each branch writes its own key out.
 */
const HeldPlan = ({
  planName,
  store,
}: {
  planName: string;
  store: SubscriptionItem["store"];
}) => {
  if (store === "app_store") {
    return (
      <Message
        message="storefront.plans.already_subscribed_app_store"
        values={{ plan: planName }}
      />
    );
  }

  if (store === "google_play") {
    return (
      <Message
        message="storefront.plans.already_subscribed_google_play"
        values={{ plan: planName }}
      />
    );
  }

  return (
    <Message
      message="storefront.plans.already_subscribed"
      values={{ plan: planName }}
    />
  );
};

/**
 * The plans with the one control each offers this reader: a subscribe button,
 * the way to sign in first, or nothing while they already hold a plan or the
 * site cannot sell one.
 *
 * One reader holds one subscription, so a reader who already holds one is
 * told which, and which store bills it when one does, and sent to My Page
 * where it is changed, instead of being offered a checkout the API would
 * refuse.
 */
export const PlanList = async () => {
  const [tenantId, locale, sessionId] = await Promise.all([
    getTenantId(),
    getLocale(),
    resolveAccessToken(),
  ]);

  const [result, tenant, mine] = await Promise.all([
    listSubscriptionPlans(tenantId, locale),
    getTenantSiteInfo(tenantId),
    sessionId ? getMySubscription(tenantId, locale) : null,
  ]);

  if (!result.ok) {
    return (
      <SectionError.Root>
        <SectionError.Heading>
          <SectionError.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="storefront.plans.list_error" />
            </Suspense>
          </SectionError.Title>
          <SectionError.Description>{result.message}</SectionError.Description>
        </SectionError.Heading>
      </SectionError.Root>
    );
  }

  if (result.value.length === 0) {
    return (
      <EmptyState.Root>
        <EmptyState.Description>
          <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
            <Message message="storefront.plans.empty" />
          </Suspense>
        </EmptyState.Description>
      </EmptyState.Root>
    );
  }

  // A reader whose session the API rejected is offered the way to sign in,
  // the same as a guest.
  const signedIn = mine !== null && !(mine.ok === false && mine.requiresSignIn);

  const held =
    mine?.ok && mine.subscription && holdsSubscription(mine.subscription)
      ? mine.subscription
      : null;

  const sells = tenant?.acceptsPayments === true;

  return (
    <div className="grid gap-6">
      {held ? (
        <p className="rounded-control border border-border px-4 py-3 text-sm">
          <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
            <HeldPlan planName={held.plan.name} store={held.store} />
          </Suspense>{" "}
          <LocaleLink
            className="text-primary underline underline-offset-4"
            href="/my"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <Message message="storefront.plans.to_my_page" />
            </Suspense>
          </LocaleLink>
        </p>
      ) : null}
      {sells ? null : (
        <p className="text-sm text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
            <Message message="storefront.plans.not_selling" />
          </Suspense>
        </p>
      )}
      <ul className="grid gap-6">
        {result.value.map((plan) => (
          <li
            className="grid gap-4 border border-border bg-card p-6"
            key={plan.id}
          >
            <div className="grid gap-1">
              <h2 className="font-serif text-xl leading-tight">{plan.name}</h2>
              <p className="text-lg tabular-nums">
                <Suspense fallback={<SkeletonLine className="h-5 w-32" />}>
                  <PlanPrice locale={locale} plan={plan} />
                </Suspense>
              </p>
            </div>
            {plan.description ? (
              <p className="text-sm whitespace-pre-line text-muted-foreground">
                {plan.description}
              </p>
            ) : null}
            <PlanScope locale={locale} plan={plan} />
            {sells && !held && signedIn ? (
              <form action={startSubscriptionCheckoutAction}>
                <LocaleField />
                <input name="tenantId" type="hidden" value={tenantId} />
                <input name="planId" type="hidden" value={plan.id} />
                <Button size="lg" type="submit" variant="secondary">
                  <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                    <Message message="storefront.plans.subscribe" />
                  </Suspense>
                </Button>
              </form>
            ) : null}
            {sells && !signedIn ? (
              <div>
                <LinkButton
                  render={
                    <LocaleLink
                      href={`/login?returnTo=${encodeURIComponent(plansPath())}`}
                    />
                  }
                  size="lg"
                  variant="secondary"
                >
                  <Suspense fallback={<SkeletonLine className="h-4 w-36" />}>
                    <Message message="storefront.plans.login_to_subscribe" />
                  </Suspense>
                </LinkButton>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
};
