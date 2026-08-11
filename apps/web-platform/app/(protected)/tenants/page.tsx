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
import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";

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
import { getTenantStatusLabel, getTenantStatusTone } from "#lib/tenant-labels";
import { listPlatformTenants } from "#lib/tenants";

import { buildTenantsPath, parseTenantFilters } from "./_lib/search-params";

export const metadata: Metadata = {
  title: "テナント一覧",
};

const statusSelectItems = [
  { label: "稼働中", value: "active" },
  { label: "トライアル", value: "trial" },
  { label: "停止中", value: "suspended" },
] as const;

const allowedStatusValues = new Set(
  statusSelectItems.map(({ value }) => value)
);
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
  const filters = parseTenantFilters(await searchParams, allowedStatusValues);

  const result = await listPlatformTenants({
    limit: pageSize,
    name: filters.name || undefined,
    status: filters.status || undefined,
    token: filters.token || undefined,
  });

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

  return (
    <Card>
      <CardHeader>
        <CardTitle>登録テナント</CardTitle>
        <CardDescription>
          web-admin
          と責務分離するため、ここではテナント単位の状態管理に限定します。
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
            placeholder="テナント名・IDで検索"
            type="search"
          />
          <Select
            className="w-44"
            defaultValue={filters.status || undefined}
            items={statusSelectItems}
            name="status"
            placeholder="すべての状態"
          />
          <Button type="submit">絞り込む</Button>
          {filters.name || filters.status ? (
            <Link
              className="flex h-10 items-center rounded-md px-3 py-2 text-sm text-muted-foreground underline-offset-4 hover:underline"
              href="/tenants"
            >
              クリア
            </Link>
          ) : null}
        </Form>

        {result.ok ? null : (
          <SectionError
            description={result.message}
            title="テナント一覧を表示できませんでした"
          />
        )}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>テナント</TableHead>
              <TableHead className="w-40">状態</TableHead>
              <TableHead className="w-52">作成日時</TableHead>
              <TableHead className="w-40" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.ok && result.tenants.length === 0 ? (
              <TableRow>
                <TableCell className="text-muted-foreground" colSpan={4}>
                  {filters.name || filters.status
                    ? "条件に一致するテナントが見つかりませんでした。"
                    : "テナントはまだ登録されていません。"}
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
                      {getTenantStatusLabel(tenant.status)}
                    </Badge>
                  </TableCell>
                  <TableCell>{tenant.createdAt}</TableCell>
                  <TableCell>
                    <LinkButton
                      render={<Link href={`/tenants/${tenant.publicId}`} />}
                      size="sm"
                      variant="outline"
                    >
                      詳細
                    </LinkButton>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>

        <PaginationControls
          ariaLabel="テナント一覧のページ送り"
          nextHref={nextHref}
          previousHref={previousHref}
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
        <PlatformPageTitle>テナント一覧</PlatformPageTitle>
        <PlatformPageDescription>
          プラットフォーム運営者が横断でテナントの状態を確認し、詳細画面へ遷移するための起点です。
        </PlatformPageDescription>
      </PlatformPageHeading>
      <PlatformPageActions>
        <LinkButton render={<Link href="/tenants/new" />}>
          新規テナント作成
        </LinkButton>
      </PlatformPageActions>
    </PlatformPageHeader>
    <PlatformPageContent>
      <SectionErrorBoundary title="テナント一覧を表示できませんでした">
        <Suspense fallback={<TenantsTableSkeleton />}>
          <TenantsContent searchParams={searchParams} />
        </Suspense>
      </SectionErrorBoundary>
    </PlatformPageContent>
  </PlatformPage>
);

export default TenantsPage;
