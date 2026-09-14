import type { Locale } from "@publira/i18n";
import { Badge } from "@publira/ui-components/badge";
import { Button, LinkButton } from "@publira/ui-components/button";
import { Input } from "@publira/ui-components/input";
import {
  SectionError,
  SectionErrorDescription,
  SectionErrorHeading,
  SectionErrorTitle,
} from "@publira/ui-components/section-error";
import { Select } from "@publira/ui-components/select";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableSkeleton,
} from "@publira/ui-components/table";
import { formatDateTime } from "@publira/utils";
import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";

import { Message } from "#components/message";
import { PaginationControls } from "#components/pagination-controls";
import {
  PlatformPage,
  PlatformPageActions,
  PlatformPageContent,
  PlatformPageDescription,
  PlatformPageHeader,
  PlatformPageHeading,
  PlatformPageTitle,
} from "#components/platform-page";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
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

const statusFilterValues = ["active", "trial", "suspended"] as const;
const allowedStatusValues = new Set<string>(statusFilterValues);
const pageSize = 20;

const TenantsTableSkeleton = () => (
  <div className="grid gap-4">
    <div className="flex gap-3">
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-10 w-44" />
      <Skeleton className="h-10 w-24" />
    </div>
    <TableSkeleton />
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
      locale,
      name: filters.name || undefined,
      status: filters.status || undefined,
      token: filters.token || undefined,
    }),
    getPlatformDisplayTimeZone(),
  ]);

  await redirectToLoginIfSessionRejected(result);

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
        <SectionError>
          <SectionErrorHeading>
            <SectionErrorTitle>
              <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                <Message message="platform.tenants.load_failed" />
              </Suspense>
            </SectionErrorTitle>
            <SectionErrorDescription>{result.message}</SectionErrorDescription>
          </SectionErrorHeading>
        </SectionError>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="platform.tenants.columns_tenant" />
              </Suspense>
            </TableHead>
            <TableHead className="w-40">
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="platform.tenants.columns_status" />
              </Suspense>
            </TableHead>
            <TableHead className="w-52">
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="platform.tenants.columns_created" />
              </Suspense>
            </TableHead>
            <TableHead className="w-40" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {result.ok && result.tenants.length === 0 ? (
            <TableRow>
              <TableCell className="text-muted-foreground" colSpan={4}>
                {filters.name || filters.status
                  ? t("platform.tenants.empty_filtered")
                  : t("platform.tenants.empty")}
              </TableCell>
            </TableRow>
          ) : null}
          {result.ok &&
            result.tenants.map((tenant) => (
              <TableRow key={tenant.publicId}>
                <TableCell className="font-medium">{tenant.name}</TableCell>
                <TableCell>
                  <Badge
                    tone={getTenantStatusTone(tenant.status)}
                    variant="outline"
                  >
                    <TenantStatusCell locale={locale} status={tenant.status} />
                  </Badge>
                </TableCell>
                <TableCell>
                  {formatDateTime(tenant.createdAt, {
                    fallback: t("platform.common.unset"),
                    locale,
                    timeZone,
                  })}
                </TableCell>
                <TableCell>
                  <LinkButton
                    render={<Link href={`/tenants/${tenant.publicId}`} />}
                    size="sm"
                    variant="outline"
                  >
                    <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                      <Message message="platform.common.detail" />
                    </Suspense>
                  </LinkButton>
                </TableCell>
              </TableRow>
            ))}
        </TableBody>
      </Table>

      <PaginationControls
        ariaLabel={t("platform.tenants.pagination_aria")}
        nextHref={nextHref}
        nextLabel={t("platform.common.next")}
        previousHref={previousHref}
        previousLabel={t("platform.common.previous")}
      />
    </div>
  );
};

const TenantsPage = ({ searchParams }: TenantsPageProps) => (
  <PlatformPage>
    <PlatformPageHeader>
      <PlatformPageHeading>
        <PlatformPageTitle>
          <Suspense fallback={<SkeletonLine className="h-8 w-40" />}>
            <Message message="platform.tenants.heading" />
          </Suspense>
        </PlatformPageTitle>
        <PlatformPageDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
            <Message message="platform.tenants.page_description" />
          </Suspense>
        </PlatformPageDescription>
      </PlatformPageHeading>
      <PlatformPageActions>
        <LinkButton render={<Link href="/tenants/new" />}>
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <Message message="platform.tenants.new_tenant" />
          </Suspense>
        </LinkButton>
      </PlatformPageActions>
    </PlatformPageHeader>
    <PlatformPageContent>
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
    </PlatformPageContent>
  </PlatformPage>
);

export default TenantsPage;
