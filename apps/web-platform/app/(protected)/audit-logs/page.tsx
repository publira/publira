import { Badge } from "@publira/ui-components/badge";
import { Button } from "@publira/ui-components/button";
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
import { formatDateTime } from "@publira/utils";
import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";

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
import { auditActionOptions, getAuditActionLabel } from "#lib/audit-log-labels";
import { listPlatformAuditLogs } from "#lib/audit-logs";
import type {
  ListPlatformAuditLogsResult,
  PlatformAuditLogSummary,
} from "#lib/audit-logs";
import { getOperatorRoleLabel } from "#lib/operator-labels";
import { getPlatformDisplayTimeZone } from "#lib/platform-settings";
import { getTenantRoleLabel } from "#lib/tenant-labels";

export const metadata: Metadata = {
  title: "監査ログ",
};

interface AuditLogsPageProps {
  searchParams: Promise<{
    action?: string;
    actor_user_public_id?: string;
    offset?: string;
  }>;
}

const pageSize = 20;

const AuditLogsSkeleton = () => (
  <Card>
    <CardHeader>
      <div className="h-5 w-36 animate-pulse rounded bg-muted" />
      <div className="h-4 w-72 animate-pulse rounded bg-muted/70" />
    </CardHeader>
    <CardContent className="grid gap-4">
      <div className="flex gap-3">
        <div className="h-10 w-48 animate-pulse rounded bg-muted/70" />
        <div className="h-10 w-56 animate-pulse rounded bg-muted/70" />
        <div className="h-10 w-24 animate-pulse rounded bg-muted/70" />
      </div>
      <div className="grid gap-3">
        <div className="h-12 animate-pulse rounded bg-muted/70" />
        <div className="h-12 animate-pulse rounded bg-muted/70" />
        <div className="h-12 animate-pulse rounded bg-muted/70" />
        <div className="h-12 animate-pulse rounded bg-muted/70" />
      </div>
    </CardContent>
  </Card>
);

const parseOffset = (value: string | undefined): number => {
  const parsed = Math.trunc(Number(value ?? "0"));
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
};

const buildAuditLogsPath = (params: {
  action?: string;
  actorUserPublicId?: string;
  offset: number;
}): string => {
  const search = new URLSearchParams();
  if (params.actorUserPublicId) {
    search.set("actor_user_public_id", params.actorUserPublicId);
  }
  if (params.action) {
    search.set("action", params.action);
  }
  if (params.offset > 0) {
    search.set("offset", String(params.offset));
  }
  const query = search.toString();
  return query ? `/audit-logs?${query}` : "/audit-logs";
};

const getOutcomeTone = (
  outcome: string
): "destructive" | "info" | "muted" | "success" | "warning" => {
  switch (outcome) {
    case "success": {
      return "success";
    }
    case "failure":
    case "failed": {
      return "destructive";
    }
    case "pending": {
      return "warning";
    }
    case "": {
      return "muted";
    }
    default: {
      return "info";
    }
  }
};

const buildTargetLabel = (targetType: string, targetId: string): string => {
  if (targetType && targetId) {
    return `${targetType}: ${targetId}`;
  }
  return targetId || targetType || "-";
};

const isOperatorTargetType = (targetType: string): boolean =>
  targetType === "operator";

const isUserTargetType = (targetType: string): boolean => targetType === "user";

const isTenantTargetType = (targetType: string): boolean =>
  targetType === "tenant";

const buildEmptyMessage = (hasFilter: boolean): string =>
  hasFilter
    ? "条件に一致する監査ログが見つかりませんでした。"
    : "監査ログはまだ記録されていません。";

const getActorRoleLabel = (role: string): string => {
  if (!role) {
    return "未設定";
  }

  const operatorLabel = getOperatorRoleLabel(role);
  if (operatorLabel !== role) {
    return operatorLabel;
  }

  const tenantLabel = getTenantRoleLabel(role);
  if (tenantLabel !== role) {
    return tenantLabel;
  }

  switch (role) {
    case "platform_owner": {
      return "プラットフォーム管理者";
    }
    default: {
      return role;
    }
  }
};

const getSummaryText = (
  result: ListPlatformAuditLogsResult,
  offset: number
): string => {
  if (!result.ok) {
    return "-";
  }
  if (result.auditLogs.length === 0) {
    return "0件を表示";
  }
  return `${offset + 1}〜${offset + result.auditLogs.length}件を表示`;
};

const AuditLogsFilters = ({
  actionFilter,
  actorFilter,
  hasFilter,
}: {
  actionFilter: string;
  actorFilter: string;
  hasFilter: boolean;
}) => (
  <Form
    action="/audit-logs"
    className="flex flex-wrap gap-3"
    key={`${actorFilter}::${actionFilter}`}
  >
    <Input
      className="w-48"
      defaultValue={actorFilter}
      name="actor_user_public_id"
      placeholder="操作者公開IDで絞り込み"
      type="search"
    />
    <Select
      className="w-56"
      defaultValue={actionFilter || undefined}
      items={auditActionOptions}
      name="action"
      placeholder="すべてのイベント"
    />
    <Button type="submit">絞り込む</Button>
    {hasFilter ? (
      <Link
        className="flex h-10 items-center rounded-md px-3 py-2 text-sm text-muted-foreground underline-offset-4 hover:underline"
        href="/audit-logs"
      >
        クリア
      </Link>
    ) : null}
  </Form>
);

const AuditLogsPagination = ({
  actionFilter,
  actorFilter,
  hasNext,
  hasPrev,
  nextOffset,
  prevOffset,
  summaryText,
}: {
  actionFilter: string;
  actorFilter: string;
  hasNext: boolean;
  hasPrev: boolean;
  nextOffset: number;
  prevOffset: number;
  summaryText: string;
}) => {
  const filterParams = {
    action: actionFilter || undefined,
    actorUserPublicId: actorFilter || undefined,
  };

  return (
    <div className="flex items-center justify-between gap-3">
      <p className="text-xs text-muted-foreground">{summaryText}</p>
      <PaginationControls
        ariaLabel="監査ログ一覧のページ送り"
        nextHref={
          hasNext
            ? buildAuditLogsPath({ ...filterParams, offset: nextOffset })
            : undefined
        }
        previousHref={
          hasPrev
            ? buildAuditLogsPath({ ...filterParams, offset: prevOffset })
            : undefined
        }
      />
    </div>
  );
};

const renderAuditLogTarget = (log: PlatformAuditLogSummary) => {
  if (log.targetPublicId && isOperatorTargetType(log.targetType)) {
    return (
      <Link
        className="text-sm font-medium text-primary underline-offset-4 hover:underline"
        href={`/operators/${log.targetPublicId}`}
      >
        {log.targetName || log.targetPublicId}
      </Link>
    );
  }

  if (log.targetPublicId && isUserTargetType(log.targetType)) {
    return (
      <Link
        className="text-sm font-medium text-primary underline-offset-4 hover:underline"
        href={`/users/${log.targetPublicId}`}
      >
        {log.targetName || log.targetPublicId}
      </Link>
    );
  }

  if (log.tenantId) {
    return (
      <Link
        className="text-sm font-medium text-primary underline-offset-4 hover:underline"
        href={`/tenants/${log.tenantId}`}
      >
        {log.targetName || log.tenantName || log.tenantId}
      </Link>
    );
  }

  if (log.targetPublicId && isTenantTargetType(log.targetType)) {
    return (
      <Link
        className="text-sm font-medium text-primary underline-offset-4 hover:underline"
        href={`/tenants/${log.targetPublicId}`}
      >
        {log.targetName || log.targetPublicId}
      </Link>
    );
  }

  return <p>{buildTargetLabel(log.targetType, log.targetId)}</p>;
};

const AuditLogsTableBody = ({
  hasFilter,
  result,
  timeZone,
}: {
  hasFilter: boolean;
  result: ListPlatformAuditLogsResult;
  timeZone: string;
}) => {
  if (!result.ok) {
    return <TableBody />;
  }

  if (result.auditLogs.length === 0) {
    return (
      <TableBody>
        <TableRow>
          <TableCell className="text-muted-foreground" colSpan={4}>
            {buildEmptyMessage(hasFilter)}
          </TableCell>
        </TableRow>
      </TableBody>
    );
  }

  return (
    <TableBody>
      {result.auditLogs.map((log) => (
        <TableRow
          key={`${log.createdAt}-${log.actorUserPublicId}-${log.action}-${log.targetType}-${log.targetId}`}
        >
          <TableCell>
            {formatDateTime(log.createdAt, { fallback: "-", timeZone })}
          </TableCell>
          <TableCell>
            <div className="grid gap-1">
              {log.actorUserPublicId ? (
                <Link
                  className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                  href={`/operators/${log.actorUserPublicId}`}
                >
                  {log.actorName || log.actorUserPublicId}
                </Link>
              ) : (
                <p className="text-sm">-</p>
              )}
              <p className="font-mono text-xs text-muted-foreground">
                {log.actorUserPublicId || "-"}
              </p>
              <p>
                <Badge tone="info">{getActorRoleLabel(log.actorRole)}</Badge>
              </p>
            </div>
          </TableCell>
          <TableCell>
            <div className="grid gap-1">
              <p className="font-medium">{getAuditActionLabel(log.action)}</p>
              <p className="font-mono text-xs text-muted-foreground">
                {log.action || "-"}
              </p>
              <p>
                <Badge tone={getOutcomeTone(log.outcome)}>
                  {log.outcome || "unknown"}
                </Badge>
              </p>
            </div>
          </TableCell>
          <TableCell>
            <div className="grid gap-1">
              {renderAuditLogTarget(log)}
              {log.reason ? (
                <p className="text-xs text-muted-foreground">{log.reason}</p>
              ) : null}
            </div>
          </TableCell>
        </TableRow>
      ))}
    </TableBody>
  );
};

const AuditLogsContent = async ({
  searchParams,
}: Pick<AuditLogsPageProps, "searchParams">) => {
  const params = await searchParams;
  const actorFilter = params.actor_user_public_id?.trim() ?? "";
  const actionFilter = params.action?.trim() ?? "";
  const offset = parseOffset(params.offset);

  const hasFilter = Boolean(actorFilter || actionFilter);

  // Timestamps follow the platform default time zone, not the host's or the
  // browser's, so every operator reads the same wall clock (#850).
  const [result, timeZone] = await Promise.all([
    listPlatformAuditLogs({
      action: actionFilter || undefined,
      actorUserPublicId: actorFilter || undefined,
      limit: pageSize,
      offset,
    }),
    getPlatformDisplayTimeZone(),
  ]);

  const hasPrev = offset > 0;
  const hasNext = result.ok && result.auditLogs.length === pageSize;
  const prevOffset = Math.max(0, offset - pageSize);
  const nextOffset = offset + pageSize;
  const summaryText = getSummaryText(result, offset);

  return (
    <Card>
      <CardHeader>
        <CardTitle>イベント一覧</CardTitle>
        <CardDescription>
          actor / action / target / timestamp を基準に監査イベントを確認します。
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <AuditLogsFilters
          actionFilter={actionFilter}
          actorFilter={actorFilter}
          hasFilter={hasFilter}
        />

        {result.ok ? null : (
          <SectionError
            description={result.message}
            title="監査ログを表示できませんでした"
          />
        )}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>時刻</TableHead>
              <TableHead>実行者</TableHead>
              <TableHead>操作</TableHead>
              <TableHead>対象</TableHead>
            </TableRow>
          </TableHeader>
          <AuditLogsTableBody
            hasFilter={hasFilter}
            result={result}
            timeZone={timeZone}
          />
        </Table>

        <AuditLogsPagination
          actionFilter={actionFilter}
          actorFilter={actorFilter}
          hasNext={hasNext}
          hasPrev={hasPrev}
          nextOffset={nextOffset}
          prevOffset={prevOffset}
          summaryText={summaryText}
        />
      </CardContent>
    </Card>
  );
};

const AuditLogsPage = ({ searchParams }: AuditLogsPageProps) => (
  <PlatformPage>
    <PlatformPageHeader>
      <PlatformPageHeading>
        <PlatformPageEyebrow>Platform Governance</PlatformPageEyebrow>
        <PlatformPageTitle>監査ログ</PlatformPageTitle>
        <PlatformPageDescription>
          重要操作を横断的に追跡し、対象リソースの詳細へ遷移できる監査ログ画面です。
        </PlatformPageDescription>
      </PlatformPageHeading>
    </PlatformPageHeader>
    <PlatformPageContent>
      <SectionErrorBoundary title="監査ログを表示できませんでした">
        <Suspense fallback={<AuditLogsSkeleton />}>
          <AuditLogsContent searchParams={searchParams} />
        </Suspense>
      </SectionErrorBoundary>
    </PlatformPageContent>
  </PlatformPage>
);

export default AuditLogsPage;
