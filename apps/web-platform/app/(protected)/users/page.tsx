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
import { SectionError } from "@publira/ui-components/section-error";
import { Select } from "@publira/ui-components/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@publira/ui-components/table";
import { endOfDayIsoString, startOfDayIsoString } from "@publira/utils";
import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";

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
import { getPlatformDisplayTimeZone } from "#lib/platform-settings";
import { getEndUserStatusLabel, getEndUserStatusTone } from "#lib/user-labels";
import {
  listPlatformEndUsers,
  listPlatformTenantFilterOptions,
} from "#lib/users";
import type {
  ListPlatformEndUsersResult,
  PlatformEndUserSummary,
  PlatformTenantFilterOption,
} from "#lib/users";

export const metadata: Metadata = {
  title: "ユーザー管理",
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

const statusSelectItems = [
  { label: "有効", value: "active" },
  { label: "停止中", value: "suspended" },
] as const;

const pageSizeItems = [
  { label: "10件", value: "10" },
  { label: "20件", value: "20" },
  { label: "50件", value: "50" },
] as const;

const allowedPageSizes = new Set([10, 20, 50]);

const buildUsersPath = (params: {
  createdFrom?: string;
  createdTo?: string;
  limit: number;
  offset: number;
  status?: string;
  tenantId?: string;
}): string => {
  const search = new URLSearchParams();
  if (params.status) {
    search.set("status", params.status);
  }
  if (params.tenantId) {
    search.set("tenant_id", params.tenantId);
  }
  if (params.createdFrom) {
    search.set("created_from", params.createdFrom);
  }
  if (params.createdTo) {
    search.set("created_to", params.createdTo);
  }
  if (params.limit !== 20) {
    search.set("limit", String(params.limit));
  }
  if (params.offset > 0) {
    search.set("offset", String(params.offset));
  }
  const query = search.toString();
  return query ? `/users?${query}` : "/users";
};

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

interface UsersPageProps {
  searchParams: Promise<{
    created_from?: string;
    created_to?: string;
    limit?: string;
    offset?: string;
    status?: string;
    tenant_id?: string;
  }>;
}

interface UsersFilters {
  createdFromFilter: string;
  createdToFilter: string;
  limit: number;
  offset: number;
  statusFilter: string;
  tenantIdFilter: string;
}

interface PaginationState {
  hasNext: boolean;
  hasPrev: boolean;
  nextOffset: number;
  prevOffset: number;
}

const parseUsersFilters = (
  params: Awaited<UsersPageProps["searchParams"]>
): UsersFilters => {
  const statusFilter = params.status?.trim() ?? "";
  const tenantIdFilter = params.tenant_id?.trim() ?? "";
  const createdFromFilter = params.created_from?.trim() ?? "";
  const createdToFilter = params.created_to?.trim() ?? "";

  const requestedLimit = Math.trunc(Number(params.limit ?? "20"));
  const limit =
    Number.isFinite(requestedLimit) && allowedPageSizes.has(requestedLimit)
      ? requestedLimit
      : 20;

  const requestedOffset = Math.trunc(Number(params.offset ?? "0"));
  const offset =
    Number.isFinite(requestedOffset) && requestedOffset >= 0
      ? requestedOffset
      : 0;

  return {
    createdFromFilter,
    createdToFilter,
    limit,
    offset,
    statusFilter,
    tenantIdFilter,
  };
};

const buildPaginationState = (
  result: ListPlatformEndUsersResult,
  offset: number,
  limit: number
): PaginationState => ({
  hasNext: result.ok && result.users.length === limit,
  hasPrev: offset > 0,
  nextOffset: offset + limit,
  prevOffset: Math.max(0, offset - limit),
});

const buildSummaryText = (
  result: ListPlatformEndUsersResult,
  offset: number,
  usersLength: number
): string => {
  if (result.ok) {
    return `${offset + 1}〜${offset + usersLength}件を表示`;
  }
  return "-";
};

const buildEmptyMessage = (hasFilter: boolean): string =>
  hasFilter
    ? "条件に一致するユーザーが見つかりませんでした。"
    : "ユーザーはまだ登録されていません。";

const UsersFilterForm = ({
  createdFromFilter,
  createdToFilter,
  hasFilter,
  limit,
  statusFilter,
  tenantItems,
  tenantIdFilter,
}: {
  createdFromFilter: string;
  createdToFilter: string;
  hasFilter: boolean;
  limit: number;
  statusFilter: string;
  tenantItems: PlatformTenantFilterOption[];
  tenantIdFilter: string;
}) => (
  <Form
    action="/users"
    className="flex flex-wrap gap-3"
    key={`${statusFilter}::${tenantIdFilter}::${createdFromFilter}::${createdToFilter}::${limit}`}
  >
    <Select
      className="w-44"
      defaultValue={statusFilter || undefined}
      items={statusSelectItems}
      name="status"
      placeholder="すべての状態"
    />
    <Select
      className="w-56"
      defaultValue={tenantIdFilter || undefined}
      items={tenantItems.map((tenant) => ({
        label: tenant.name,
        value: tenant.publicId,
      }))}
      name="tenant_id"
      placeholder="すべてのテナント"
    />
    <Input
      className="w-44"
      defaultValue={createdFromFilter}
      name="created_from"
      type="date"
    />
    <Input
      className="w-44"
      defaultValue={createdToFilter}
      name="created_to"
      type="date"
    />
    <Select
      className="w-32"
      defaultValue={String(limit)}
      items={pageSizeItems}
      name="limit"
      placeholder="20件"
    />
    <Button type="submit">絞り込む</Button>
    {hasFilter ? (
      <Link
        className="flex h-10 items-center rounded-md px-3 py-2 text-sm text-muted-foreground underline-offset-4 hover:underline"
        href="/users"
      >
        クリア
      </Link>
    ) : null}
  </Form>
);

const UsersTableSection = ({
  hasFilter,
  result,
  users,
}: {
  hasFilter: boolean;
  result: ListPlatformEndUsersResult;
  users: PlatformEndUserSummary[];
}) => (
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead>公開ID</TableHead>
        <TableHead>氏名</TableHead>
        <TableHead>テナント</TableHead>
        <TableHead className="w-44">登録日</TableHead>
        <TableHead className="w-32">状態</TableHead>
        <TableHead className="w-28" />
      </TableRow>
    </TableHeader>
    <TableBody>
      {result.ok && users.length === 0 ? (
        <TableRow>
          <TableCell className="text-muted-foreground" colSpan={6}>
            {buildEmptyMessage(hasFilter)}
          </TableCell>
        </TableRow>
      ) : null}
      {result.ok
        ? users.map((user) => (
            <TableRow key={user.publicId}>
              <TableCell className="font-mono text-xs">
                {user.publicId}
              </TableCell>
              <TableCell>{user.name || "未設定"}</TableCell>
              <TableCell>
                {user.primaryTenantPublicId ? (
                  <Link
                    className="underline-offset-4 hover:underline"
                    href={`/tenants/${user.primaryTenantPublicId}`}
                  >
                    {user.primaryTenantName || user.primaryTenantPublicId}
                  </Link>
                ) : (
                  "未所属"
                )}
              </TableCell>
              <TableCell>{user.createdAt || "未設定"}</TableCell>
              <TableCell>
                <Badge tone={getEndUserStatusTone(user.status)}>
                  {getEndUserStatusLabel(user.status)}
                </Badge>
              </TableCell>
              <TableCell>
                <LinkButton
                  render={<Link href={`/users/${user.publicId}`} />}
                  size="sm"
                  variant="outline"
                >
                  詳細
                </LinkButton>
              </TableCell>
            </TableRow>
          ))
        : null}
    </TableBody>
  </Table>
);

const PaginationControls = ({
  createdFromFilter,
  createdToFilter,
  limit,
  pagination,
  statusFilter,
  tenantIdFilter,
}: {
  createdFromFilter: string;
  createdToFilter: string;
  limit: number;
  pagination: PaginationState;
  statusFilter: string;
  tenantIdFilter: string;
}) => (
  <div className="flex items-center gap-2">
    {pagination.hasPrev ? (
      <LinkButton
        render={
          <Link
            href={buildUsersPath({
              createdFrom: createdFromFilter || undefined,
              createdTo: createdToFilter || undefined,
              limit,
              offset: pagination.prevOffset,
              status: statusFilter || undefined,
              tenantId: tenantIdFilter || undefined,
            })}
          />
        }
        size="sm"
        variant="outline"
      >
        前へ
      </LinkButton>
    ) : (
      <Button disabled size="sm" variant="outline">
        前へ
      </Button>
    )}

    {pagination.hasNext ? (
      <LinkButton
        render={
          <Link
            href={buildUsersPath({
              createdFrom: createdFromFilter || undefined,
              createdTo: createdToFilter || undefined,
              limit,
              offset: pagination.nextOffset,
              status: statusFilter || undefined,
              tenantId: tenantIdFilter || undefined,
            })}
          />
        }
        size="sm"
        variant="outline"
      >
        次へ
      </LinkButton>
    ) : (
      <Button disabled size="sm" variant="outline">
        次へ
      </Button>
    )}
  </div>
);

const UsersContent = async ({
  searchParams,
}: Pick<UsersPageProps, "searchParams">) => {
  const filters = parseUsersFilters(await searchParams);

  // Only the user list needs the zone (its date filters are day boundaries), so
  // the tenant options start alongside the zone read instead of behind it.
  const [tenantItems, timeZone] = await Promise.all([
    listPlatformTenantFilterOptions(),
    getPlatformDisplayTimeZone(),
  ]);

  const result = await listPlatformEndUsers({
    createdAfter: createdRangeStart(filters.createdFromFilter, timeZone),
    createdBefore: createdRangeEnd(filters.createdToFilter, timeZone),
    limit: filters.limit,
    offset: filters.offset,
    status: filters.statusFilter || undefined,
    tenantId: filters.tenantIdFilter || undefined,
  });

  const users = result.ok ? result.users : [];
  const hasFilter = Boolean(
    filters.statusFilter ||
    filters.tenantIdFilter ||
    filters.createdFromFilter ||
    filters.createdToFilter
  );
  const pagination = buildPaginationState(
    result,
    filters.offset,
    filters.limit
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>ユーザー一覧</CardTitle>
        <CardDescription>
          公開ID・氏名・所属テナント・登録日・ステータスを確認し、詳細画面で操作します。
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <UsersFilterForm
          createdFromFilter={filters.createdFromFilter}
          createdToFilter={filters.createdToFilter}
          hasFilter={hasFilter}
          limit={filters.limit}
          statusFilter={filters.statusFilter}
          tenantItems={tenantItems}
          tenantIdFilter={filters.tenantIdFilter}
        />

        {result.ok ? null : (
          <SectionError
            description={result.message}
            title="ユーザー一覧を表示できませんでした"
          />
        )}

        <UsersTableSection
          hasFilter={hasFilter}
          result={result}
          users={users}
        />

        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {buildSummaryText(result, filters.offset, users.length)}
          </p>
          <PaginationControls
            createdFromFilter={filters.createdFromFilter}
            createdToFilter={filters.createdToFilter}
            limit={filters.limit}
            pagination={pagination}
            statusFilter={filters.statusFilter}
            tenantIdFilter={filters.tenantIdFilter}
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
        <PlatformPageTitle>ユーザー管理</PlatformPageTitle>
        <PlatformPageDescription>
          ユーザーの状態確認とアカウント停止・削除を管理します。
        </PlatformPageDescription>
      </PlatformPageHeading>
    </PlatformPageHeader>
    <PlatformPageContent>
      <SectionErrorBoundary title="ユーザー一覧を表示できませんでした">
        <Suspense fallback={<UsersTableSkeleton />}>
          <UsersContent searchParams={searchParams} />
        </Suspense>
      </SectionErrorBoundary>
    </PlatformPageContent>
  </PlatformPage>
);

export default UsersPage;
