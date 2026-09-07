import { getMessage } from "@publira/i18n";
import { StatusChip } from "@publira/ui-components/badge";
import { LinkButton } from "@publira/ui-components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@publira/ui-components/card";
import {
  SectionError,
  SectionErrorDescription,
  SectionErrorHeading,
  SectionErrorTitle,
} from "@publira/ui-components/section-error";
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
import Link from "next/link";
import { Suspense } from "react";

import { Message } from "#components/message";
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
import { getAuditActionLabel } from "#lib/audit-log-labels";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import { getPlatformDashboardSummary } from "#lib/dashboard";
import type {
  PlatformDashboardRecentEvent,
  PlatformDashboardSummary,
} from "#lib/dashboard";
import { getPlatformLocale, loadPlatformMessages } from "#lib/locale";
import type { PlatformMessages } from "#lib/locale";
import { getPlatformDisplayTimeZone } from "#lib/platform-settings";

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getPlatformLocale();
  const messages = await loadPlatformMessages(locale);

  return { title: getMessage(messages, "platform.dashboard.title") };
};

const recentEventsLimit = 6;

const getRecentEventLabel = (
  event: PlatformDashboardRecentEvent,
  messages: PlatformMessages
): string => {
  switch (event.eventType) {
    case "tenant_created": {
      return getMessage(messages, "platform.dashboard.events.tenant_created");
    }
    case "operator_role_granted": {
      return getMessage(
        messages,
        "platform.dashboard.events.operator_role_granted"
      );
    }
    case "end_user_created": {
      return getMessage(messages, "platform.dashboard.events.end_user_created");
    }
    default: {
      return getAuditActionLabel(event.action, messages);
    }
  }
};

const getRecentEventTone = (
  eventType: string
): "destructive" | "info" | "muted" | "success" | "warning" => {
  switch (eventType) {
    case "tenant_created": {
      return "success";
    }
    case "operator_role_granted": {
      return "info";
    }
    case "end_user_created": {
      return "warning";
    }
    default: {
      return "muted";
    }
  }
};

const getRecentEventTypeLabel = (eventType: string): string => {
  switch (eventType) {
    case "tenant_created": {
      return "Tenant";
    }
    case "operator_role_granted": {
      return "Operator";
    }
    case "end_user_created": {
      return "User";
    }
    default: {
      return eventType || "Event";
    }
  }
};

const buildTargetHref = (
  event: PlatformDashboardRecentEvent
): string | null => {
  switch (event.eventType) {
    case "tenant_created": {
      return event.target ? `/tenants/${event.target}` : null;
    }
    case "operator_role_granted":
    case "end_user_created": {
      return event.target ? `/users/${event.target}` : null;
    }
    default: {
      return null;
    }
  }
};

const getStatCards = (
  summary: PlatformDashboardSummary | null,
  messages: PlatformMessages
) =>
  [
    {
      detail: summary
        ? getMessage(messages, "platform.dashboard.stats.total_detail", {
            active: summary.activeTenants,
            suspended: summary.suspendedTenants,
          })
        : getMessage(messages, "platform.dashboard.stats.total_detail_empty"),
      label: getMessage(messages, "platform.dashboard.stats.total_label"),
      value: summary ? String(summary.totalTenants) : "-",
    },
    {
      detail: summary
        ? getMessage(messages, "platform.dashboard.stats.active_detail", {
            count: summary.totalTenants,
          })
        : getMessage(messages, "platform.dashboard.stats.active_detail_empty"),
      label: getMessage(messages, "platform.dashboard.stats.active_label"),
      value: summary ? String(summary.activeTenants) : "-",
    },
    {
      detail: summary
        ? getMessage(messages, "platform.dashboard.stats.suspended_detail")
        : getMessage(
            messages,
            "platform.dashboard.stats.suspended_detail_empty"
          ),
      label: getMessage(messages, "platform.dashboard.stats.suspended_label"),
      value: summary ? String(summary.suspendedTenants) : "-",
    },
    {
      detail: summary
        ? getMessage(messages, "platform.dashboard.stats.pending_detail")
        : getMessage(messages, "platform.dashboard.stats.pending_detail_empty"),
      label: getMessage(messages, "platform.dashboard.stats.pending_label"),
      value: summary ? String(summary.pendingEndUsers) : "-",
    },
  ] as const;

const DashboardSkeleton = () => (
  <div className="grid gap-6">
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {(["s1", "s2", "s3", "s4"] as const).map((key) => (
        <Card key={key}>
          <CardHeader className="gap-3">
            <div className="h-4 w-24 animate-pulse rounded bg-muted" />
            <div className="h-8 w-12 animate-pulse rounded bg-muted" />
          </CardHeader>
          <CardContent className="pt-0">
            <div className="h-4 w-40 animate-pulse rounded bg-muted/70" />
          </CardContent>
        </Card>
      ))}
    </div>
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(18rem,1fr)]">
      <Card>
        <CardHeader>
          <div className="h-5 w-40 animate-pulse rounded bg-muted" />
        </CardHeader>
        <CardContent>
          <div className="grid gap-3">
            <div className="h-10 animate-pulse rounded bg-muted/70" />
            <div className="h-10 animate-pulse rounded bg-muted/70" />
            <div className="h-10 animate-pulse rounded bg-muted/70" />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <div className="h-5 w-28 animate-pulse rounded bg-muted" />
        </CardHeader>
        <CardContent>
          <div className="grid gap-2">
            <div className="h-12 animate-pulse rounded bg-muted/70" />
            <div className="h-12 animate-pulse rounded bg-muted/70" />
            <div className="h-12 animate-pulse rounded bg-muted/70" />
          </div>
        </CardContent>
      </Card>
    </div>
  </div>
);

const DashboardContent = async () => {
  // Timestamps follow the platform default time zone, not the host's or the
  // browser's, so every operator reads the same wall clock.
  const locale = await getPlatformLocale();
  const [messages, result, timeZone] = await Promise.all([
    loadPlatformMessages(locale),
    getPlatformDashboardSummary({ locale, recentEventsLimit }),
    getPlatformDisplayTimeZone(),
  ]);

  await redirectToLoginIfSessionRejected(result);

  const summary = result.ok ? result.summary : null;
  const stats = getStatCards(summary, messages);

  return (
    <>
      {result.ok ? null : (
        <SectionError>
          <SectionErrorHeading>
            <SectionErrorTitle>
              <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                <Message message="platform.dashboard.load_failed" />
              </Suspense>
            </SectionErrorTitle>
            <SectionErrorDescription>{result.message}</SectionErrorDescription>
          </SectionErrorHeading>
        </SectionError>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {stats.map((item) => (
          <Card key={item.label}>
            <CardHeader className="gap-3">
              <CardDescription>{item.label}</CardDescription>
              <CardTitle className="text-3xl">{item.value}</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 text-sm text-muted-foreground">
              {item.detail}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(18rem,1fr)]">
        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="grid gap-1">
              <CardTitle>
                {getMessage(messages, "platform.dashboard.events_title")}
              </CardTitle>
              <CardDescription>
                {getMessage(messages, "platform.dashboard.events_description")}
              </CardDescription>
            </div>
            <StatusChip status={summary ? "info" : "warning"}>
              {summary
                ? getMessage(messages, "platform.dashboard.updated_count", {
                    count: summary.recentEvents.length,
                  })
                : getMessage(messages, "platform.dashboard.not_fetched")}
            </StatusChip>
          </CardHeader>

          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    {getMessage(messages, "platform.dashboard.columns.event")}
                  </TableHead>
                  <TableHead>
                    {getMessage(messages, "platform.dashboard.columns.target")}
                  </TableHead>
                  <TableHead className="w-52">
                    {getMessage(messages, "platform.dashboard.columns.actor")}
                  </TableHead>
                  <TableHead className="w-52">
                    {getMessage(messages, "platform.dashboard.columns.at")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!summary || summary.recentEvents.length === 0 ? (
                  <TableRow>
                    <TableCell className="text-muted-foreground" colSpan={4}>
                      {summary
                        ? getMessage(
                            messages,
                            "platform.dashboard.empty_events"
                          )
                        : getMessage(
                            messages,
                            "platform.dashboard.empty_events_pending"
                          )}
                    </TableCell>
                  </TableRow>
                ) : (
                  summary.recentEvents.map((event) => {
                    const href = buildTargetHref(event);

                    return (
                      <TableRow
                        key={`${event.at}-${event.eventType}-${event.target}`}
                      >
                        <TableCell>
                          <div className="grid gap-1">
                            <p className="font-medium">
                              {getRecentEventLabel(event, messages)}
                            </p>
                            <p>
                              <StatusChip
                                status={getRecentEventTone(event.eventType)}
                              >
                                {getRecentEventTypeLabel(event.eventType)}
                              </StatusChip>
                            </p>
                          </div>
                        </TableCell>
                        <TableCell>
                          {href ? (
                            <Link
                              className="font-medium text-primary underline-offset-4 hover:underline"
                              href={href}
                            >
                              {event.target}
                            </Link>
                          ) : (
                            <span>{event.target || "-"}</span>
                          )}
                        </TableCell>
                        <TableCell>{event.actor || "system"}</TableCell>
                        <TableCell>
                          {formatDateTime(event.at, {
                            fallback: "-",
                            locale,
                            timeZone,
                          })}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              {getMessage(messages, "platform.dashboard.next_actions_title")}
            </CardTitle>
            <CardDescription>
              {getMessage(
                messages,
                "platform.dashboard.next_actions_description"
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm text-muted-foreground">
            <Link
              className="rounded-md border border-border/80 px-3 py-3 font-medium text-foreground transition hover:border-primary/40 hover:bg-accent"
              href="/tenants"
            >
              {getMessage(messages, "platform.dashboard.open_tenants")}
            </Link>
            <Link
              className="rounded-md border border-border/80 px-3 py-3 font-medium text-foreground transition hover:border-primary/40 hover:bg-accent"
              href="/audit-logs"
            >
              {getMessage(messages, "platform.dashboard.open_audit")}
            </Link>
            <Link
              className="rounded-md border border-border/80 px-3 py-3 font-medium text-foreground transition hover:border-primary/40 hover:bg-accent"
              href="/operators"
            >
              {getMessage(messages, "platform.dashboard.open_operators")}
            </Link>
            <Link
              className="rounded-md border border-border/80 px-3 py-3 font-medium text-foreground transition hover:border-primary/40 hover:bg-accent"
              href="/tenants/new"
            >
              {getMessage(messages, "platform.dashboard.open_tenants_new")}
            </Link>
          </CardContent>
        </Card>
      </div>
    </>
  );
};

const Page = () => (
  <PlatformPage>
    <PlatformPageHeader>
      <PlatformPageHeading>
        <PlatformPageEyebrow>Platform Dashboard</PlatformPageEyebrow>
        <PlatformPageTitle>
          <Suspense fallback={<SkeletonLine className="h-8 w-72" />}>
            <Message message="platform.dashboard.heading" />
          </Suspense>
        </PlatformPageTitle>
        <PlatformPageDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
            <Message message="platform.dashboard.page_description" />
          </Suspense>
        </PlatformPageDescription>
      </PlatformPageHeading>
      <PlatformPageActions>
        <LinkButton render={<Link href="/audit-logs" />} variant="outline">
          <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
            <Message message="platform.dashboard.view_audit" />
          </Suspense>
        </LinkButton>
        <LinkButton render={<Link href="/tenants" />}>
          <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
            <Message message="platform.dashboard.view_tenants" />
          </Suspense>
        </LinkButton>
      </PlatformPageActions>
    </PlatformPageHeader>
    <PlatformPageContent>
      <SectionErrorBoundary
        title={
          <Suspense fallback={<SkeletonLine className="h-4 w-56" />}>
            <Message message="platform.dashboard.load_failed" />
          </Suspense>
        }
      >
        <Suspense fallback={<DashboardSkeleton />}>
          <DashboardContent />
        </Suspense>
      </SectionErrorBoundary>
    </PlatformPageContent>
  </PlatformPage>
);

export default Page;
