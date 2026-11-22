import * as ConsolePage from "@publira/layouts/admin/console-page";
import { LinkButton } from "@publira/ui-components/button";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import * as Table from "@publira/ui-components/table";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { Message } from "#components/message";
import {
  TenantAdminRoute,
  TenantRoleRouteSkeleton,
} from "#components/tenant-role-gate";
import {
  isSignedInTenantAdmin,
  redirectToLoginIfSessionRejected,
} from "#lib/auth-session";
import { getMessages } from "#lib/get-messages";
import { getLocale } from "#lib/locale";
import { listSubscriptionPlans } from "#lib/subscription-plan";
import { getTenantId } from "#lib/tenant-id";

import { SubscriptionPlanList } from "./_components/subscription-plan-list";

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();

  const [t, isAdmin] = await Promise.all([
    getMessages(),
    isSignedInTenantAdmin(tenantId),
  ]);

  return {
    title: isAdmin
      ? t("admin.subscription_plans.title")
      : t("admin.not_found.title"),
  };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

const SubscriptionPlanListData = async () => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);
  const listResult = await listSubscriptionPlans(tenantId, locale);
  await redirectToLoginIfSessionRejected(listResult);

  return (
    <SubscriptionPlanList
      listErrorMessage={listResult.ok ? undefined : listResult.message}
      locale={locale}
      plans={listResult.plans}
      tenantId={tenantId}
    />
  );
};

const SubscriptionPlansPage = () => (
  <ConsolePage.Root>
    <Suspense fallback={<TenantRoleRouteSkeleton />}>
      <TenantAdminRoute>
        <ConsolePage.Header>
          <ConsolePage.Heading>
            <ConsolePage.Title>
              <Suspense fallback={<SkeletonLine className="h-7 w-48" />}>
                <Message message="admin.subscription_plans.title" />
              </Suspense>
            </ConsolePage.Title>
            <ConsolePage.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-96" />}>
                <Message message="admin.subscription_plans.page_description" />
              </Suspense>
            </ConsolePage.Description>
          </ConsolePage.Heading>
          <ConsolePage.Actions>
            <LinkButton
              render={<Link href="/subscription-plans/new" />}
              variant="outline"
            >
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="admin.subscription_plans.new_action" />
              </Suspense>
            </LinkButton>
          </ConsolePage.Actions>
        </ConsolePage.Header>
        <ConsolePage.Content>
          <Suspense fallback={<Table.Skeleton />}>
            <SubscriptionPlanListData />
          </Suspense>
        </ConsolePage.Content>
      </TenantAdminRoute>
    </Suspense>
  </ConsolePage.Root>
);

export default SubscriptionPlansPage;
