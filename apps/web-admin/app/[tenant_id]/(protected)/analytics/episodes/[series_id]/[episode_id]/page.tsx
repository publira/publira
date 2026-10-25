import type { Locale } from "@publira/i18n";
import * as ConsolePage from "@publira/layouts/admin/console-page";
import * as ConsoleSection from "@publira/layouts/admin/console-section";
import { LinkButton } from "@publira/ui-components/button";
import * as Chart from "@publira/ui-components/chart";
import * as FigureLine from "@publira/ui-components/figure-line";
import * as SectionError from "@publira/ui-components/section-error";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import * as Table from "@publira/ui-components/table";
import { formatPercent, formatPlainDate } from "@publira/utils";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import {
  parseRouteParams,
  routeParamString,
} from "@publira/utils/route-params";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";

import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import { getEpisodeDropOff } from "#lib/engagement";
import { getEpisode } from "#lib/episode";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { buildQueryString } from "#lib/query-string";
import { getSeries } from "#lib/series";
import { getTenantId } from "#lib/tenant-id";
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";

import { PeriodForm } from "../../../_components/period-form";
import { SortHead } from "../../../_components/sort-head";
import { formatCount } from "../../../_lib/format";
import {
  parsePeriodSearchParams,
  resolveAnalyticsPeriod,
} from "../../../_lib/period";
import {
  nextSort,
  parseSortSearchParams,
  sortRows,
  sortSearchParams,
} from "../../../_lib/sort";
import type { SortColumns } from "../../../_lib/sort";
import { toDropOffRows } from "./_lib/drop-off-rows";
import type { DropOffRow } from "./_lib/drop-off-rows";

type DropOffPageProps =
  PageProps<"/[tenant_id]/analytics/episodes/[series_id]/[episode_id]">;

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const t = await getMessagesFor(locale);

  return { title: t("admin.analytics.drop_off.title") };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id", "series_id", "episode_id");

const dropOffParamsSchema = z.object({
  episode_id: routeParamString(),
  series_id: routeParamString(),
});

const resolveDropOffParams = async (params: DropOffPageProps["params"]) => {
  const parsed = parseRouteParams(dropOffParamsSchema, await params);
  if (!parsed) {
    notFound();
  }
  return parsed;
};

type DropOffColumn = "left" | "page" | "readers";

const dropOffColumns: SortColumns<DropOffColumn> = {
  left: "desc",
  page: "asc",
  readers: "desc",
};

const dropOffValue = (row: DropOffRow, column: DropOffColumn): number => {
  switch (column) {
    case "left": {
      return row.leftCount;
    }
    case "page": {
      return row.pageIndex;
    }
    case "readers": {
      return row.readerCount;
    }
    default: {
      return column satisfies never;
    }
  }
};

/** The page as the console numbers it, from one. */
const PageNumber = ({
  pageCount,
  pageIndex,
}: {
  pageCount: number;
  pageIndex: number;
}) =>
  pageIndex < pageCount ? (
    <Message
      message="admin.analytics.drop_off.page_number"
      values={{ page: pageIndex + 1 }}
    />
  ) : (
    <Message
      message="admin.analytics.drop_off.page_number_removed"
      values={{ page: pageIndex + 1 }}
    />
  );

const ReaderShare = ({
  first,
  locale,
  readers,
}: {
  first: number;
  locale: Locale;
  readers: number;
}) =>
  first > 0 ? (
    formatPercent(readers / first, { locale })
  ) : (
    <Message message="admin.analytics.drop_off.share_unavailable" />
  );

const DropOffContext = async ({ params }: Pick<DropOffPageProps, "params">) => {
  const { episode_id, series_id } = await resolveDropOffParams(params);
  const [episode, series] = await Promise.all([
    getEpisode({ publicId: episode_id, seriesPublicId: series_id }),
    getSeries({ publicId: series_id }),
  ]);
  if ((!episode.ok && episode.notFound) || (!series.ok && series.notFound)) {
    notFound();
  }
  // The context only names the episode, so a failed read leaves it out
  // rather than taking the report down with it.
  if (!(episode.ok && series.ok)) {
    return null;
  }

  return (
    <Message
      message="admin.analytics.drop_off.context"
      values={{ episode: episode.episode.title, series: series.series.title }}
    />
  );
};

const DropOffSkeleton = () => (
  <ConsoleSection.Stack>
    <div className="flex flex-wrap items-end gap-4">
      <Skeleton className="h-16 w-44" />
      <Skeleton className="h-16 w-44" />
    </div>
    <FigureLine.Root>
      {(["skeleton-1", "skeleton-2", "skeleton-3"] as const).map((key) => (
        <FigureLine.Figure key={key}>
          <FigureLine.Label>
            <SkeletonLine className="h-4 w-24" />
          </FigureLine.Label>
          <FigureLine.Value>
            <SkeletonLine className="h-6 w-12" />
          </FigureLine.Value>
        </FigureLine.Figure>
      ))}
    </FigureLine.Root>
    <Skeleton className="h-40" />
    <Table.Skeleton />
  </ConsoleSection.Stack>
);

const DropOffContent = async ({ params, searchParams }: DropOffPageProps) => {
  const [{ episode_id, series_id }, sp, tenantId] = await Promise.all([
    resolveDropOffParams(params),
    searchParams,
    getTenantId(),
  ]);
  const [locale, timeZone] = await Promise.all([
    getLocale(tenantId),
    getTenantDisplayTimeZone(tenantId),
  ]);
  const path = `/analytics/episodes/${series_id}/${episode_id}`;
  const { from, to } = parsePeriodSearchParams(sp);
  const period = resolveAnalyticsPeriod({ from, to }, timeZone);
  const sort = parseSortSearchParams(sp, dropOffColumns, "page");

  const form = (
    <PeriodForm period={period} resetHref={path} timeZone={timeZone} />
  );
  if (!period.ok) {
    return <ConsoleSection.Stack>{form}</ConsoleSection.Stack>;
  }

  const [result, t] = await Promise.all([
    getEpisodeDropOff(tenantId, locale, {
      end: period.end,
      episodePublicId: episode_id,
      start: period.start,
    }),
    getMessagesFor(locale),
  ]);
  if (!result.ok && result.notFound) {
    notFound();
  }
  if (!result.ok) {
    await redirectToLoginIfSessionRejected(result);
    return (
      <ConsoleSection.Stack>
        {form}
        <SectionError.Root>
          <SectionError.Heading>
            <SectionError.Title>
              <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                <Message message="admin.analytics.drop_off.section_error" />
              </Suspense>
            </SectionError.Title>
            <SectionError.Description>
              {result.message}
            </SectionError.Description>
          </SectionError.Heading>
        </SectionError.Root>
      </ConsoleSection.Stack>
    );
  }

  const rows = toDropOffRows(result.pages);
  const firstReaders = result.pages[0]?.readerCount ?? 0;
  const lastPage =
    result.pageCount > 0
      ? result.pages.find((page) => page.pageIndex === result.pageCount - 1)
      : undefined;
  const sorted = (column: DropOffColumn) =>
    sort.column === column ? sort.order : null;
  const hrefFor = (column: DropOffColumn) =>
    `${path}${buildQueryString({
      from,
      to,
      ...sortSearchParams(nextSort(sort, column, dropOffColumns)),
    })}`;

  return (
    <ConsoleSection.Stack>
      {form}

      <ConsoleSection.Root>
        <p className="max-w-3xl text-sm text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-56" />}>
            <Message
              message="admin.analytics.period.covered"
              values={{
                end: formatPlainDate(result.period.end, { locale }),
                start: formatPlainDate(result.period.start, { locale }),
                time_zone: result.period.timeZone,
              }}
            />
          </Suspense>
        </p>
        <FigureLine.Root>
          <FigureLine.Figure>
            <FigureLine.Label>
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="admin.analytics.drop_off.readers_label" />
              </Suspense>
            </FigureLine.Label>
            <FigureLine.Value>
              {formatCount(firstReaders, locale)}
            </FigureLine.Value>
          </FigureLine.Figure>
          <FigureLine.Figure>
            <FigureLine.Label>
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="admin.analytics.drop_off.last_page_label" />
              </Suspense>
            </FigureLine.Label>
            <FigureLine.Value>
              {formatCount(lastPage?.readerCount ?? 0, locale)}
            </FigureLine.Value>
          </FigureLine.Figure>
          <FigureLine.Figure>
            <FigureLine.Label>
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="admin.analytics.drop_off.page_count_label" />
              </Suspense>
            </FigureLine.Label>
            <FigureLine.Value>
              {formatCount(result.pageCount, locale)}
            </FigureLine.Value>
          </FigureLine.Figure>
        </FigureLine.Root>
        {rows.length > 0 ? (
          <Chart.Root>
            <Chart.Steps
              aria-label={t("admin.analytics.drop_off.chart_label")}
              values={rows.map((row) => row.readerCount)}
            />
            <Chart.Axis>
              <Chart.AxisLabel>
                <Suspense fallback={<SkeletonLine className="h-3 w-12" />}>
                  <PageNumber
                    pageCount={result.pageCount}
                    pageIndex={rows[0]?.pageIndex ?? 0}
                  />
                </Suspense>
              </Chart.AxisLabel>
              <Chart.AxisLabel>
                <Suspense fallback={<SkeletonLine className="h-3 w-12" />}>
                  <PageNumber
                    pageCount={result.pageCount}
                    pageIndex={rows.at(-1)?.pageIndex ?? 0}
                  />
                </Suspense>
              </Chart.AxisLabel>
            </Chart.Axis>
            <Chart.Caption>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="admin.analytics.drop_off.chart_label" />
              </Suspense>
            </Chart.Caption>
          </Chart.Root>
        ) : null}
        <p className="max-w-3xl text-xs text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-56" />}>
            <Message message="admin.analytics.drop_off.definition" />
          </Suspense>
        </p>
      </ConsoleSection.Root>

      <ConsoleSection.Root>
        <ConsoleSection.Header>
          <ConsoleSection.Heading>
            <ConsoleSection.Title>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="admin.analytics.drop_off.list_title" />
              </Suspense>
            </ConsoleSection.Title>
          </ConsoleSection.Heading>
        </ConsoleSection.Header>
        <Table.Root>
          <Table.Header>
            <Table.Row>
              <SortHead href={hrefFor("page")} sorted={sorted("page")}>
                <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                  <Message message="admin.analytics.drop_off.columns.page" />
                </Suspense>
              </SortHead>
              <SortHead
                className="w-40"
                href={hrefFor("readers")}
                sorted={sorted("readers")}
              >
                <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                  <Message message="admin.analytics.drop_off.columns.readers" />
                </Suspense>
              </SortHead>
              <Table.Head className="w-40">
                <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                  <Message message="admin.analytics.drop_off.columns.share" />
                </Suspense>
              </Table.Head>
              <SortHead
                className="w-40"
                href={hrefFor("left")}
                sorted={sorted("left")}
              >
                <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                  <Message message="admin.analytics.drop_off.columns.left" />
                </Suspense>
              </SortHead>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.length === 0 ? (
              <Table.EmptyRow colSpan={4}>
                <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
                  <Message message="admin.analytics.drop_off.empty" />
                </Suspense>
              </Table.EmptyRow>
            ) : (
              sortRows(rows, sort, dropOffValue, locale).map((row) => (
                <Table.Row key={row.pageIndex}>
                  <Table.Cell>
                    <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                      <PageNumber
                        pageCount={result.pageCount}
                        pageIndex={row.pageIndex}
                      />
                    </Suspense>
                  </Table.Cell>
                  <Table.Cell>
                    {formatCount(row.readerCount, locale)}
                  </Table.Cell>
                  <Table.Cell>
                    <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                      <ReaderShare
                        first={firstReaders}
                        locale={locale}
                        readers={row.readerCount}
                      />
                    </Suspense>
                  </Table.Cell>
                  <Table.Cell>{formatCount(row.leftCount, locale)}</Table.Cell>
                </Table.Row>
              ))
            )}
          </Table.Body>
        </Table.Root>
      </ConsoleSection.Root>
    </ConsoleSection.Stack>
  );
};

const DropOffPage = ({ params, searchParams }: DropOffPageProps) => (
  <ConsolePage.Root>
    <ConsolePage.Header>
      <ConsolePage.Heading>
        <ConsolePage.Context>
          <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
            <DropOffContext params={params} />
          </Suspense>
        </ConsolePage.Context>
        <ConsolePage.Title>
          <Suspense fallback={<SkeletonLine className="h-7 w-32" />}>
            <Message message="admin.analytics.drop_off.title" />
          </Suspense>
        </ConsolePage.Title>
        <ConsolePage.Description>
          <Suspense fallback={<SkeletonLine className="h-4 w-96" />}>
            <Message message="admin.analytics.drop_off.page_description" />
          </Suspense>
        </ConsolePage.Description>
      </ConsolePage.Heading>
      <ConsolePage.Actions>
        <LinkButton
          render={<Link href="/analytics/episodes" />}
          variant="outline"
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
            <Message message="admin.analytics.drop_off.back" />
          </Suspense>
        </LinkButton>
      </ConsolePage.Actions>
    </ConsolePage.Header>
    <ConsolePage.Content>
      <SectionErrorBoundary
        title={
          <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
            <Message message="admin.analytics.drop_off.section_error" />
          </Suspense>
        }
      >
        <Suspense fallback={<DropOffSkeleton />}>
          <DropOffContent params={params} searchParams={searchParams} />
        </Suspense>
      </SectionErrorBoundary>
    </ConsolePage.Content>
  </ConsolePage.Root>
);

export default DropOffPage;
