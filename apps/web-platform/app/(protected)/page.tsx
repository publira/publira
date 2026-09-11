import { getMessage } from "@publira/i18n";
import { LinkButton } from "@publira/ui-components/button";
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
  TableEmptyRow,
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
  PlatformPageHeader,
  PlatformPageHeading,
  PlatformPageTitle,
} from "#components/platform-page";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import { getPlatformDashboardSummary } from "#lib/dashboard";
import type { PlatformDashboardRecentEvent } from "#lib/dashboard";
import { getPlatformLocale, loadPlatformMessages } from "#lib/locale";
import { getPlatformDisplayTimeZone } from "#lib/platform-settings";

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getPlatformLocale();
  const messages = await loadPlatformMessages(locale);

  return { title: getMessage(messages, "platform.dashboard.title") };
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
    <FigureLine>
      {(["s1", "s2", "s3", "s4"] as const).map((key) => (
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
  const locale = await getPlatformLocale();
  const [result, timeZone] = await Promise.all([
    getPlatformDashboardSummary({ locale, recentEventsLimit }),
    getPlatformDisplayTimeZone(),
  ]);

  await redirectToLoginIfSessionRejected(result);

  if (!result.ok) {
    return (
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
    );
  }

  const { summary } = result;

  return (
    <div className="grid gap-10">
      <FigureLine>
        <Figure>
          <FigureLabel>
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <Message message="platform.dashboard.stats.total_label" />
            </Suspense>
          </FigureLabel>
          <FigureValue>{summary.totalTenants}</FigureValue>
        </Figure>
        <Figure>
          <FigureLabel>
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <Message message="platform.dashboard.stats.active_label" />
            </Suspense>
          </FigureLabel>
          <FigureValue>{summary.activeTenants}</FigureValue>
        </Figure>
        <Figure>
          <FigureLabel>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="platform.dashboard.stats.suspended_label" />
            </Suspense>
          </FigureLabel>
          <FigureValue>{summary.suspendedTenants}</FigureValue>
        </Figure>
        <Figure>
          <FigureLabel>
            <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
              <Message message="platform.dashboard.stats.pending_label" />
            </Suspense>
          </FigureLabel>
          <FigureValue>{summary.pendingEndUsers}</FigureValue>
        </Figure>
      </FigureLine>

      <section className="grid gap-4">
        <EventsHeading />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <Suspense fallback={<SkeletonLine className="h-4 w-14" />}>
                  <Message message="platform.dashboard.columns.event" />
                </Suspense>
              </TableHead>
              <TableHead>
                <Suspense fallback={<SkeletonLine className="h-4 w-14" />}>
                  <Message message="platform.dashboard.columns.target" />
                </Suspense>
              </TableHead>
              <TableHead className="w-52">
                <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                  <Message message="platform.dashboard.columns.actor" />
                </Suspense>
              </TableHead>
              <TableHead className="w-52">
                <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                  <Message message="platform.dashboard.columns.at" />
                </Suspense>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {summary.recentEvents.length === 0 ? (
              <TableEmptyRow colSpan={4}>
                <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
                  <Message message="platform.dashboard.empty_events" />
                </Suspense>
              </TableEmptyRow>
            ) : (
              summary.recentEvents.map((event) => {
                const href = buildTargetHref(event);

                return (
                  <TableRow
                    key={`${event.at}-${event.eventType}-${event.target}`}
                  >
                    <TableCell className="font-medium">
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-32" />}
                      >
                        <RecentEventMessage event={event} />
                      </Suspense>
                    </TableCell>
                    <TableCell>
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
      </section>
    </div>
  );
};

const Page = () => (
  <PlatformPage>
    <PlatformPageHeader>
      <PlatformPageHeading>
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
