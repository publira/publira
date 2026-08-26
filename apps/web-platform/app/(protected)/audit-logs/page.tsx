import { getMessage } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
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
  PlatformPageContent,
  PlatformPageDescription,
  PlatformPageEyebrow,
  PlatformPageHeader,
  PlatformPageHeading,
  PlatformPageTitle,
} from "#components/platform-page";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import {
  getAuditActionLabel,
  getAuditActionOptions,
} from "#lib/audit-log-labels";
import { listPlatformAuditLogs } from "#lib/audit-logs";
import type {
  ListPlatformAuditLogsResult,
  PlatformAuditLogSummary,
} from "#lib/audit-logs";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import { DEFAULT_LIST_PAGE_SIZE } from "#lib/list-pagination";
import { getPlatformLocale, loadPlatformMessages } from "#lib/locale";
import type { PlatformMessages } from "#lib/locale";
import { getOperatorRoleLabel } from "#lib/operator-labels";
import { getPlatformDisplayTimeZone } from "#lib/platform-settings";
import { getTenantRoleLabel } from "#lib/tenant-labels";

import {
  buildAuditLogsPath,
  parseAuditLogFilters,
  toAllowedActionValues,
} from "./_lib/search-params";

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getPlatformLocale();
  const messages = await loadPlatformMessages(locale);

  return { title: getMessage(messages, "platform.audit.title") };
};

type AuditLogsPageProps = PageProps<"/audit-logs">;

const pageSize = DEFAULT_LIST_PAGE_SIZE;

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

const AuditLogsFiltersSkeleton = () => (
  <div className="flex gap-3">
    <SkeletonLine className="h-10 w-48" />
    <SkeletonLine className="h-10 w-56" />
    <SkeletonLine className="h-10 w-24" />
  </div>
);

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

const buildEmptyMessage = (
  hasFilter: boolean,
  messages: PlatformMessages
): string =>
  hasFilter
    ? getMessage(messages, "platform.audit.empty_filtered")
    : getMessage(messages, "platform.audit.empty");

const getActorRoleLabel = (
  role: string,
  messages: PlatformMessages
): string => {
  if (!role) {
    return getMessage(messages, "platform.audit.unset");
  }

  const operatorLabel = getOperatorRoleLabel(role, messages);
  if (operatorLabel !== role) {
    return operatorLabel;
  }

  const tenantLabel = getTenantRoleLabel(role, messages);
  if (tenantLabel !== role) {
    return tenantLabel;
  }

  switch (role) {
    case "platform_owner": {
      return getMessage(messages, "platform.audit.actor_platform");
    }
    default: {
      return role;
    }
  }
};

const getSummaryText = (
  result: ListPlatformAuditLogsResult,
  messages: PlatformMessages
): string => {
  if (!result.ok) {
    return "-";
  }
  return getMessage(messages, "platform.audit.showing", {
    count: result.auditLogs.length,
  });
};

const AuditLogsFilters = async ({
  actionFilter,
  actorFilter,
  hasFilter,
}: {
  actionFilter: string;
  actorFilter: string;
  hasFilter: boolean;
}) => {
  const locale = await getPlatformLocale();
  const messages = await loadPlatformMessages(locale);
  const actionItems = getAuditActionOptions(messages, locale);

  return (
    <Form
      action="/audit-logs"
      className="flex flex-wrap gap-3"
      key={`${actorFilter}::${actionFilter}`}
    >
      <Input
        className="w-48"
        defaultValue={actorFilter}
        name="actor_user_public_id"
        placeholder={getMessage(
          messages,
          "platform.audit.actor_filter_placeholder"
        )}
        type="search"
      />
      <Select
        className="w-56"
        defaultValue={actionFilter || undefined}
        items={actionItems}
        name="action"
        placeholder={getMessage(messages, "platform.audit.all_events")}
      />
      <Button type="submit">
        <Message message="platform.common.filter" />
      </Button>
      {hasFilter ? (
        <Link
          className="flex h-10 items-center rounded-md px-3 py-2 text-sm text-muted-foreground underline-offset-4 hover:underline"
          href="/audit-logs"
        >
          <Message message="platform.common.clear" />
        </Link>
      ) : null}
    </Form>
  );
};

const AuditLogsPagination = async ({
  nextHref,
  previousHref,
  result,
}: {
  nextHref?: string;
  previousHref?: string;
  result: ListPlatformAuditLogsResult;
}) => {
  const messages = await loadPlatformMessages(await getPlatformLocale());

  return (
    <div className="flex items-center justify-between gap-3">
      <p className="text-xs text-muted-foreground">
        {getSummaryText(result, messages)}
      </p>
      <PaginationControls
        ariaLabel={getMessage(messages, "platform.audit.pagination_aria")}
        nextHref={nextHref}
        nextLabel={<Message message="platform.common.next" />}
        previousHref={previousHref}
        previousLabel={<Message message="platform.common.previous" />}
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

const AuditLogsTableBody = async ({
  hasFilter,
  locale,
  result,
  timeZone,
}: {
  hasFilter: boolean;
  locale: Locale;
  result: ListPlatformAuditLogsResult;
  timeZone: string;
}) => {
  if (!result.ok) {
    return <TableBody />;
  }

  const messages = await loadPlatformMessages(await getPlatformLocale());

  if (result.auditLogs.length === 0) {
    return (
      <TableBody>
        <TableRow>
          <TableCell className="text-muted-foreground" colSpan={4}>
            {buildEmptyMessage(hasFilter, messages)}
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
            {formatDateTime(log.createdAt, {
              fallback: "-",
              locale,
              timeZone,
            })}
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
                <Badge tone="info">
                  {getActorRoleLabel(log.actorRole, messages)}
                </Badge>
              </p>
            </div>
          </TableCell>
          <TableCell>
            <div className="grid gap-1">
              <p className="font-medium">
                {getAuditActionLabel(log.action, messages)}
              </p>
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
  const [search, locale] = await Promise.all([
    searchParams,
    getPlatformLocale(),
  ]);
  const messages = await loadPlatformMessages(locale);
  const actionItems = getAuditActionOptions(messages, locale);
  const {
    action: actionFilter,
    actorUserPublicId: actorFilter,
    token,
  } = parseAuditLogFilters(search, toAllowedActionValues(actionItems));

  const hasFilter = Boolean(actorFilter || actionFilter);

  // Timestamps follow the platform default time zone, not the host's or the
  // browser's, so every operator reads the same wall clock (#850).
  const [result, timeZone] = await Promise.all([
    listPlatformAuditLogs({
      action: actionFilter || undefined,
      actorUserPublicId: actorFilter || undefined,
      limit: pageSize,
      locale,
      token: token || undefined,
    }),
    getPlatformDisplayTimeZone(),
  ]);

  await redirectToLoginIfSessionRejected(result);

  const filterParams = {
    action: actionFilter,
    actorUserPublicId: actorFilter,
  };
  const previousHref = result.previousToken
    ? buildAuditLogsPath({ ...filterParams, token: result.previousToken })
    : undefined;
  const nextHref = result.nextToken
    ? buildAuditLogsPath({ ...filterParams, token: result.nextToken })
    : undefined;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {getMessage(messages, "platform.audit.card_title")}
        </CardTitle>
        <CardDescription>
          {getMessage(messages, "platform.audit.card_description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Suspense fallback={<AuditLogsFiltersSkeleton />}>
          <AuditLogsFilters
            actionFilter={actionFilter}
            actorFilter={actorFilter}
            hasFilter={hasFilter}
          />
        </Suspense>

        {result.ok ? null : (
          <SectionError
            description={result.message}
            title={getMessage(messages, "platform.audit.load_failed")}
          />
        )}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                {getMessage(messages, "platform.audit.columns.at")}
              </TableHead>
              <TableHead>
                {getMessage(messages, "platform.audit.columns.actor")}
              </TableHead>
              <TableHead>
                {getMessage(messages, "platform.audit.columns.action")}
              </TableHead>
              <TableHead>
                {getMessage(messages, "platform.audit.columns.target")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <AuditLogsTableBody
            hasFilter={hasFilter}
            locale={locale}
            result={result}
            timeZone={timeZone}
          />
        </Table>

        <Suspense fallback={<SkeletonLine className="ml-auto h-8 w-40" />}>
          <AuditLogsPagination
            nextHref={nextHref}
            previousHref={previousHref}
            result={result}
          />
        </Suspense>
      </CardContent>
    </Card>
  );
};

const AuditLogsPage = ({ searchParams }: AuditLogsPageProps) => (
  <PlatformPage>
    <PlatformPageHeader>
      <PlatformPageHeading>
        <PlatformPageEyebrow>Platform Governance</PlatformPageEyebrow>
        <PlatformPageTitle>
          <Suspense fallback={<SkeletonLine className="h-8 w-24" />}>
            <Message message="platform.audit.heading" />
          </Suspense>
        </PlatformPageTitle>
        <PlatformPageDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-96" />}>
            <Message message="platform.audit.page_description" />
          </Suspense>
        </PlatformPageDescription>
      </PlatformPageHeading>
    </PlatformPageHeader>
    <PlatformPageContent>
      <SectionErrorBoundary
        title={
          <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
            <Message message="platform.audit.load_failed" />
          </Suspense>
        }
      >
        <Suspense fallback={<AuditLogsSkeleton />}>
          <AuditLogsContent searchParams={searchParams} />
        </Suspense>
      </SectionErrorBoundary>
    </PlatformPageContent>
  </PlatformPage>
);

export default AuditLogsPage;
