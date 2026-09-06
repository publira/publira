import { getMessage } from "@publira/i18n";
import { Badge } from "@publira/ui-components/badge";
import { Button, LinkButton } from "@publira/ui-components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@publira/ui-components/card";
import { Input } from "@publira/ui-components/input";
import {
  SectionError,
  SectionErrorDescription,
  SectionErrorHeading,
  SectionErrorTitle,
} from "@publira/ui-components/section-error";
import { Select } from "@publira/ui-components/select";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
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
  PlatformPageEyebrow,
  PlatformPageHeader,
  PlatformPageHeading,
  PlatformPageTitle,
} from "#components/platform-page";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import { getPlatformLocale, loadPlatformMessages } from "#lib/locale";
import { getPlatformDisplayTimeZone } from "#lib/platform-settings";
import { getTenantStatusLabel, getTenantStatusTone } from "#lib/tenant-labels";
import { listPlatformTenants } from "#lib/tenants";

import { buildTenantsPath, parseTenantFilters } from "./_lib/search-params";

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getPlatformLocale();
  const messages = await loadPlatformMessages(locale);

  return { title: getMessage(messages, "platform.tenants.title") };
};

const statusFilterValues = ["active", "trial", "suspended"] as const;
const allowedStatusValues = new Set<string>(statusFilterValues);
const pageSize = 20;

const TenantsTableSkeleton = () => (
  <Card>
    <CardHeader>
      <div className="h-5 w-32 animate-pulse rounded bg-muted" />
      <div className="h-4 w-72 animate-pulse rounded bg-muted/70" />
    </CardHeader>
    <CardContent className="grid gap-4">
      <div className="flex gap-3">
        <div className="h-10 w-64 animate-pulse rounded bg-muted/70" />
        <div className="h-10 w-44 animate-pulse rounded bg-muted/70" />
        <div className="h-10 w-24 animate-pulse rounded bg-muted/70" />
      </div>
      <div className="grid gap-3">
        <div className="h-10 animate-pulse rounded bg-muted/70" />
        <div className="h-10 animate-pulse rounded bg-muted/70" />
        <div className="h-10 animate-pulse rounded bg-muted/70" />
      </div>
    </CardContent>
  </Card>
);

type TenantsPageProps = PageProps<"/tenants">;

const TenantsContent = async ({
  searchParams,
}: Pick<TenantsPageProps, "searchParams">) => {
  const locale = await getPlatformLocale();
  const filters = parseTenantFilters(await searchParams, allowedStatusValues);

  const [messages, result, timeZone] = await Promise.all([
    loadPlatformMessages(locale),
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

  const statusSelectItems = statusFilterValues.map((value) => ({
    label: getTenantStatusLabel(value, messages),
    value,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {getMessage(messages, "platform.tenants.card_title")}
        </CardTitle>
        <CardDescription>
          {getMessage(messages, "platform.tenants.card_description")}
        </CardDescription>
      </CardHeader>

      <CardContent className="grid gap-4">
        <Form
          action="/tenants"
          className="flex flex-wrap gap-3"
          key={`${filters.name}::${filters.status}`}
        >
          <Input
            className="w-64"
            defaultValue={filters.name}
            name="name"
            placeholder={getMessage(
              messages,
              "platform.tenants.search_placeholder"
            )}
            type="search"
          />
          <Select
            className="w-44"
            defaultValue={filters.status || undefined}
            items={statusSelectItems}
            name="status"
            placeholder={getMessage(messages, "platform.tenants.all_statuses")}
          />
          <Button type="submit">
            {getMessage(messages, "platform.common.filter")}
          </Button>
          {filters.name || filters.status ? (
            <Link
              className="flex h-10 items-center rounded-md px-3 py-2 text-sm text-muted-foreground underline-offset-4 hover:underline"
              href="/tenants"
            >
              {getMessage(messages, "platform.common.clear")}
            </Link>
          ) : null}
        </Form>

        {result.ok ? null : (
          <SectionError>
            <SectionErrorHeading>
              <SectionErrorTitle>
                {getMessage(messages, "platform.tenants.load_failed")}
              </SectionErrorTitle>
              <SectionErrorDescription>
                {result.message}
              </SectionErrorDescription>
            </SectionErrorHeading>
          </SectionError>
        )}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                {getMessage(messages, "platform.tenants.columns_tenant")}
              </TableHead>
              <TableHead className="w-40">
                {getMessage(messages, "platform.tenants.columns_status")}
              </TableHead>
              <TableHead className="w-52">
                {getMessage(messages, "platform.tenants.columns_created")}
              </TableHead>
              <TableHead className="w-40" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.ok && result.tenants.length === 0 ? (
              <TableRow>
                <TableCell className="text-muted-foreground" colSpan={4}>
                  {filters.name || filters.status
                    ? getMessage(messages, "platform.tenants.empty_filtered")
                    : getMessage(messages, "platform.tenants.empty")}
                </TableCell>
              </TableRow>
            ) : null}
            {result.ok &&
              result.tenants.map((tenant) => (
                <TableRow key={tenant.publicId}>
                  <TableCell>
                    <div className="grid gap-1">
                      <p className="font-medium text-foreground">
                        {tenant.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {tenant.publicId}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge tone={getTenantStatusTone(tenant.status)}>
                      {getTenantStatusLabel(tenant.status, messages)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {formatDateTime(tenant.createdAt, {
                      fallback: getMessage(messages, "platform.common.unset"),
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
                      {getMessage(messages, "platform.common.detail")}
                    </LinkButton>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>

        <PaginationControls
          ariaLabel={getMessage(messages, "platform.tenants.pagination_aria")}
          nextHref={nextHref}
          nextLabel={getMessage(messages, "platform.common.next")}
          previousHref={previousHref}
          previousLabel={getMessage(messages, "platform.common.previous")}
        />
      </CardContent>
    </Card>
  );
};

const TenantsPage = ({ searchParams }: TenantsPageProps) => (
  <PlatformPage>
    <PlatformPageHeader>
      <PlatformPageHeading>
        <PlatformPageEyebrow>Platform Tenants</PlatformPageEyebrow>
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
