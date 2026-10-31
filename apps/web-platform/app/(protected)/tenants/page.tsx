import type { Locale } from "@publira/i18n";
import * as ConsolePage from "@publira/layouts/admin/console-page";
import { Badge } from "@publira/ui-components/badge";
import { Button, LinkButton } from "@publira/ui-components/button";
import { Input } from "@publira/ui-components/input";
import * as SectionError from "@publira/ui-components/section-error";
import { Select } from "@publira/ui-components/select";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import * as Table from "@publira/ui-components/table";
import { formatDateTime } from "@publira/utils";
import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";

import { Message } from "#components/message";
import { PaginationControls } from "#components/pagination-controls";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { getPlatformLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getPlatformDisplayTimeZone } from "#lib/platform-settings";
import { getTenantStatusLabel, getTenantStatusTone } from "#lib/tenant-labels";
import { listPlatformTenants } from "#lib/tenants";

import { buildTenantsPath, parseTenantFilters } from "./_lib/search-params";

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getPlatformLocale();
  const t = await getMessagesFor(locale);

  return { title: t("platform.tenants.title") };
};

/**
 * One tenant's status, as its own async component: the label is a string the
 * catalog resolves, and a row rendered inside `.map()` cannot await.
 */
const TenantStatusCell = async ({
  locale,
  status,
}: {
  locale: Locale;
  status: string;
}) => await getTenantStatusLabel(status, locale);

/** The statuses the `tenants.status` check constraint allows. */
const statusFilterValues = ["active", "suspended"] as const;
const allowedStatusValues = new Set<string>(statusFilterValues);
const pageSize = 20;

const TenantsTableSkeleton = () => (
  <div className="grid gap-4">
    <div className="flex gap-3">
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-10 w-44" />
      <Skeleton className="h-10 w-24" />
    </div>
    <Table.Skeleton />
  </div>
);

type TenantsPageProps = PageProps<"/tenants">;

const TenantsContent = async ({
  searchParams,
}: Pick<TenantsPageProps, "searchParams">) => {
  const locale = await getPlatformLocale();
  const filters = parseTenantFilters(await searchParams, allowedStatusValues);

  const [t, result, timeZone] = await Promise.all([
    getMessagesFor(locale),
    listPlatformTenants({
      limit: pageSize,
      name: filters.name || undefined,
      status: filters.status || undefined,
      token: filters.token || undefined,
    }),
    getPlatformDisplayTimeZone(),
  ]);

  const previousHref = result.previousToken
    ? buildTenantsPath({
        ...filters,
        token: result.previousToken,
      })
    : undefined;

  const nextHref = result.nextToken
    ? buildTenantsPath({
        ...filters,
        token: result.nextToken,
      })
    : undefined;

  const statusSelectItems = await Promise.all(
    statusFilterValues.map(async (value) => ({
      label: await getTenantStatusLabel(value, locale),
      value,
    }))
  );

  return (
    <div className="grid gap-4">
      <Form
        action="/tenants"
        className="flex flex-wrap gap-3"
        key={`${filters.name}::${filters.status}`}
      >
        <Input
          className="w-64"
          defaultValue={filters.name}
          name="name"
          placeholder={t("platform.tenants.search_placeholder")}
          type="search"
        />
        <Select
          className="w-44"
          defaultValue={filters.status || undefined}
          items={statusSelectItems}
          name="status"
          placeholder={t("platform.tenants.all_statuses")}
        />
        <Button type="submit">
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <Message message="platform.common.filter" />
          </Suspense>
        </Button>
        {filters.name || filters.status ? (
          <Link
            className="flex h-10 items-center rounded-control px-3 py-2 text-sm text-muted-foreground underline-offset-4 hover:underline"
            href="/tenants"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="platform.common.clear" />
            </Suspense>
          </Link>
        ) : null}
      </Form>

      {result.ok ? null : (
        <SectionError.Root>
          <SectionError.Heading>
            <SectionError.Title>
              <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                <Message message="platform.tenants.load_failed" />
              </Suspense>
            </SectionError.Title>
            <SectionError.Description>
              {result.message}
            </SectionError.Description>
          </SectionError.Heading>
        </SectionError.Root>
      )}

      <Table.Root>
        <Table.Header>
          <Table.Row>
            <Table.Head>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="platform.tenants.columns_tenant" />
              </Suspense>
            </Table.Head>
            <Table.Head className="w-40">
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="platform.tenants.columns_status" />
              </Suspense>
            </Table.Head>
            <Table.Head className="w-52">
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="platform.tenants.columns_created" />
              </Suspense>
            </Table.Head>
            <Table.Head className="w-40" />
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {result.ok && result.tenants.length === 0 ? (
            <Table.Row>
              <Table.Cell className="text-muted-foreground" colSpan={4}>
                {filters.name || filters.status
                  ? t("platform.tenants.empty_filtered")
                  : t("platform.tenants.empty")}
              </Table.Cell>
            </Table.Row>
          ) : null}
          {result.ok &&
            result.tenants.map((tenant) => (
              <Table.Row key={tenant.publicId}>
                <Table.Cell className="font-medium">{tenant.name}</Table.Cell>
                <Table.Cell>
                  <Badge
                    tone={getTenantStatusTone(tenant.status)}
                    variant="outline"
                  >
                    <TenantStatusCell locale={locale} status={tenant.status} />
                  </Badge>
                </Table.Cell>
                <Table.Cell>
                  {formatDateTime(tenant.createdAt, {
                    fallback: t("platform.common.unset"),
                    locale,
                    timeZone,
                  })}
                </Table.Cell>
                <Table.Cell>
                  <LinkButton
                    render={<Link href={`/tenants/${tenant.publicId}`} />}
                    size="sm"
                    variant="outline"
                  >
                    <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                      <Message message="platform.common.detail" />
                    </Suspense>
                  </LinkButton>
                </Table.Cell>
              </Table.Row>
            ))}
        </Table.Body>
      </Table.Root>

      <PaginationControls
        aria-label={t("platform.tenants.pagination_aria")}
        nextHref={nextHref}
        previousHref={previousHref}
      />
    </div>
  );
};

const TenantsPage = ({ searchParams }: TenantsPageProps) => (
  <ConsolePage.Root>
    <ConsolePage.Header>
      <ConsolePage.Heading>
        <ConsolePage.Title>
          <Suspense fallback={<SkeletonLine className="h-8 w-40" />}>
            <Message message="platform.tenants.heading" />
          </Suspense>
        </ConsolePage.Title>
        <ConsolePage.Description>
          <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
            <Message message="platform.tenants.page_description" />
          </Suspense>
        </ConsolePage.Description>
      </ConsolePage.Heading>
      <ConsolePage.Actions>
        <LinkButton render={<Link href="/tenants/new" />}>
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <Message message="platform.tenants.new_tenant" />
          </Suspense>
        </LinkButton>
      </ConsolePage.Actions>
    </ConsolePage.Header>
    <ConsolePage.Content>
      <SectionErrorBoundary
        title={
          <Suspense fallback={<SkeletonLine className="h-4 w-56" />}>
            <Message message="platform.tenants.load_failed" />
          </Suspense>
        }
      >
        <Suspense fallback={<TenantsTableSkeleton />}>
          <TenantsContent searchParams={searchParams} />
        </Suspense>
      </SectionErrorBoundary>
    </ConsolePage.Content>
  </ConsolePage.Root>
);

export default TenantsPage;
