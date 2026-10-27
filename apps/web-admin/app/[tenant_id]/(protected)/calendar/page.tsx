import { ChevronLeftIcon, ChevronRightIcon } from "@publira/icons";
import * as ConsolePage from "@publira/layouts/admin/console-page";
import * as ConsoleSection from "@publira/layouts/admin/console-section";
import { LinkButton } from "@publira/ui-components/button";
import * as EmptyState from "@publira/ui-components/empty-state";
import * as SectionError from "@publira/ui-components/section-error";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { formatPlainYearMonth } from "@publira/utils";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { listEpisodePublications } from "#lib/publishing-calendar";
import { getTenantId } from "#lib/tenant-id";
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";

import { MonthGrid } from "./_components/month-grid";
import {
  calendarMonthPeriod,
  currentCalendarMonth,
  groupByDay,
  shiftCalendarMonth,
  todayIn,
} from "./_lib/month";
import { parseCalendarSearchParams } from "./_lib/search-params";

type CalendarPageProps = PageProps<"/[tenant_id]/calendar">;

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const t = await getMessagesFor(locale);

  return { title: t("admin.calendar.title") };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

const CalendarSkeleton = () => (
  <ConsoleSection.Root>
    <ConsoleSection.Header>
      <ConsoleSection.Heading>
        <SkeletonLine className="h-6 w-40" />
        <SkeletonLine className="h-4 w-96" />
      </ConsoleSection.Heading>
      <ConsoleSection.Actions>
        <Skeleton className="h-9 w-72" />
      </ConsoleSection.Actions>
    </ConsoleSection.Header>
    <Skeleton className="h-[36rem]" />
  </ConsoleSection.Root>
);

const CalendarContent = async ({
  searchParams,
}: Pick<CalendarPageProps, "searchParams">) => {
  const [sp, tenantId] = await Promise.all([searchParams, getTenantId()]);
  const [locale, timeZone] = await Promise.all([
    getLocale(tenantId),
    getTenantDisplayTimeZone(tenantId),
  ]);
  const today = todayIn(timeZone);
  const month =
    parseCalendarSearchParams(sp).month || currentCalendarMonth(timeZone);
  const result = await listEpisodePublications(calendarMonthPeriod(month));

  return (
    <ConsoleSection.Root>
      <ConsoleSection.Header>
        <ConsoleSection.Heading>
          <ConsoleSection.Title>
            {formatPlainYearMonth(month, { locale })}
          </ConsoleSection.Title>
          <ConsoleSection.Description>
            <Suspense fallback={<SkeletonLine className="h-4 w-96" />}>
              <Message
                message="admin.calendar.time_zone_description"
                values={{ time_zone: timeZone }}
              />
            </Suspense>
          </ConsoleSection.Description>
        </ConsoleSection.Heading>
        <ConsoleSection.Actions>
          <LinkButton
            render={
              <Link href={`/calendar?month=${shiftCalendarMonth(month, -1)}`} />
            }
            variant="outline"
          >
            <ChevronLeftIcon aria-hidden="true" className="size-4" />
            <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
              <Message message="admin.calendar.previous_month" />
            </Suspense>
          </LinkButton>
          <LinkButton render={<Link href="/calendar" />} variant="outline">
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="admin.calendar.this_month" />
            </Suspense>
          </LinkButton>
          <LinkButton
            render={
              <Link href={`/calendar?month=${shiftCalendarMonth(month, 1)}`} />
            }
            variant="outline"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
              <Message message="admin.calendar.next_month" />
            </Suspense>
            <ChevronRightIcon aria-hidden="true" className="size-4" />
          </LinkButton>
        </ConsoleSection.Actions>
      </ConsoleSection.Header>
      {result.ok ? (
        <>
          {result.episodes.length === 0 ? (
            <EmptyState.Root>
              <EmptyState.Heading>
                <EmptyState.Title>
                  <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                    <Message message="admin.calendar.empty_title" />
                  </Suspense>
                </EmptyState.Title>
                <EmptyState.Description>
                  <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
                    <Message message="admin.calendar.empty_description" />
                  </Suspense>
                </EmptyState.Description>
              </EmptyState.Heading>
            </EmptyState.Root>
          ) : null}
          <MonthGrid
            days={groupByDay(result.episodes, timeZone)}
            locale={locale}
            month={month}
            today={today}
          />
        </>
      ) : (
        <SectionError.Root>
          <SectionError.Heading>
            <SectionError.Title>
              <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                <Message message="admin.calendar.section_error" />
              </Suspense>
            </SectionError.Title>
            <SectionError.Description>
              {result.message}
            </SectionError.Description>
          </SectionError.Heading>
        </SectionError.Root>
      )}
    </ConsoleSection.Root>
  );
};

const CalendarPage = ({ searchParams }: CalendarPageProps) => (
  <ConsolePage.Root>
    <ConsolePage.Header>
      <ConsolePage.Heading>
        <ConsolePage.Title>
          <Suspense fallback={<SkeletonLine className="h-7 w-32" />}>
            <Message message="admin.calendar.title" />
          </Suspense>
        </ConsolePage.Title>
        <ConsolePage.Description>
          <Suspense fallback={<SkeletonLine className="h-4 w-96" />}>
            <Message message="admin.calendar.page_description" />
          </Suspense>
        </ConsolePage.Description>
      </ConsolePage.Heading>
    </ConsolePage.Header>
    <ConsolePage.Content>
      <SectionErrorBoundary
        title={
          <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
            <Message message="admin.calendar.section_error" />
          </Suspense>
        }
      >
        <Suspense fallback={<CalendarSkeleton />}>
          <CalendarContent searchParams={searchParams} />
        </Suspense>
      </SectionErrorBoundary>
    </ConsolePage.Content>
  </ConsolePage.Root>
);

export default CalendarPage;
