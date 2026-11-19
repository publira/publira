import * as ConsolePage from "@publira/layouts/admin/console-page";
import * as ConsoleSection from "@publira/layouts/admin/console-section";
import { LinkButton } from "@publira/ui-components/button";
import * as FigureLine from "@publira/ui-components/figure-line";
import * as SectionError from "@publira/ui-components/section-error";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import * as Table from "@publira/ui-components/table";
import { formatDateTime } from "@publira/utils";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { getPlatformDashboardSummary } from "#lib/dashboard";
import type { PlatformDashboardRecentEvent } from "#lib/dashboard";
import { getPlatformLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getPlatformDisplayTimeZone } from "#lib/platform-settings";

import { SetupStatusSection } from "./_components/setup-status";

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getPlatformLocale();
  const t = await getMessagesFor(locale);

  return { title: t("platform.dashboard.title") };
};

const recentEventsLimit = 6;

/** As many rows as the events read asks for, so nothing moves when it lands. */
const EVENTS_SKELETON_ROWS = recentEventsLimit;

/**
 * What happened, in the operator's own language. `ListRecentPlatformEvents`
 * produces exactly these three kinds, each with a key written out here so it
 * stays a literal at the point it is rendered; anything the query grows later
 * falls back to the wording the row itself carries.
 */
const RecentEventMessage = ({
  event,
}: {
  event: PlatformDashboardRecentEvent;
}) => {
  switch (event.eventType) {
    case "tenant_created": {
      return <Message message="platform.dashboard.events.tenant_created" />;
    }

    case "operator_role_granted": {
      return (
        <Message message="platform.dashboard.events.operator_role_granted" />
      );
    }

    case "end_user_created": {
      return <Message message="platform.dashboard.events.end_user_created" />;
    }

    default: {
      return event.action;
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

/** The heading of the events section, whether or not the events arrived. */
const EventsHeading = () => (
  <div className="grid gap-1">
    <h2 className="text-xl leading-tight font-medium text-foreground">
      <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
        <Message message="platform.dashboard.events_title" />
      </Suspense>
    </h2>
    <p className="text-sm text-muted-foreground">
      <Suspense fallback={<SkeletonLine className="h-4 w-96" />}>
        <Message message="platform.dashboard.events_description" />
      </Suspense>
    </p>
  </div>
);

/**
 * The same geometry the figures and the events land in: four pairs on one
 * line, then rows under a rule.
 */
const DashboardSkeleton = () => (
  <div className="grid gap-10">
    <FigureLine.Root>
      {(["s1", "s2", "s3", "s4"] as const).map((key) => (
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
      <EventsHeading />
      <div className="divide-y divide-border border-t-2 border-border">
        {Array.from({ length: EVENTS_SKELETON_ROWS }, (_, index) => (
          <div className="py-3" key={index}>
            <Skeleton className="h-5 w-full" />
          </div>
        ))}
      </div>
    </section>
  </div>
);

const DashboardContent = async () => {
  // Timestamps follow the platform default time zone, not the host's or the
  // browser's, so every operator reads the same wall clock.
  const [locale, result, timeZone] = await Promise.all([
    getPlatformLocale(),
    getPlatformDashboardSummary({ recentEventsLimit }),
    getPlatformDisplayTimeZone(),
  ]);

  if (!result.ok) {
    return (
      <SectionError.Root>
        <SectionError.Heading>
          <SectionError.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="platform.dashboard.load_failed" />
            </Suspense>
          </SectionError.Title>
          <SectionError.Description>{result.message}</SectionError.Description>
        </SectionError.Heading>
      </SectionError.Root>
    );
  }

  const { summary } = result;

  return (
    <div className="grid gap-10">
      <FigureLine.Root>
        <FigureLine.Figure>
          <FigureLine.Label>
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <Message message="platform.dashboard.stats.total_label" />
            </Suspense>
          </FigureLine.Label>
          <FigureLine.Value>{summary.totalTenants}</FigureLine.Value>
        </FigureLine.Figure>
        <FigureLine.Figure>
          <FigureLine.Label>
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <Message message="platform.dashboard.stats.active_label" />
            </Suspense>
          </FigureLine.Label>
          <FigureLine.Value>{summary.activeTenants}</FigureLine.Value>
        </FigureLine.Figure>
        <FigureLine.Figure>
          <FigureLine.Label>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="platform.dashboard.stats.suspended_label" />
            </Suspense>
          </FigureLine.Label>
          <FigureLine.Value>{summary.suspendedTenants}</FigureLine.Value>
        </FigureLine.Figure>
        <FigureLine.Figure>
          <FigureLine.Label>
            <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
              <Message message="platform.dashboard.stats.pending_label" />
            </Suspense>
          </FigureLine.Label>
          <FigureLine.Value>{summary.pendingEndUsers}</FigureLine.Value>
        </FigureLine.Figure>
      </FigureLine.Root>

      <section className="grid gap-4">
        <EventsHeading />
        <Table.Root>
          <Table.Header>
            <Table.Row>
              <Table.Head>
                <Suspense fallback={<SkeletonLine className="h-4 w-14" />}>
                  <Message message="platform.dashboard.columns.event" />
                </Suspense>
              </Table.Head>
              <Table.Head>
                <Suspense fallback={<SkeletonLine className="h-4 w-14" />}>
                  <Message message="platform.dashboard.columns.target" />
                </Suspense>
              </Table.Head>
              <Table.Head className="w-52">
                <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                  <Message message="platform.dashboard.columns.actor" />
                </Suspense>
              </Table.Head>
              <Table.Head className="w-52">
                <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                  <Message message="platform.dashboard.columns.at" />
                </Suspense>
              </Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {summary.recentEvents.length === 0 ? (
              <Table.EmptyRow colSpan={4}>
                <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
                  <Message message="platform.dashboard.empty_events" />
                </Suspense>
              </Table.EmptyRow>
            ) : (
              summary.recentEvents.map((event) => {
                const href = buildTargetHref(event);

                return (
                  <Table.Row
                    key={`${event.at}-${event.eventType}-${event.target}`}
                  >
                    <Table.Cell className="font-medium">
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-32" />}
                      >
                        <RecentEventMessage event={event} />
                      </Suspense>
                    </Table.Cell>
                    <Table.Cell>
                      {href ? (
                        <Link
                          className="text-primary underline-offset-4 hover:underline"
                          href={href}
                        >
                          {event.target}
                        </Link>
                      ) : (
                        <span>{event.target || "-"}</span>
                      )}
                    </Table.Cell>
                    <Table.Cell>{event.actor || "system"}</Table.Cell>
                    <Table.Cell>
                      {formatDateTime(event.at, {
                        fallback: "-",
                        locale,
                        timeZone,
                      })}
                    </Table.Cell>
                  </Table.Row>
                );
              })
            )}
          </Table.Body>
        </Table.Root>
      </section>
    </div>
  );
};

const Page = () => (
  <ConsolePage.Root>
    <ConsolePage.Header>
      <ConsolePage.Heading>
        <ConsolePage.Title>
          <Suspense fallback={<SkeletonLine className="h-8 w-72" />}>
            <Message message="platform.dashboard.heading" />
          </Suspense>
        </ConsolePage.Title>
        <ConsolePage.Description>
          <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
            <Message message="platform.dashboard.page_description" />
          </Suspense>
        </ConsolePage.Description>
      </ConsolePage.Heading>
      <ConsolePage.Actions>
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
      </ConsolePage.Actions>
    </ConsolePage.Header>
    <ConsolePage.Content>
      <ConsoleSection.Stack>
        <SetupStatusSection />
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
      </ConsoleSection.Stack>
    </ConsolePage.Content>
  </ConsolePage.Root>
);

export default Page;
