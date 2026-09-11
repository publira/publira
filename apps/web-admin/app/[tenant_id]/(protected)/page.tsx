import { getMessage } from "@publira/i18n";
import { Badge } from "@publira/ui-components/badge";
import {
  EmptyState,
  EmptyStateDescription,
  EmptyStateHeading,
  EmptyStateTitle,
} from "@publira/ui-components/empty-state";
import {
  Figure,
  FigureLabel,
  FigureLine,
  FigureValue,
} from "@publira/ui-components/figure-line";
import {
  SectionError,
  SectionErrorDescription,
  SectionErrorHeading,
  SectionErrorTitle,
} from "@publira/ui-components/section-error";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
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
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const messages = await loadAdminMessages(locale);

  return { title: getMessage(messages, "admin.dashboard.title") };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

/** As many rows as the queue is likely to hold before it needs scrolling. */
const QUEUE_SKELETON_ROWS = 3;

const getQueueStatusTone = (status: "draft" | "scheduled") => {
  if (status === "scheduled") {
    return "info" as const;
  }
  return "muted" as const;
};

/**
 * What an episode in the queue is waiting for. The branch is written out here
 * so each key stays a literal at the point it is rendered.
 */
const QueueStatusMessage = ({ status }: { status: "draft" | "scheduled" }) => {
  if (status === "scheduled") {
    return <Message message="admin.dashboard.status_scheduled" />;
  }
  return <Message message="admin.dashboard.status_draft" />;
};

/** The heading of the section the queue is, whether or not the queue arrived. */
const QueueHeading = () => (
  <div className="grid gap-1">
    <h2 className="text-xl leading-tight font-medium text-foreground">
      <Suspense fallback={<SkeletonLine className="h-5 w-44" />}>
        <Message message="admin.dashboard.queue_title" />
      </Suspense>
    </h2>
    <p className="text-sm text-muted-foreground">
      <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
        <Message message="admin.dashboard.queue_description" />
      </Suspense>
    </p>
  </div>
);

/**
 * The same geometry the figures and the queue land in, so nothing moves when
 * the read returns: three pairs on one line, then rows under a rule.
 */
const DashboardSkeleton = () => (
  <div className="grid gap-10">
    <FigureLine>
      {(["skeleton-1", "skeleton-2", "skeleton-3"] as const).map((key) => (
        <Figure key={key}>
          <FigureLabel>
            <SkeletonLine className="h-4 w-28" />
          </FigureLabel>
          <FigureValue>
            <SkeletonLine className="h-6 w-10" />
          </FigureValue>
        </Figure>
      ))}
    </FigureLine>
    <section className="grid gap-4">
      <QueueHeading />
      <div className="divide-y divide-border border-t-2 border-border">
        {Array.from({ length: QUEUE_SKELETON_ROWS }, (_, index) => (
          <div className="py-3" key={index}>
            <Skeleton className="h-5 w-full" />
          </div>
        ))}
      </div>
    </section>
  </div>
);

const DashboardContent = async () => {
  const tenantId = await getTenantId();
  const [locale, timeZone] = await Promise.all([
    getLocale(tenantId),
    getTenantDisplayTimeZone(tenantId),
  ]);
  const result = await getDashboard(tenantId, locale);

  if (!result.ok) {
    await redirectToLoginIfSessionRejected(result);

    return (
      <SectionError>
        <SectionErrorHeading>
          <SectionErrorTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="admin.dashboard.section_error" />
            </Suspense>
          </SectionErrorTitle>
          <SectionErrorDescription>{result.message}</SectionErrorDescription>
        </SectionErrorHeading>
      </SectionError>
    );
  }

  const { stats, queue } = result;

  return (
    <div className="grid gap-10">
      <FigureLine>
        <Figure>
          <FigureLabel>
            <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
              <Message message="admin.dashboard.published_series" />
            </Suspense>
          </FigureLabel>
          <FigureValue>{stats.publishedSeriesCount}</FigureValue>
        </Figure>
        <Figure>
          <FigureLabel>
            <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
              <Message message="admin.dashboard.draft_episodes" />
            </Suspense>
          </FigureLabel>
          <FigureValue>{stats.draftEpisodeCount}</FigureValue>
        </Figure>
        <Figure>
          <FigureLabel>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.dashboard.scheduled_episodes" />
            </Suspense>
          </FigureLabel>
          <FigureValue>{stats.scheduledEpisodeCount}</FigureValue>
        </Figure>
      </FigureLine>

      <section className="grid gap-4">
        <QueueHeading />
        {queue.length === 0 ? (
          <EmptyState>
            <EmptyStateHeading>
              <EmptyStateTitle>
                <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                  <Message message="admin.dashboard.queue_empty_title" />
                </Suspense>
              </EmptyStateTitle>
              <EmptyStateDescription>
                <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
                  <Message message="admin.dashboard.queue_empty_description" />
                </Suspense>
              </EmptyStateDescription>
            </EmptyStateHeading>
          </EmptyState>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                    <Message message="admin.dashboard.columns.series" />
                  </Suspense>
                </TableHead>
                <TableHead>
                  <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                    <Message message="admin.dashboard.columns.episode" />
                  </Suspense>
                </TableHead>
                <TableHead className="w-36">
                  <Suspense fallback={<SkeletonLine className="h-4 w-14" />}>
                    <Message message="admin.dashboard.columns.status" />
                  </Suspense>
                </TableHead>
                <TableHead className="w-48">
                  <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                    <Message message="admin.dashboard.columns.scheduled_at" />
                  </Suspense>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {queue.map((item) => {
                // An empty fallback rather than the raw value, so the cell can
                // tell "no date set" from a date and say so in the operator's
                // own language below.
                const scheduledAt = formatDateTime(item.scheduledAt, {
                  fallback: "",
                  locale,
                  timeZone,
                });

                return (
                  <TableRow
                    key={`${item.seriesPublicId}-${item.episodePublicId}`}
                  >
                    <TableCell className="font-medium">
                      {item.seriesTitle}
                    </TableCell>
                    <TableCell>{item.episodeTitle}</TableCell>
                    <TableCell>
                      <Badge
                        tone={getQueueStatusTone(item.status)}
                        variant="outline"
                      >
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-16" />}
                        >
                          <QueueStatusMessage status={item.status} />
                        </Suspense>
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {scheduledAt || (
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-16" />}
                        >
                          <Message message="admin.dashboard.unset" />
                        </Suspense>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
};

const DashboardPage = () => (
  <AdminPage>
    <AdminPageHeader>
      <AdminPageHeading>
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
