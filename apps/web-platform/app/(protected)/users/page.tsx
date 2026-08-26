import { Badge } from "@publira/ui-components/badge";
import { Button, LinkButton } from "@publira/ui-components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@publira/ui-components/card";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { SectionError } from "@publira/ui-components/section-error";
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
import {
  endOfDayIsoString,
  formatDate,
  startOfDayIsoString,
} from "@publira/utils";
import { getMessage } from "@publira/utils/i18n";
import type { Locale } from "@publira/utils/i18n";
import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";

import { Message } from "#components/message";
import { PaginationControls } from "#components/pagination-controls";
import {
  PlatformPage,
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
import type { PlatformMessages } from "#lib/locale";
import { getPlatformDisplayTimeZone } from "#lib/platform-settings";
import type { GetPlatformTenantResult } from "#lib/tenants";
import { getPlatformTenant } from "#lib/tenants";
import { getEndUserStatusLabel, getEndUserStatusTone } from "#lib/user-labels";
import {
  listPlatformEndUsers,
  searchPlatformTenantFilterOptions,
} from "#lib/users";
import type {
  ListPlatformEndUsersResult,
  PlatformEndUserSummary,
  PlatformTenantFilterOption,
  SearchPlatformTenantFilterOptionsResult,
} from "#lib/users";

import { buildUsersPath, parseUsersFilters } from "./_lib/search-params";
import type { UsersFilters } from "./_lib/search-params";
import { resolveTenantFilter, resolvedTenantId } from "./_lib/tenant-filter";
import type { TenantFilterResolution } from "./_lib/tenant-filter";

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getPlatformLocale();
  const messages = await loadPlatformMessages(locale);

  return { title: getMessage(messages, "platform.users.title") };
};

const UsersTableSkeleton = () => (
  <Card>
    <CardHeader>
      <div className="h-5 w-32 animate-pulse rounded bg-muted" />
      <div className="h-4 w-80 animate-pulse rounded bg-muted/70" />
    </CardHeader>
    <CardContent className="grid gap-4">
      <div className="flex flex-wrap gap-3">
        <div className="h-10 w-44 animate-pulse rounded bg-muted/70" />
        <div className="h-10 w-56 animate-pulse rounded bg-muted/70" />
        <div className="h-10 w-44 animate-pulse rounded bg-muted/70" />
        <div className="h-10 w-44 animate-pulse rounded bg-muted/70" />
      </div>
      <div className="grid gap-3">
        <div className="h-10 animate-pulse rounded bg-muted/70" />
        <div className="h-10 animate-pulse rounded bg-muted/70" />
        <div className="h-10 animate-pulse rounded bg-muted/70" />
      </div>
    </CardContent>
  </Card>
);

/**
 * The created_from / created_to filters are date-only (`YYYY-MM-DD`), so the
 * calendar day has to be pinned to a zone before it can become an RFC3339
 * instant. The zone is the platform default (#850), the same one the console
 * formats its timestamps with, so a filtered day matches what the screens show
 * regardless of the browser's zone. Tenant zones are a separate concern
 * (#566 / #567).
 */
const createdRangeStart = (
  date: string,
  timeZone: string
): string | undefined => startOfDayIsoString(date, timeZone) || undefined;

const createdRangeEnd = (date: string, timeZone: string): string | undefined =>
  endOfDayIsoString(date, timeZone) || undefined;

type UsersPageProps = PageProps<"/users">;

interface TenantFilterMessage {
  text: string;
  variant: "destructive" | "info";
}

const emptyTenantSearch = {
  hasMore: false,
  ok: true,
  tenants: [],
} as const satisfies SearchPlatformTenantFilterOptionsResult;

/** No tenant filter is selected, so there is no tenant to read. */
const emptySelectedTenant = {
  ok: true,
  tenant: null,
} as const satisfies GetPlatformTenantResult;

const emptyUsersListResult = {
  nextToken: "",
  ok: true as const,
  previousToken: "",
  users: [],
} satisfies ListPlatformEndUsersResult;

const buildUsersPageHrefs = (
  filters: UsersFilters,
  result: ListPlatformEndUsersResult,
  skip: boolean
): { nextHref?: string; previousHref?: string } => {
  if (skip) {
    return {};
  }
  return {
    nextHref: result.nextToken
      ? buildUsersPath({ ...filters, token: result.nextToken })
      : undefined,
    previousHref: result.previousToken
      ? buildUsersPath({ ...filters, token: result.previousToken })
      : undefined,
  };
};

const buildSummaryText = (
  result: ListPlatformEndUsersResult,
  usersLength: number,
  messages: PlatformMessages
): string => {
  if (result.ok) {
    return getMessage(messages, "platform.users.showing", {
      count: String(usersLength),
    });
  }
  return "-";
};

const buildEmptyMessage = (
  hasFilter: boolean,
  messages: PlatformMessages
): string =>
  getMessage(
    messages,
    hasFilter ? "platform.users.empty_filtered" : "platform.users.empty"
  );

const buildTenantFilterItems = ({
  selectedName,
  tenantId,
  tenantQuery,
  tenantSearch,
}: {
  selectedName: string;
  tenantId: string;
  tenantQuery: string;
  tenantSearch: SearchPlatformTenantFilterOptionsResult;
}): PlatformTenantFilterOption[] => {
  if (tenantQuery && tenantSearch.ok) {
    return tenantSearch.tenants;
  }
  if (tenantId) {
    return [
      {
        name: selectedName || tenantId,
        publicId: tenantId,
      },
    ];
  }
  return [];
};

const buildTenantFilterMessages = ({
  messages,
  resolution,
  tenantQuery,
  tenantSearch,
}: {
  messages: PlatformMessages;
  resolution: TenantFilterResolution;
  tenantQuery: string;
  tenantSearch: SearchPlatformTenantFilterOptionsResult;
}): TenantFilterMessage[] => {
  if (!tenantQuery) {
    return [];
  }
  if (!tenantSearch.ok) {
    return [{ text: tenantSearch.message, variant: "destructive" }];
  }

  const filterMessages: TenantFilterMessage[] = [];
  if (resolution.kind === "none") {
    filterMessages.push({
      text: getMessage(messages, "platform.users.tenant_none"),
      variant: "info",
    });
  } else if (resolution.kind === "ambiguous") {
    filterMessages.push({
      text: getMessage(messages, "platform.users.tenant_ambiguous"),
      variant: "info",
    });
  }
  if (tenantSearch.hasMore) {
    filterMessages.push({
      text: getMessage(messages, "platform.users.tenant_more"),
      variant: "info",
    });
  }
  return filterMessages;
};

const shouldListUsers = (resolution: TenantFilterResolution): boolean =>
  resolution.kind === "resolved" || resolution.kind === "unselected";

const UsersFilterForm = async ({
  filters,
  hasFilter,
  tenantItems,
  tenantId,
  tenantMessages,
}: {
  filters: UsersFilters;
  hasFilter: boolean;
  tenantItems: PlatformTenantFilterOption[];
  tenantId: string;
  tenantMessages: TenantFilterMessage[];
}) => {
  const messages = await loadPlatformMessages(await getPlatformLocale());

  return (
    <div className="grid gap-3">
      <Form
        action="/users"
        className="flex flex-wrap gap-3"
        key={`${filters.status}::${tenantId}::${filters.tenantQuery}::${filters.createdFrom}::${filters.createdTo}::${filters.limit}`}
      >
        <Select
          className="w-44"
          defaultValue={filters.status || undefined}
          items={[
            {
              label: getMessage(
                messages,
                "platform.common.account_status.active"
              ),
              value: "active",
            },
            {
              label: getMessage(
                messages,
                "platform.common.account_status.suspended"
              ),
              value: "suspended",
            },
          ]}
          name="status"
          placeholder={getMessage(messages, "platform.users.all_statuses")}
        />
        <Input
          aria-label={getMessage(messages, "platform.users.search_tenant")}
          className="w-56"
          defaultValue={filters.tenantQuery}
          name="tenant_q"
          placeholder={getMessage(
            messages,
            "platform.users.search_tenant_placeholder"
          )}
          type="search"
        />
        {tenantItems.length > 0 ? (
          <Select
            className="w-56"
            defaultValue={tenantId || undefined}
            items={tenantItems.map((tenant) => ({
              label: tenant.name,
              value: tenant.publicId,
            }))}
            name="tenant_id"
            placeholder={getMessage(messages, "platform.users.select_tenant")}
          />
        ) : null}
        <Input
          className="w-44"
          defaultValue={filters.createdFrom}
          name="created_from"
          type="date"
        />
        <Input
          className="w-44"
          defaultValue={filters.createdTo}
          name="created_to"
          type="date"
        />
        <Select
          className="w-32"
          defaultValue={String(filters.limit)}
          items={[
            {
              label: getMessage(messages, "platform.users.page_size_10"),
              value: "10",
            },
            {
              label: getMessage(messages, "platform.users.page_size_20"),
              value: "20",
            },
            {
              label: getMessage(messages, "platform.users.page_size_50"),
              value: "50",
            },
          ]}
          name="limit"
          placeholder={getMessage(messages, "platform.users.page_size_20")}
        />
        <Button type="submit">
          {getMessage(messages, "platform.common.filter")}
        </Button>
        {hasFilter ? (
          <Link
            className="flex h-10 items-center rounded-md px-3 py-2 text-sm text-muted-foreground underline-offset-4 hover:underline"
            href="/users"
          >
            {getMessage(messages, "platform.common.clear")}
          </Link>
        ) : null}
      </Form>
      {tenantMessages.map((message) => (
        <FormMessage key={message.text} variant={message.variant}>
          {message.text}
        </FormMessage>
      ))}
    </div>
  );
};

const UsersTableSection = async ({
  hasFilter,
  hideEmptyMessage = false,
  locale,
  result,
  timeZone,
  users,
}: {
  hasFilter: boolean;
  hideEmptyMessage?: boolean;
  locale: Locale;
  result: ListPlatformEndUsersResult;
  timeZone: string;
  users: PlatformEndUserSummary[];
}) => {
  const messages = await loadPlatformMessages(await getPlatformLocale());

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>
            {getMessage(messages, "platform.users.columns_public_id")}
          </TableHead>
          <TableHead>
            {getMessage(messages, "platform.users.columns_name")}
          </TableHead>
          <TableHead>
            {getMessage(messages, "platform.users.columns_tenant")}
          </TableHead>
          <TableHead className="w-44">
            {getMessage(messages, "platform.users.columns_created")}
          </TableHead>
          <TableHead className="w-32">
            {getMessage(messages, "platform.users.columns_status")}
          </TableHead>
          <TableHead className="w-28" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {result.ok && users.length === 0 && !hideEmptyMessage ? (
          <TableRow>
            <TableCell className="text-muted-foreground" colSpan={6}>
              {buildEmptyMessage(hasFilter, messages)}
            </TableCell>
          </TableRow>
        ) : null}
        {result.ok
          ? users.map((user) => (
              <TableRow key={user.publicId}>
                <TableCell className="font-mono text-xs">
                  {user.publicId}
                </TableCell>
                <TableCell>
                  {user.name || getMessage(messages, "platform.common.unset")}
                </TableCell>
                <TableCell>
                  {user.primaryTenantPublicId ? (
                    <Link
                      className="underline-offset-4 hover:underline"
                      href={`/tenants/${user.primaryTenantPublicId}`}
                    >
                      {user.primaryTenantName || user.primaryTenantPublicId}
                    </Link>
                  ) : (
                    getMessage(messages, "platform.users.no_tenant")
                  )}
                </TableCell>
                <TableCell>
                  {formatDate(user.createdAt, {
                    fallback: getMessage(messages, "platform.common.unset"),
                    locale,
                    timeZone,
                  })}
                </TableCell>
                <TableCell>
                  <Badge tone={getEndUserStatusTone(user.status)}>
                    {getEndUserStatusLabel(user.status, messages)}
                  </Badge>
                </TableCell>
                <TableCell>
                  <LinkButton
                    render={<Link href={`/users/${user.publicId}`} />}
                    size="sm"
                    variant="outline"
                  >
                    {getMessage(messages, "platform.common.detail")}
                  </LinkButton>
                </TableCell>
              </TableRow>
            ))
          : null}
      </TableBody>
    </Table>
  );
};

const UsersContent = async ({
  searchParams,
}: Pick<UsersPageProps, "searchParams">) => {
  const [rawSearchParams, locale] = await Promise.all([
    searchParams,
    getPlatformLocale(),
  ]);
  const filters = parseUsersFilters(rawSearchParams);
  const [messages, tenantSearch, selectedTenantResult, timeZone] =
    await Promise.all([
      loadPlatformMessages(locale),
      filters.tenantQuery
        ? searchPlatformTenantFilterOptions(filters.tenantQuery, locale)
        : Promise.resolve(emptyTenantSearch),
      filters.tenantId
        ? getPlatformTenant(filters.tenantId, locale)
        : Promise.resolve(emptySelectedTenant),
      getPlatformDisplayTimeZone(),
    ]);

  const selectedTenant = selectedTenantResult.ok
    ? selectedTenantResult.tenant
    : null;
  const tenantItems = buildTenantFilterItems({
    selectedName: selectedTenant?.name.trim() ?? "",
    tenantId: filters.tenantId,
    tenantQuery: filters.tenantQuery,
    tenantSearch,
  });
  const resolution = resolveTenantFilter({
    matches: tenantItems,
    searchOk: tenantSearch.ok,
    tenantId: filters.tenantId,
    tenantQuery: filters.tenantQuery,
  });
  const tenantId = resolvedTenantId(resolution);
  const pendingTenantPick = !shouldListUsers(resolution);
  const listFilters = {
    ...filters,
    tenantId,
  };
  const tenantMessages = buildTenantFilterMessages({
    messages,
    resolution,
    tenantQuery: filters.tenantQuery,
    tenantSearch,
  });

  const result = pendingTenantPick
    ? emptyUsersListResult
    : await listPlatformEndUsers({
        createdAfter: createdRangeStart(filters.createdFrom, timeZone),
        createdBefore: createdRangeEnd(filters.createdTo, timeZone),
        limit: filters.limit,
        locale,
        status: filters.status || undefined,
        tenantId: tenantId || undefined,
        token: filters.token || undefined,
      });

  await redirectToLoginIfSessionRejected(
    tenantSearch,
    selectedTenantResult,
    result
  );

  const users = result.ok ? result.users : [];
  const hasFilter = Boolean(
    filters.status ||
    tenantId ||
    filters.tenantQuery ||
    filters.createdFrom ||
    filters.createdTo
  );
  const { nextHref, previousHref } = buildUsersPageHrefs(
    listFilters,
    result,
    pendingTenantPick
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {getMessage(messages, "platform.users.list_card_title")}
        </CardTitle>
        <CardDescription>
          {getMessage(messages, "platform.users.list_card_description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <UsersFilterForm
          filters={filters}
          hasFilter={hasFilter}
          tenantId={tenantId}
          tenantItems={tenantItems}
          tenantMessages={tenantMessages}
        />

        {result.ok ? null : (
          <SectionError
            description={result.message}
            title={getMessage(messages, "platform.users.load_failed")}
          />
        )}

        <UsersTableSection
          hasFilter={hasFilter}
          hideEmptyMessage={pendingTenantPick}
          locale={locale}
          result={result}
          timeZone={timeZone}
          users={users}
        />

        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {pendingTenantPick
              ? "-"
              : buildSummaryText(result, users.length, messages)}
          </p>
          <PaginationControls
            ariaLabel={getMessage(messages, "platform.users.pagination_aria")}
            nextHref={nextHref}
            nextLabel={getMessage(messages, "platform.common.next")}
            previousHref={previousHref}
            previousLabel={getMessage(messages, "platform.common.previous")}
          />
        </div>
      </CardContent>
    </Card>
  );
};

const UsersPage = ({ searchParams }: UsersPageProps) => (
  <PlatformPage>
    <PlatformPageHeader>
      <PlatformPageHeading>
        <PlatformPageEyebrow>Platform Users</PlatformPageEyebrow>
        <PlatformPageTitle>
          <Suspense fallback={<SkeletonLine className="h-8 w-36" />}>
            <Message message="platform.users.title" />
          </Suspense>
        </PlatformPageTitle>
        <PlatformPageDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
            <Message message="platform.users.page_description" />
          </Suspense>
        </PlatformPageDescription>
      </PlatformPageHeading>
    </PlatformPageHeader>
    <PlatformPageContent>
      <SectionErrorBoundary
        title={
          <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
            <Message message="platform.users.load_failed" />
          </Suspense>
        }
      >
        <Suspense fallback={<UsersTableSkeleton />}>
          <UsersContent searchParams={searchParams} />
        </Suspense>
      </SectionErrorBoundary>
    </PlatformPageContent>
  </PlatformPage>
);

export default UsersPage;
