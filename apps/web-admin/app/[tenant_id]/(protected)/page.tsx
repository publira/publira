import * as ConsolePage from "@publira/layouts/admin/console-page";
import { Badge } from "@publira/ui-components/badge";
import * as EmptyState from "@publira/ui-components/empty-state";
import * as FigureLine from "@publira/ui-components/figure-line";
import * as SectionError from "@publira/ui-components/section-error";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import * as Table from "@publira/ui-components/table";
import { formatDateTime } from "@publira/utils";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import { Suspense } from "react";

import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { getDashboard } from "#lib/dashboard";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getTenantId } from "#lib/tenant-id";
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const t = await getMessagesFor(locale);

  return { title: t("admin.dashboard.title") };
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
    <FigureLine.Root>
      {(["skeleton-1", "skeleton-2", "skeleton-3"] as const).map((key) => (
        <FigureLine.Figure key={key}>
          <FigureLine.Label>
            <SkeletonLine className="h-4 w-28" />
          </FigureLine.Label>
          <FigureLine.Value>
            <SkeletonLine className="h-6 w-10" />
          </FigureLine.Value>
        </FigureLine.Figure>
      ))}
    </FigureLine.Root>
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
  const [locale, timeZone, result] = await Promise.all([
    getLocale(tenantId),
    getTenantDisplayTimeZone(tenantId),
    getDashboard(),
  ]);

  if (!result.ok) {
    return (
      <SectionError.Root>
        <SectionError.Heading>
          <SectionError.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="admin.dashboard.section_error" />
            </Suspense>
          </SectionError.Title>
          <SectionError.Description>{result.message}</SectionError.Description>
        </SectionError.Heading>
      </SectionError.Root>
    );
  }

  const { stats, queue } = result;

  return (
    <div className="grid gap-10">
      <FigureLine.Root>
        <FigureLine.Figure>
          <FigureLine.Label>
            <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
              <Message message="admin.dashboard.published_series" />
            </Suspense>
          </FigureLine.Label>
          <FigureLine.Value>{stats.publishedSeriesCount}</FigureLine.Value>
        </FigureLine.Figure>
        <FigureLine.Figure>
          <FigureLine.Label>
            <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
              <Message message="admin.dashboard.draft_episodes" />
            </Suspense>
          </FigureLine.Label>
          <FigureLine.Value>{stats.draftEpisodeCount}</FigureLine.Value>
        </FigureLine.Figure>
        <FigureLine.Figure>
          <FigureLine.Label>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.dashboard.scheduled_episodes" />
            </Suspense>
          </FigureLine.Label>
          <FigureLine.Value>{stats.scheduledEpisodeCount}</FigureLine.Value>
        </FigureLine.Figure>
      </FigureLine.Root>

      <section className="grid gap-4">
        <QueueHeading />
        {queue.length === 0 ? (
          <EmptyState.Root>
            <EmptyState.Heading>
              <EmptyState.Title>
                <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                  <Message message="admin.dashboard.queue_empty_title" />
                </Suspense>
              </EmptyState.Title>
              <EmptyState.Description>
                <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
                  <Message message="admin.dashboard.queue_empty_description" />
                </Suspense>
              </EmptyState.Description>
            </EmptyState.Heading>
          </EmptyState.Root>
        ) : (
          <Table.Root>
            <Table.Header>
              <Table.Row>
                <Table.Head>
                  <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                    <Message message="admin.dashboard.columns.series" />
                  </Suspense>
                </Table.Head>
                <Table.Head>
                  <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                    <Message message="admin.dashboard.columns.episode" />
                  </Suspense>
                </Table.Head>
                <Table.Head className="w-36">
                  <Suspense fallback={<SkeletonLine className="h-4 w-14" />}>
                    <Message message="admin.dashboard.columns.status" />
                  </Suspense>
                </Table.Head>
                <Table.Head className="w-48">
                  <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                    <Message message="admin.dashboard.columns.scheduled_at" />
                  </Suspense>
                </Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
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
                  <Table.Row
                    key={`${item.seriesPublicId}-${item.episodePublicId}`}
                  >
                    <Table.Cell className="font-medium">
                      {item.seriesTitle}
                    </Table.Cell>
                    <Table.Cell>{item.episodeTitle}</Table.Cell>
                    <Table.Cell>
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
                    </Table.Cell>
                    <Table.Cell>
                      {scheduledAt || (
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-16" />}
                        >
                          <Message message="admin.dashboard.unset" />
                        </Suspense>
                      )}
                    </Table.Cell>
                  </Table.Row>
                );
              })}
            </Table.Body>
          </Table.Root>
        )}
      </section>
    </div>
  );
};

const DashboardPage = () => (
  <ConsolePage.Root>
    <ConsolePage.Header>
      <ConsolePage.Heading>
        <ConsolePage.Title>
          <Suspense fallback={<SkeletonLine className="h-7 w-40" />}>
            <Message message="admin.dashboard.title" />
          </Suspense>
        </ConsolePage.Title>
      </ConsolePage.Heading>
    </ConsolePage.Header>
    <ConsolePage.Content>
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
    </ConsolePage.Content>
  </ConsolePage.Root>
);

export default DashboardPage;
