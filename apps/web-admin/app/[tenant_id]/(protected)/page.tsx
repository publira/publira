import { getMessage } from "@publira/i18n";
import { Badge } from "@publira/ui-components/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@publira/ui-components/card";
import { EmptyState } from "@publira/ui-components/empty-state";
import { SectionError } from "@publira/ui-components/section-error";
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
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import { Suspense } from "react";

import {
  AdminPage,
  AdminPageContent,
  AdminPageEyebrow,
  AdminPageHeader,
  AdminPageHeading,
  AdminPageTitle,
} from "#components/admin-page";
import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import { getDashboard } from "#lib/dashboard";
import { getLocale, loadAdminMessages } from "#lib/locale";
import { getTenantId } from "#lib/tenant-id";
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getLocale();
  const messages = await loadAdminMessages(locale);

  return { title: getMessage(messages, "admin.dashboard.title") };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

const getQueueStatusTone = (status: "draft" | "scheduled") => {
  if (status === "scheduled") {
    return "info" as const;
  }
  return "muted" as const;
};

const getQueueStatusKey = (status: "draft" | "scheduled") => {
  if (status === "scheduled") {
    return "admin.dashboard.status_scheduled" as const;
  }
  return "admin.dashboard.status_draft" as const;
};

const DashboardSkeleton = () => (
  <div className="grid gap-6">
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {(["skeleton-1", "skeleton-2", "skeleton-3"] as const).map((key) => (
        <Card key={key}>
          <CardHeader className="gap-3">
            <div className="h-4 w-24 animate-pulse rounded bg-muted" />
            <div className="h-8 w-12 animate-pulse rounded bg-muted" />
          </CardHeader>
        </Card>
      ))}
    </div>
    <Card>
      <CardHeader>
        <div className="h-5 w-28 animate-pulse rounded bg-muted" />
      </CardHeader>
      <CardContent>
        <div className="grid gap-3">
          <div className="h-10 animate-pulse rounded bg-muted/70" />
          <div className="h-10 animate-pulse rounded bg-muted/70" />
          <div className="h-10 animate-pulse rounded bg-muted/70" />
        </div>
      </CardContent>
    </Card>
  </div>
);

const DashboardContent = async () => {
  const tenantId = await getTenantId();
  const [locale, timeZone] = await Promise.all([
    getLocale(tenantId),
    getTenantDisplayTimeZone(tenantId),
  ]);
  const messages = await loadAdminMessages(locale);
  const result = await getDashboard(tenantId, locale);

  if (!result.ok) {
    await redirectToLoginIfSessionRejected(result);

    return (
      <SectionError
        description={result.message}
        title={getMessage(messages, "admin.dashboard.section_error")}
      />
    );
  }

  const { stats, queue } = result;

  const statsItems = [
    {
      label: "admin.dashboard.published_series",
      value: stats.publishedSeriesCount,
    },
    {
      label: "admin.dashboard.draft_episodes",
      value: stats.draftEpisodeCount,
    },
    {
      label: "admin.dashboard.scheduled_episodes",
      value: stats.scheduledEpisodeCount,
    },
  ] as const;

  return (
    <div className="grid gap-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {statsItems.map((item) => (
          <Card key={item.label}>
            <CardHeader className="gap-3">
              <CardDescription>
                {getMessage(messages, item.label)}
              </CardDescription>
              <CardTitle className="text-3xl">{item.value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {getMessage(messages, "admin.dashboard.queue_title")}
          </CardTitle>
          <CardDescription>
            {getMessage(messages, "admin.dashboard.queue_description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {queue.length === 0 ? (
            <EmptyState
              description={getMessage(
                messages,
                "admin.dashboard.queue_empty_description"
              )}
              title={getMessage(messages, "admin.dashboard.queue_empty_title")}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    {getMessage(messages, "admin.dashboard.columns.series")}
                  </TableHead>
                  <TableHead>
                    {getMessage(messages, "admin.dashboard.columns.episode")}
                  </TableHead>
                  <TableHead className="w-36">
                    {getMessage(messages, "admin.dashboard.columns.status")}
                  </TableHead>
                  <TableHead className="w-48">
                    {getMessage(
                      messages,
                      "admin.dashboard.columns.scheduled_at"
                    )}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {queue.map((item) => (
                  <TableRow
                    key={`${item.seriesPublicId}-${item.episodePublicId}`}
                  >
                    <TableCell className="font-medium">
                      {item.seriesTitle}
                    </TableCell>
                    <TableCell>{item.episodeTitle}</TableCell>
                    <TableCell>
                      <Badge tone={getQueueStatusTone(item.status)}>
                        {getMessage(messages, getQueueStatusKey(item.status))}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {formatDateTime(item.scheduledAt, {
                        fallback: getMessage(messages, "admin.dashboard.unset"),
                        locale,
                        timeZone,
                      })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

const DashboardPage = () => (
  <AdminPage>
    <AdminPageHeader>
      <AdminPageHeading>
        <AdminPageEyebrow>Console</AdminPageEyebrow>
        <AdminPageTitle>
          <Suspense fallback={<SkeletonLine className="h-7 w-40" />}>
            <Message message="admin.dashboard.title" />
          </Suspense>
        </AdminPageTitle>
      </AdminPageHeading>
    </AdminPageHeader>
    <AdminPageContent>
      <SectionErrorBoundary
        title={
          <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
            <Message message="admin.dashboard.section_error" />
          </Suspense>
        }
      >
        <Suspense fallback={<DashboardSkeleton />}>
          <DashboardContent />
        </Suspense>
      </SectionErrorBoundary>
    </AdminPageContent>
  </AdminPage>
);

export default DashboardPage;
