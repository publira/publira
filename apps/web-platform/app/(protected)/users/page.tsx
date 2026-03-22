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
import { Select } from "@publira/ui-components/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@publira/ui-components/table";
import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";

import { PlatformPage } from "../../../components/platform-page";
import {
  getEndUserStatusLabel,
  getEndUserStatusTone,
} from "../../../lib/user-labels";
import { listPlatformEndUsers } from "../../../lib/users";
import type {
  ListPlatformEndUsersResult,
  PlatformEndUserSummary,
} from "../../../lib/users";

export const metadata: Metadata = {
  title: "ユーザー管理",
};

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
}): string => {
  const search = new URLSearchParams();
  if (params.status) {
    search.set("status", params.status);
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

const endOfDayRfc3339 = (date: string): string | undefined => {
  if (!date) {
    return undefined;
  }
  const value = new Date(`${date}T23:59:59.999Z`);
  if (Number.isNaN(value.getTime())) {
    return undefined;
  }
  return value.toISOString();
};

interface UsersPageProps {
  searchParams: Promise<{
    created_from?: string;
    created_to?: string;
    limit?: string;
    offset?: string;
    status?: string;
  }>;
}

interface UsersFilters {
  createdFromFilter: string;
  createdToFilter: string;
  limit: number;
  offset: number;
  statusFilter: string;
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
  const createdFromFilter = params.created_from?.trim() ?? "";
  const createdToFilter = params.created_to?.trim() ?? "";

  const requestedLimit = Number.parseInt(params.limit ?? "20", 10);
  const limit =
    Number.isFinite(requestedLimit) && allowedPageSizes.has(requestedLimit)
      ? requestedLimit
      : 20;

  const requestedOffset = Number.parseInt(params.offset ?? "0", 10);
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
}: {
  createdFromFilter: string;
  createdToFilter: string;
  hasFilter: boolean;
  limit: number;
  statusFilter: string;
}) => (
  <Form
    action="/users"
    className="flex flex-wrap gap-3"
    key={`${statusFilter}::${createdFromFilter}::${createdToFilter}::${limit}`}
  >
    <Select
      className="w-44"
      defaultValue={statusFilter || undefined}
      items={statusSelectItems}
      name="status"
      placeholder="すべての状態"
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
        <TableHead>メール</TableHead>
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
            <TableRow key={user.publicId || user.email}>
              <TableCell className="font-mono text-xs">
                {user.publicId}
              </TableCell>
              <TableCell>{user.name || "未設定"}</TableCell>
              <TableCell>{user.email}</TableCell>
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
}: {
  createdFromFilter: string;
  createdToFilter: string;
  limit: number;
  pagination: PaginationState;
  statusFilter: string;
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

export default async function UsersPage({ searchParams }: UsersPageProps) {
  const params = await searchParams;
  const filters = parseUsersFilters(params);

  const result = await listPlatformEndUsers({
    createdAfter: filters.createdFromFilter || undefined,
    createdBefore: endOfDayRfc3339(filters.createdToFilter),
    limit: filters.limit,
    offset: filters.offset,
    status: filters.statusFilter || undefined,
  });

  const users = result.ok ? result.users : [];
  const hasFilter = Boolean(
    filters.statusFilter || filters.createdFromFilter || filters.createdToFilter
  );
  const pagination = buildPaginationState(
    result,
    filters.offset,
    filters.limit
  );

  return (
    <PlatformPage
      description="ユーザーの状態確認とアカウント停止・削除を管理します。"
      eyebrow="Platform Users"
      title="ユーザー管理"
    >
      <Card>
        <CardHeader>
          <CardTitle>ユーザー一覧</CardTitle>
          <CardDescription>
            公開ID・氏名・メール・登録日・ステータスを確認し、詳細画面で操作します。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <UsersFilterForm
            createdFromFilter={filters.createdFromFilter}
            createdToFilter={filters.createdToFilter}
            hasFilter={hasFilter}
            limit={filters.limit}
            statusFilter={filters.statusFilter}
          />

          {result.ok ? null : (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              ユーザー一覧の取得に失敗しました: {result.message}
            </p>
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
            />
          </div>
        </CardContent>
      </Card>
    </PlatformPage>
  );
}
