import type { Locale } from "@publira/i18n";
import { LinkButton } from "@publira/ui-components/button";
import * as EmptyState from "@publira/ui-components/empty-state";
import * as SectionError from "@publira/ui-components/section-error";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import * as Table from "@publira/ui-components/table";
import Link from "next/link";
import { Suspense } from "react";

import { Message } from "#components/message";
import type { SubscriptionPlanItem } from "#lib/subscription-plan-shared";

import { SubscriptionPlanDeleteButton } from "./subscription-plan-delete-button";
import {
  SubscriptionPlanBilling,
  SubscriptionPlanScopeSummary,
  SubscriptionPlanStatusChip,
} from "./subscription-plan-summary";

interface SubscriptionPlanListProps {
  listErrorMessage?: string;
  locale: Locale;
  plans: SubscriptionPlanItem[];
  tenantId: string;
}

/**
 * The tenant's plans in the order they were created, each with what it costs,
 * what it opens, whether the site lists it, and how many readers hold it.
 * The API caps a tenant at 20 plans, so the list is never paged.
 */
export const SubscriptionPlanList = ({
  listErrorMessage,
  locale,
  plans,
  tenantId,
}: SubscriptionPlanListProps) => {
  // A failed read still hands an empty array; the empty state next to the
  // error would read as "this tenant has no plans".
  if (listErrorMessage) {
    return (
      <SectionError.Root>
        <SectionError.Heading>
          <SectionError.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="admin.subscription_plans.list_error" />
            </Suspense>
          </SectionError.Title>
          <SectionError.Description>
            {listErrorMessage}
          </SectionError.Description>
        </SectionError.Heading>
      </SectionError.Root>
    );
  }

  if (plans.length === 0) {
    return (
      <EmptyState.Root>
        <EmptyState.Heading>
          <EmptyState.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-48" />}>
              <Message message="admin.subscription_plans.empty_title" />
            </Suspense>
          </EmptyState.Title>
          <EmptyState.Description>
            <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
              <Message message="admin.subscription_plans.empty_description" />
            </Suspense>
          </EmptyState.Description>
        </EmptyState.Heading>
      </EmptyState.Root>
    );
  }

  return (
    <Table.Root>
      <Table.Header>
        <Table.Row>
          <Table.Head>
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="admin.subscription_plans.columns.name" />
            </Suspense>
          </Table.Head>
          <Table.Head>
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="admin.subscription_plans.columns.price" />
            </Suspense>
          </Table.Head>
          <Table.Head>
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="admin.subscription_plans.columns.scope" />
            </Suspense>
          </Table.Head>
          <Table.Head>
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="admin.subscription_plans.columns.status" />
            </Suspense>
          </Table.Head>
          <Table.Head className="text-right">
            <Suspense fallback={<SkeletonLine className="ml-auto h-4 w-20" />}>
              <Message message="admin.subscription_plans.columns.subscribers" />
            </Suspense>
          </Table.Head>
          <Table.Head className="w-48">
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="admin.subscription_plans.columns.actions" />
            </Suspense>
          </Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {plans.map((plan) => (
          <Table.Row key={plan.id}>
            <Table.Cell className="font-medium">{plan.name}</Table.Cell>
            <Table.Cell className="tabular-nums">
              <SubscriptionPlanBilling locale={locale} plan={plan} />
            </Table.Cell>
            <Table.Cell>
              <SubscriptionPlanScopeSummary plan={plan} />
            </Table.Cell>
            <Table.Cell>
              <SubscriptionPlanStatusChip published={plan.published} />
            </Table.Cell>
            <Table.Cell className="text-right tabular-nums">
              {plan.subscriberCount}
            </Table.Cell>
            <Table.Cell>
              <div className="flex flex-wrap items-start gap-2">
                <LinkButton
                  render={
                    <Link href={`/subscription-plans/${plan.publicId}`} />
                  }
                  size="sm"
                  variant="outline"
                >
                  <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                    <Message message="admin.subscription_plans.edit_action" />
                  </Suspense>
                </LinkButton>
                <SubscriptionPlanDeleteButton
                  id={plan.id}
                  name={plan.name}
                  tenantId={tenantId}
                />
              </div>
            </Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Root>
  );
};
