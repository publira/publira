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
import { MAX_LIST_OFFSET } from "#lib/list-pagination";
import { getPlatformDisplayTimeZone } from "#lib/platform-settings";
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

interface PaginationState {
  hasNext: boolean;
  hasPrev: boolean;
  nextOffset: number;
  prevOffset: number;
}

interface TenantFilterMessage {
  text: string;
  variant: "destructive" | "info";
}

const emptyTenantSearch = {
  hasMore: false,
  ok: true,
  tenants: [],
} as const satisfies SearchPlatformTenantFilterOptionsResult;

const buildPaginationState = (
  result: ListPlatformEndUsersResult,
  offset: number,
  limit: number
): PaginationState => {
  const nextOffset = offset + limit;
  return {
    hasNext:
      result.ok &&
      result.users.length === limit &&
      nextOffset <= MAX_LIST_OFFSET,
    hasPrev: offset > 0,
    nextOffset,
    prevOffset: Math.max(0, offset - limit),
  };
};

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
  resolution,
  tenantQuery,
  tenantSearch,
}: {
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

  const messages: TenantFilterMessage[] = [];
  if (resolution.kind === "none") {
    messages.push({
      text: "一致するテナントが見つかりませんでした。",
      variant: "info",
    });
  } else if (resolution.kind === "ambiguous") {
    messages.push({
      text: "候補が複数あります。テナントを選択して絞り込んでください。",
      variant: "info",
    });
  }
  if (tenantSearch.hasMore) {
    messages.push({
      text: "一致するテナントが他にもあります。検索語を絞り込んでください。",
      variant: "info",
    });
  }
  return messages;
};

const shouldListUsers = (resolution: TenantFilterResolution): boolean =>
  resolution.kind === "resolved" || resolution.kind === "unselected";

const UsersFilterForm = ({
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
}) => (
  <div className="grid gap-3">
    <Form
      action="/users"
      className="flex flex-wrap gap-3"
      key={`${filters.status}::${tenantId}::${filters.tenantQuery}::${filters.createdFrom}::${filters.createdTo}::${filters.limit}`}
    >
      <Select
        className="w-44"
        defaultValue={filters.status || undefined}
        items={statusSelectItems}
        name="status"
        placeholder="すべての状態"
      />
      <Input
        aria-label="テナント検索"
        className="w-56"
        defaultValue={filters.tenantQuery}
        name="tenant_q"
        placeholder="テナント名・IDで検索"
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
          placeholder="テナントを選択"
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
    {tenantMessages.map((message) => (
      <FormMessage key={message.text} variant={message.variant}>
        {message.text}
      </FormMessage>
    ))}
  </div>
);

const UsersTableSection = ({
  hasFilter,
  hideEmptyMessage = false,
  result,
  timeZone,
  users,
}: {
  hasFilter: boolean;
  hideEmptyMessage?: boolean;
  result: ListPlatformEndUsersResult;
  timeZone: string;
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
      {result.ok && users.length === 0 && !hideEmptyMessage ? (
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
              <TableCell>
                {formatDate(user.createdAt, { fallback: "未設定", timeZone })}
              </TableCell>
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
  filters,
  pagination,
}: {
  filters: UsersFilters;
  pagination: PaginationState;
}) => (
  <div className="flex items-center gap-2">
    {pagination.hasPrev ? (
      <LinkButton
        render={
          <Link
            href={buildUsersPath({
              ...filters,
              offset: pagination.prevOffset,
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
              ...filters,
              offset: pagination.nextOffset,
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

  const [tenantSearch, selectedTenant, timeZone] = await Promise.all([
    filters.tenantQuery
      ? searchPlatformTenantFilterOptions(filters.tenantQuery)
      : Promise.resolve(emptyTenantSearch),
    filters.tenantId
      ? getPlatformTenant(filters.tenantId)
      : Promise.resolve(null),
    getPlatformDisplayTimeZone(),
  ]);

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
    resolution,
    tenantQuery: filters.tenantQuery,
    tenantSearch,
  });

  const result = pendingTenantPick
    ? { ok: true as const, users: [] }
    : await listPlatformEndUsers({
        createdAfter: createdRangeStart(filters.createdFrom, timeZone),
        createdBefore: createdRangeEnd(filters.createdTo, timeZone),
        limit: filters.limit,
        offset: filters.offset,
        status: filters.status || undefined,
        tenantId: tenantId || undefined,
      });

  const users = result.ok ? result.users : [];
  const hasFilter = Boolean(
    filters.status ||
    tenantId ||
    filters.tenantQuery ||
    filters.createdFrom ||
    filters.createdTo
  );
  const pagination = pendingTenantPick
    ? { hasNext: false, hasPrev: false, nextOffset: 0, prevOffset: 0 }
    : buildPaginationState(result, filters.offset, filters.limit);

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
          filters={filters}
          hasFilter={hasFilter}
          tenantId={tenantId}
          tenantItems={tenantItems}
          tenantMessages={tenantMessages}
        />

        {result.ok ? null : (
          <SectionError
            description={result.message}
            title="ユーザー一覧を表示できませんでした"
          />
        )}

        <UsersTableSection
          hasFilter={hasFilter}
          hideEmptyMessage={pendingTenantPick}
          result={result}
          timeZone={timeZone}
          users={users}
        />

        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {pendingTenantPick
              ? "-"
              : buildSummaryText(result, filters.offset, users.length)}
          </p>
          <PaginationControls filters={listFilters} pagination={pagination} />
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
