import * as ConsolePage from "@publira/layouts/admin/console-page";
import { LinkButton } from "@publira/ui-components/button";
import * as SectionError from "@publira/ui-components/section-error";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import {
  parseRouteParams,
  routeParamString,
} from "@publira/utils/route-params";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";

import { FlashToast } from "#components/flash-toast";
import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import {
  TenantAdminRoute,
  TenantRoleRouteSkeleton,
} from "#components/tenant-role-gate";
import {
  isSignedInTenantAdmin,
  redirectToLoginIfSessionRejected,
} from "#lib/auth-session";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getSubscriptionPlan } from "#lib/subscription-plan";
import { getTenantId } from "#lib/tenant-id";

import {
  SubscriptionPlanFormData,
  SubscriptionPlanFormSkeleton,
} from "../_components/subscription-plan-form-data";
import {
  SubscriptionPlanBilling,
  SubscriptionPlanStatusChip,
} from "../_components/subscription-plan-summary";
import { updateSubscriptionPlanAction } from "../_lib/actions";

type EditSubscriptionPlanPageProps =
  PageProps<"/[tenant_id]/subscription-plans/[subscription_plan_id]">;

const editSubscriptionPlanParamsSchema = z.object({
  subscription_plan_id: routeParamString(),
});

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const [locale, isAdmin] = await Promise.all([
    getLocale(tenantId),
    isSignedInTenantAdmin(tenantId),
  ]);
  const t = await getMessagesFor(locale);

  return {
    title: isAdmin
      ? t("admin.subscription_plans.edit_title")
      : t("admin.not_found.title"),
  };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id", "subscription_plan_id");

const EditSubscriptionPlanContent = async ({
  params,
}: Pick<EditSubscriptionPlanPageProps, "params">) => {
  const [rawParams, tenantId] = await Promise.all([params, getTenantId()]);
  const parsedParams = parseRouteParams(
    editSubscriptionPlanParamsSchema,
    rawParams
  );
  if (!parsedParams) {
    notFound();
  }

  const locale = await getLocale(tenantId);
  const result = await getSubscriptionPlan(
    { publicId: parsedParams.subscription_plan_id, tenantId },
    locale
  );

  if (!result.ok) {
    if (result.notFound) {
      // Missing, or another tenant's plan — never told apart. Renders
      // `(protected)/not-found.tsx` inside the console chrome.
      notFound();
    }
    await redirectToLoginIfSessionRejected(result);

    return (
      <SectionError.Root>
        <SectionError.Heading>
          <SectionError.Title>
            <Message message="admin.subscription_plans.detail_error" />
          </SectionError.Title>
          <SectionError.Description>{result.message}</SectionError.Description>
        </SectionError.Heading>
        <SectionError.Actions>
          <LinkButton
            render={<Link href="/subscription-plans" />}
            variant="outline"
          >
            <Message message="admin.subscription_plans.back_to_list" />
          </LinkButton>
        </SectionError.Actions>
      </SectionError.Root>
    );
  }

  const { plan } = result;

  return (
    <div className="grid gap-6">
      <dl className="grid gap-4 border-y border-border py-4 text-sm sm:grid-cols-3">
        <div className="grid gap-1">
          <dt className="text-muted-foreground">
            <Message message="admin.subscription_plans.columns.price" />
          </dt>
          <dd className="tabular-nums">
            <SubscriptionPlanBilling locale={locale} plan={plan} />
          </dd>
        </div>
        <div className="grid gap-1">
          <dt className="text-muted-foreground">
            <Message message="admin.subscription_plans.columns.status" />
          </dt>
          <dd>
            <SubscriptionPlanStatusChip published={plan.published} />
          </dd>
        </div>
        <div className="grid gap-1">
          <dt className="text-muted-foreground">
            <Message message="admin.subscription_plans.columns.subscribers" />
          </dt>
          <dd className="tabular-nums">{plan.subscriberCount}</dd>
        </div>
      </dl>
      <Suspense fallback={<SubscriptionPlanFormSkeleton />}>
        <SubscriptionPlanFormData
          action={updateSubscriptionPlanAction}
          initialPlan={plan}
        />
      </Suspense>
    </div>
  );
};

const EditSubscriptionPlanPage = ({
  params,
}: EditSubscriptionPlanPageProps) => (
  <ConsolePage.Root>
    <Suspense fallback={<TenantRoleRouteSkeleton />}>
      <TenantAdminRoute>
        <ConsolePage.Header>
          <ConsolePage.Heading>
            <ConsolePage.Title>
              <Suspense fallback={<SkeletonLine className="h-7 w-48" />}>
                <Message message="admin.subscription_plans.edit_title" />
              </Suspense>
            </ConsolePage.Title>
            <ConsolePage.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-96" />}>
                <Message message="admin.subscription_plans.edit_description" />
              </Suspense>
            </ConsolePage.Description>
          </ConsolePage.Heading>
          <ConsolePage.Actions>
            <LinkButton
              render={<Link href="/subscription-plans" />}
              variant="outline"
            >
              <Suspense fallback={<SkeletonLine className="h-5 w-24" />}>
                <Message message="admin.subscription_plans.back_to_list" />
              </Suspense>
            </LinkButton>
          </ConsolePage.Actions>
        </ConsolePage.Header>
        <ConsolePage.Content>
          <FlashToast message="admin.subscription_plans.created" />
          <SectionErrorBoundary
            title={
              <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                <Message message="admin.subscription_plans.detail_error" />
              </Suspense>
            }
          >
            <Suspense fallback={<SubscriptionPlanFormSkeleton />}>
              <EditSubscriptionPlanContent params={params} />
            </Suspense>
          </SectionErrorBoundary>
        </ConsolePage.Content>
      </TenantAdminRoute>
    </Suspense>
  </ConsolePage.Root>
);

export default EditSubscriptionPlanPage;
