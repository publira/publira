import type { Locale } from "@publira/i18n";
import { Button, LinkButton } from "@publira/ui-components/button";
import * as SectionError from "@publira/ui-components/section-error";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { formatDate } from "@publira/utils";
import { Suspense } from "react";
import type { ReactNode } from "react";

import { LocaleField } from "#components/locale-field";
import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { redirectToLogin } from "#lib/auth-session";
import { getLocale } from "#lib/locale";
import {
  getMySubscription,
  holdsSubscription,
  listSubscriptionPlans,
} from "#lib/subscriptions";
import type { SubscriptionItem } from "#lib/subscriptions";
import { getTenantDisplayTimeZone, getTenantSiteInfo } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

import { openBillingPortalAction } from "../_lib/actions";

/**
 * Its heading names the section, which is what turns the `<section>` into a
 * landmark a reader can jump to and a test can scope to.
 */
const PLAN_HEADING_ID = "plan-heading";

const PlanSection = ({ children }: { children: ReactNode }) => (
  <section
    aria-labelledby={PLAN_HEADING_ID}
    className="border border-border bg-card p-6"
  >
    <h2 className="mb-4 text-lg font-semibold" id={PLAN_HEADING_ID}>
      <Suspense fallback={<SkeletonLine className="h-6 w-32" />}>
        <Message message="storefront.my.plan_heading" />
      </Suspense>
    </h2>
    {children}
  </section>
);

/**
 * The way to the plan page, the section's one Shu: the step a reader without
 * a running plan has left to take.
 */
const SeePlansLink = () => (
  <LinkButton render={<LocaleLink href="/plans" />} variant="secondary">
    <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
      <Message message="storefront.my.to_plans" />
    </Suspense>
  </LinkButton>
);

/**
 * Where the subscription stands, in the states a reader can do something
 * about: paid up and renewing, canceled and running out, a payment to fix, or
 * over. Each branch writes its own key out.
 */
const PlanState = ({
  locale,
  subscription,
  timeZone,
}: {
  locale: Locale;
  subscription: SubscriptionItem;
  timeZone: string;
}) => {
  const date = formatDate(subscription.currentPeriodEnd, {
    fallback: "",
    locale,
    timeZone,
  });

  switch (subscription.status) {
    case "active":
    case "trialing": {
      if (!date) {
        return null;
      }
      return subscription.cancelAtPeriodEnd ? (
        <Message message="storefront.my.plan_ends_on" values={{ date }} />
      ) : (
        <Message message="storefront.my.plan_renews_on" values={{ date }} />
      );
    }
    case "past_due": {
      return <Message message="storefront.my.plan_past_due" />;
    }
    case "paused":
    case "unpaid": {
      return <Message message="storefront.my.plan_on_hold" />;
    }
    case "incomplete": {
      return <Message message="storefront.my.plan_incomplete" />;
    }
    default: {
      return <Message message="storefront.my.plan_ended" />;
    }
  }
};

/**
 * The reader's plan: which one, where it stands, and the way into Stripe's
 * billing portal, where it is changed or canceled. A reader whose plan is over
 * is offered the plans again.
 *
 * A reader who has never subscribed sees the section only where the site sells
 * a plan, as the way to the plan page; on a site that sells none it would be a
 * heading over nothing.
 */
export const SubscriptionSection = async () => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);
  const result = await getMySubscription(tenantId, locale);

  if (!result.ok && result.requiresSignIn) {
    await redirectToLogin(locale, "/my", tenantId);
  }

  if (!result.ok) {
    return (
      <PlanSection>
        <SectionError.Root>
          <SectionError.Heading>
            <SectionError.Title>
              <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                <Message message="storefront.my.plan_error" />
              </Suspense>
            </SectionError.Title>
            <SectionError.Description>
              {result.message}
            </SectionError.Description>
          </SectionError.Heading>
        </SectionError.Root>
      </PlanSection>
    );
  }

  const { subscription } = result;
  if (!subscription) {
    const [plans, tenant] = await Promise.all([
      listSubscriptionPlans(tenantId, locale),
      getTenantSiteInfo(tenantId),
    ]);
    if (!(plans.ok && plans.value.length > 0 && tenant?.acceptsPayments)) {
      return null;
    }
    return (
      <PlanSection>
        <div className="grid justify-items-start gap-4">
          <p className="text-sm text-muted-foreground">
            <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
              <Message message="storefront.my.plan_none" />
            </Suspense>
          </p>
          <SeePlansLink />
        </div>
      </PlanSection>
    );
  }

  const timeZone = await getTenantDisplayTimeZone(tenantId);
  const over =
    !holdsSubscription(subscription) && subscription.status !== "incomplete";

  return (
    <PlanSection>
      <div className="grid gap-4">
        <div className="grid gap-1">
          <p className="font-serif text-xl leading-tight">
            {subscription.plan.name}
          </p>
          <p className="text-sm text-muted-foreground">
            <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
              <PlanState
                locale={locale}
                subscription={subscription}
                timeZone={timeZone}
              />
            </Suspense>
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <form action={openBillingPortalAction}>
            <LocaleField />
            <input name="tenantId" type="hidden" value={tenantId} />
            {/* Changing a card or reading an invoice is occasional, so the
              portal stays outlined rather than taking the page's Shu. */}
            <Button type="submit" variant="outline">
              <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
                <Message message="storefront.my.manage_billing" />
              </Suspense>
            </Button>
          </form>
          {over ? <SeePlansLink /> : null}
        </div>
      </div>
    </PlanSection>
  );
};
