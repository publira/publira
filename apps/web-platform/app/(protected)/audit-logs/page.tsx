import { smtpTestFailureMessage } from "@publira/api-client/error-messages";
import type { Locale } from "@publira/i18n";
import { CloseIcon } from "@publira/icons";
import { Badge } from "@publira/ui-components/badge";
import { Button } from "@publira/ui-components/button";
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
  PlatformPageContent,
  PlatformPageDescription,
  PlatformPageHeader,
  PlatformPageHeading,
  PlatformPageTitle,
} from "#components/platform-page";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import {
  getActorRoleLabel,
  getAuditActionOptions,
} from "#lib/audit-log-labels";
import { listPlatformAuditLogs } from "#lib/audit-logs";
import type {
  ListPlatformAuditLogsInput,
  ListPlatformAuditLogsResult,
  PlatformAuditLogSummary,
} from "#lib/audit-logs";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import { DEFAULT_LIST_PAGE_SIZE } from "#lib/list-pagination";
import { getPlatformLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getPlatformDisplayTimeZone } from "#lib/platform-settings";
import { searchTestFailureMessage } from "#lib/search-settings";
import { storageTestFailureMessage } from "#lib/storage-settings";
import { getPlatformTenant } from "#lib/tenants";

import { AuditActionName } from "./_components/audit-action-name";
import { AuditLogTarget } from "./_components/audit-log-target";
import {
  buildAuditLogsPath,
  parseAuditLogFilters,
  toAllowedActionValues,
} from "./_lib/search-params";
import { resolveAuditLogTenantFilter } from "./_lib/tenant-filter";
import type { AuditLogTenantFilter } from "./_lib/tenant-filter";

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getPlatformLocale();
  const t = await getMessagesFor(locale);

  return { title: t("platform.audit.title") };
};

type AuditLogsPageProps = PageProps<"/audit-logs">;

const pageSize = DEFAULT_LIST_PAGE_SIZE;

const AuditLogsSkeleton = () => (
  <div className="grid gap-4">
    <div className="flex gap-3">
      <Skeleton className="h-10 w-48" />
      <Skeleton className="h-10 w-56" />
      <Skeleton className="h-10 w-24" />
    </div>
    <TableSkeleton rows={4} />
  </div>
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

const buildEmptyMessage = async (
  hasFilter: boolean,
  locale: Locale
): Promise<string> => {
  const t = await getMessagesFor(locale);

  return hasFilter
    ? t("platform.audit.empty_filtered")
    : t("platform.audit.empty");
};

const getSummaryText = async (
  result: ListPlatformAuditLogsResult,
  locale: Locale
): Promise<string> => {
  if (!result.ok) {
    return "-";
  }

  const t = await getMessagesFor(locale);

  return t("platform.audit.showing", { count: result.auditLogs.length });
};

/**
 * The tenant the list is narrowed to, with a way to drop that filter alone.
 * The tenant has no field in the form, so this is the only place the screen
 * says it is applied.
 */
const AuditLogsTenantFilter = async ({
  removeHref,
  tenantFilter,
}: {
  removeHref: string;
  tenantFilter: Exclude<AuditLogTenantFilter, { kind: "none" }>;
}) => {
  const t = await getMessagesFor(await getPlatformLocale());

  return (
    <p className="flex h-10 max-w-full items-center gap-1 rounded-control bg-muted px-3 text-sm">
      <span className="truncate">
        {t("platform.audit.tenant_filter", { name: tenantFilter.label })}
      </span>
      <Link
        className="rounded-control p-0.5 transition-colors duration-state ease-state hover:bg-card focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        href={removeHref}
      >
        <CloseIcon aria-hidden className="h-4 w-4" />
        <span className="sr-only">
          {t("platform.audit.tenant_filter_remove")}
        </span>
      </Link>
    </p>
  );
};

const AuditLogsFilters = async ({
  actionFilter,
  actorFilter,
  hasFilter,
  tenantFilter,
  tenantPublicId,
}: {
  actionFilter: string;
  actorFilter: string;
  hasFilter: boolean;
  tenantFilter: AuditLogTenantFilter;
  tenantPublicId: string;
}) => {
  const locale = await getPlatformLocale();
  const [t, actionItems] = await Promise.all([
    getMessagesFor(locale),
    getAuditActionOptions(locale),
  ]);

  return (
    <Form
      action="/audit-logs"
      className="flex flex-wrap items-center gap-3"
      key={`${tenantPublicId}::${actorFilter}::${actionFilter}`}
    >
      {tenantFilter.kind === "none" ? null : (
        <>
          <input name="tenant_id" type="hidden" value={tenantPublicId} />
          <AuditLogsTenantFilter
            removeHref={buildAuditLogsPath({
              action: actionFilter,
              actorUserPublicId: actorFilter,
              tenantPublicId: "",
              token: "",
            })}
            tenantFilter={tenantFilter}
          />
        </>
      )}
      <Input
        className="w-48"
        defaultValue={actorFilter}
        name="actor_user_public_id"
        placeholder={t("platform.audit.actor_filter_placeholder")}
        type="search"
      />
      <Select
        className="w-56"
        defaultValue={actionFilter || undefined}
        items={actionItems}
        name="action"
        placeholder={t("platform.audit.all_events")}
      />
      <Button type="submit">
        <Message message="platform.common.filter" />
      </Button>
      {hasFilter ? (
        <Link
          className="flex h-10 items-center rounded-control px-3 py-2 text-sm text-muted-foreground underline-offset-4 hover:underline"
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
  const locale = await getPlatformLocale();
  const [t, summaryText] = await Promise.all([
    getMessagesFor(locale),
    getSummaryText(result, locale),
  ]);

  return (
    <div className="flex items-center justify-between gap-3">
      <p className="text-xs text-muted-foreground">{summaryText}</p>
      <PaginationControls
        aria-label={t("platform.audit.pagination_aria")}
        nextHref={nextHref}
        previousHref={previousHref}
      />
    </div>
  );
};

const auditLogReason = async (
  log: PlatformAuditLogSummary,
  locale: Locale
): Promise<string> => {
  if (log.action === "platform_smtp_test_email_sent") {
    return smtpTestFailureMessage(log.reason, locale) ?? log.reason;
  }
  if (log.action === "platform_search_connection_tested") {
    return (await searchTestFailureMessage(log.reason, locale)) ?? log.reason;
  }
  if (log.action === "platform_storage_connection_tested") {
    return (await storageTestFailureMessage(log.reason, locale)) ?? log.reason;
  }
  return log.reason;
};

/**
 * The recorded reason, worded where the console knows it. An async component
 * for the same reason as the cells below: a row rendered inside `.map()`
 * cannot await.
 */
const AuditLogReason = async ({
  locale,
  log,
}: {
  locale: Locale;
  log: PlatformAuditLogSummary;
}) => {
  const reason = await auditLogReason(log, locale);

  return reason ? (
    <p className="text-xs text-muted-foreground">{reason}</p>
  ) : null;
};

/**
 * The page of entries the filters allow. Only a tenant filter that resolved
 * reaches the API; why the others list nothing is on `AuditLogTenantFilter`.
 */
const readAuditLogs = async (
  tenantFilter: AuditLogTenantFilter,
  input: Omit<ListPlatformAuditLogsInput, "tenantId">
): Promise<ListPlatformAuditLogsResult> => {
  if (tenantFilter.kind === "unknown") {
    return { auditLogs: [], nextToken: "", ok: true, previousToken: "" };
  }
  if (tenantFilter.kind === "failed") {
    return {
      auditLogs: [],
      message: tenantFilter.message,
      nextToken: "",
      ok: false,
      previousToken: "",
      requiresSignIn: false,
    };
  }
  return await listPlatformAuditLogs({
    ...input,
    tenantId:
      tenantFilter.kind === "resolved" ? tenantFilter.tenantId : undefined,
  });
};

/**
 * The actor's role and the action name, each as its own async component: both
 * are strings the catalog resolves, and a row rendered inside `.map()` cannot
 * await.
 */
const ActorRoleCell = async ({
  locale,
  role,
}: {
  locale: Locale;
  role: string;
}) => await getActorRoleLabel(role, locale);

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

  const emptyMessage = await buildEmptyMessage(hasFilter, locale);

  if (result.auditLogs.length === 0) {
    return (
      <TableBody>
        <TableRow>
          <TableCell className="text-muted-foreground" colSpan={4}>
            {emptyMessage}
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
              <p>
                <Badge tone="info">
                  <ActorRoleCell locale={locale} role={log.actorRole} />
                </Badge>
              </p>
            </div>
          </TableCell>
          <TableCell>
            <div className="grid gap-1">
              <p className="font-medium">
                <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
                  <AuditActionName action={log.action} />
                </Suspense>
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
              <AuditLogTarget log={log} />
              <AuditLogReason locale={locale} log={log} />
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
  const actionItems = await getAuditActionOptions(locale);
  const {
    action: actionFilter,
    actorUserPublicId: actorFilter,
    tenantPublicId,
    token,
  } = parseAuditLogFilters(search, toAllowedActionValues(actionItems));

  const hasFilter = Boolean(actorFilter || actionFilter || tenantPublicId);
  const tenantFilter = resolveAuditLogTenantFilter(
    tenantPublicId,
    tenantPublicId
      ? await getPlatformTenant(tenantPublicId)
      : { ok: true, tenant: null }
  );

  // Timestamps follow the platform default time zone, not the host's or the
  // browser's, so every operator reads the same wall clock.
  const [result, timeZone] = await Promise.all([
    readAuditLogs(tenantFilter, {
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
    tenantPublicId,
  };
  const previousHref = result.previousToken
    ? buildAuditLogsPath({ ...filterParams, token: result.previousToken })
    : undefined;
  const nextHref = result.nextToken
    ? buildAuditLogsPath({ ...filterParams, token: result.nextToken })
    : undefined;
  return (
    <div className="grid gap-4">
      <Suspense fallback={<AuditLogsFiltersSkeleton />}>
        <AuditLogsFilters
          actionFilter={actionFilter}
          actorFilter={actorFilter}
          hasFilter={hasFilter}
          tenantFilter={tenantFilter}
          tenantPublicId={tenantPublicId}
        />
      </Suspense>

      {result.ok ? null : (
        <SectionError>
          <SectionErrorHeading>
            <SectionErrorTitle>
              <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                <Message message="platform.audit.load_failed" />
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
              <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                <Message message="platform.audit.columns.at" />
              </Suspense>
            </TableHead>
            <TableHead>
              <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                <Message message="platform.audit.columns.actor" />
              </Suspense>
            </TableHead>
            <TableHead>
              <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                <Message message="platform.audit.columns.action" />
              </Suspense>
            </TableHead>
            <TableHead>
              <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                <Message message="platform.audit.columns.target" />
              </Suspense>
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
    </div>
  );
};

const AuditLogsPage = ({ searchParams }: AuditLogsPageProps) => (
  <PlatformPage>
    <PlatformPageHeader>
      <PlatformPageHeading>
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
