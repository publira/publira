import * as ConsolePage from "@publira/layouts/admin/console-page";
import * as ConsoleSection from "@publira/layouts/admin/console-section";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import * as Table from "@publira/ui-components/table";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import { Suspense } from "react";

import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import {
  TenantAdminRoute,
  TenantRoleRouteSkeleton,
} from "#components/tenant-role-gate";
import { listApiKeys } from "#lib/api-keys";
import {
  isSignedInTenantAdmin,
  redirectToLoginIfSessionRejected,
} from "#lib/auth-session";
import { DEFAULT_PAGE_SIZE } from "#lib/cursor-page";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getTenantId } from "#lib/tenant-id";
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";
import { listWebhookDeliveries, listWebhookEndpoints } from "#lib/webhooks";

import { ApiKeysSection } from "./_components/api-keys-section";
import { WebhookDeliveriesSection } from "./_components/webhook-deliveries-section";
import { WebhookEndpointsSection } from "./_components/webhook-endpoints-section";
import { deliveryListQuery, parseDeliveryFilters } from "./_lib/search-params";

type ApiKeysAndWebhooksPageProps =
  PageProps<"/[tenant_id]/integrations/api-keys-and-webhooks">;

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();

  const [locale, isAdmin] = await Promise.all([
    getLocale(tenantId),
    isSignedInTenantAdmin(tenantId),
  ]);

  const t = await getMessagesFor(locale);

  return {
    title: isAdmin
      ? t("admin.integrations.api_keys_title")
      : t("admin.not_found.title"),
  };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

const SectionSkeleton = () => (
  <div className="grid gap-4">
    <SkeletonLine className="h-6 w-40" />
    <SkeletonLine className="h-4 w-96" />
    <Skeleton className="h-40 sm:max-w-3xl" />
  </div>
);

const ApiKeysContent = async () => {
  const tenantId = await getTenantId();

  const [locale, timeZone] = await Promise.all([
    getLocale(tenantId),
    getTenantDisplayTimeZone(tenantId),
  ]);

  const result = await listApiKeys(tenantId, locale);
  await redirectToLoginIfSessionRejected(result);

  return (
    <ApiKeysSection
      apiKeys={result.apiKeys}
      loadErrorMessage={result.ok ? undefined : result.message}
      locale={locale}
      tenantId={tenantId}
      timeZone={timeZone}
    />
  );
};

const WebhookEndpointsContent = async () => {
  const tenantId = await getTenantId();

  const [locale, timeZone] = await Promise.all([
    getLocale(tenantId),
    getTenantDisplayTimeZone(tenantId),
  ]);

  const result = await listWebhookEndpoints(tenantId, locale);
  await redirectToLoginIfSessionRejected(result);

  return (
    <WebhookEndpointsSection
      endpoints={result.endpoints}
      loadErrorMessage={result.ok ? undefined : result.message}
      locale={locale}
      tenantId={tenantId}
      timeZone={timeZone}
    />
  );
};

const WebhookDeliveriesContent = async ({
  searchParams,
}: Pick<ApiKeysAndWebhooksPageProps, "searchParams">) => {
  const [sp, tenantId] = await Promise.all([searchParams, getTenantId()]);
  const filters = parseDeliveryFilters(sp);

  const [locale, timeZone] = await Promise.all([
    getLocale(tenantId),
    getTenantDisplayTimeZone(tenantId),
  ]);

  const result = await listWebhookDeliveries(tenantId, locale, {
    status: filters.status || undefined,
    token: filters.token,
  });

  await redirectToLoginIfSessionRejected(result);

  return (
    <WebhookDeliveriesSection
      deliveries={result.deliveries}
      listErrorMessage={result.ok ? undefined : result.message}
      locale={locale}
      nextHref={
        result.nextToken
          ? deliveryListQuery(filters.status, result.nextToken)
          : undefined
      }
      pageSize={DEFAULT_PAGE_SIZE}
      previousHref={
        result.previousToken
          ? deliveryListQuery(filters.status, result.previousToken)
          : undefined
      }
      status={filters.status}
      tenantId={tenantId}
      timeZone={timeZone}
    />
  );
};

const ApiKeysAndWebhooksPage = ({
  searchParams,
}: ApiKeysAndWebhooksPageProps) => (
  <ConsolePage.Root>
    <Suspense fallback={<TenantRoleRouteSkeleton />}>
      <TenantAdminRoute>
        <ConsolePage.Header>
          <ConsolePage.Heading>
            <ConsolePage.Title>
              <Suspense fallback={<SkeletonLine className="h-7 w-48" />}>
                <Message message="admin.integrations.api_keys_title" />
              </Suspense>
            </ConsolePage.Title>
            <ConsolePage.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-96" />}>
                <Message message="admin.integrations.api_keys_description" />
              </Suspense>
            </ConsolePage.Description>
          </ConsolePage.Heading>
        </ConsolePage.Header>
        <ConsolePage.Content>
          <ConsoleSection.Stack>
            <SectionErrorBoundary
              title={
                <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                  <Message message="admin.integrations.api_keys_error" />
                </Suspense>
              }
            >
              <Suspense fallback={<SectionSkeleton />}>
                <ApiKeysContent />
              </Suspense>
            </SectionErrorBoundary>
            <SectionErrorBoundary
              title={
                <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                  <Message message="admin.integrations.webhooks_error" />
                </Suspense>
              }
            >
              <Suspense fallback={<SectionSkeleton />}>
                <WebhookEndpointsContent />
              </Suspense>
            </SectionErrorBoundary>
            <SectionErrorBoundary
              title={
                <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                  <Message message="admin.integrations.deliveries_error" />
                </Suspense>
              }
            >
              <Suspense fallback={<Table.Skeleton />}>
                <WebhookDeliveriesContent searchParams={searchParams} />
              </Suspense>
            </SectionErrorBoundary>
          </ConsoleSection.Stack>
        </ConsolePage.Content>
      </TenantAdminRoute>
    </Suspense>
  </ConsolePage.Root>
);

export default ApiKeysAndWebhooksPage;
