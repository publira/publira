import type { Locale } from "@publira/i18n";
import * as ConsolePage from "@publira/layouts/admin/console-page";
import * as ConsoleSection from "@publira/layouts/admin/console-section";
import { LinkButton } from "@publira/ui-components/button";
import * as Chart from "@publira/ui-components/chart";
import * as FigureLine from "@publira/ui-components/figure-line";
import * as SectionError from "@publira/ui-components/section-error";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import * as Table from "@publira/ui-components/table";
import { formatPlainDate } from "@publira/utils";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import { searchParamEnum } from "@publira/utils/search-params";
import type { Metadata } from "next";
import { Suspense } from "react";

import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { TenantAdminOnly } from "#components/tenant-role-gate";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import { getAudienceStats, statsCsvPath } from "#lib/engagement";
import type { AudienceGroup, AudienceStatsItem } from "#lib/engagement";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { buildQueryString } from "#lib/query-string";
import { getTenantId } from "#lib/tenant-id";
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";

import * as GroupNav from "../_components/group-nav";
import { PeriodForm } from "../_components/period-form";
import { SortHead } from "../_components/sort-head";
import { formatCount, formatRating } from "../_lib/format";
import {
  parsePeriodSearchParams,
  resolveAnalyticsPeriod,
} from "../_lib/period";
import {
  nextSort,
  parseSortSearchParams,
  sortRows,
  sortSearchParams,
} from "../_lib/sort";
import type { SortColumns, SortState } from "../_lib/sort";

type AudiencePageProps = PageProps<"/[tenant_id]/analytics/audience">;

const PATH = "/analytics/audience";

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const t = await getMessagesFor(locale);

  return { title: t("admin.analytics.audience.title") };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

type AudienceColumn =
  | "completions"
  | "date"
  | "followed"
  | "followers"
  | "rating"
  | "rating_count"
  | "reactions"
  | "series"
  | "unfollowed"
  | "views";

const figureColumns = {
  completions: "desc",
  followed: "desc",
  followers: "desc",
  reactions: "desc",
  unfollowed: "desc",
  views: "desc",
} as const;

/** The columns of each breakdown, and the one it is sorted by at first. */
const audienceTables: Record<
  AudienceGroup,
  { columns: SortColumns<AudienceColumn>; fallback: AudienceColumn }
> = {
  day: { columns: { date: "asc", ...figureColumns }, fallback: "date" },
  series: {
    columns: {
      rating: "desc",
      rating_count: "desc",
      series: "asc",
      ...figureColumns,
    },
    fallback: "followers",
  },
};

const audienceGroups = ["day", "series"] as const;

const groupSchema = searchParamEnum(audienceGroups, { fallback: "day" });

const audienceValue = (
  row: AudienceStatsItem,
  column: AudienceColumn
): number | string => {
  switch (column) {
    case "completions": {
      return row.completeCount;
    }
    case "date": {
      return row.date;
    }
    case "followed": {
      return row.followedCount;
    }
    case "followers": {
      return row.followerCount;
    }
    case "rating": {
      // An unrated series sorts below every rated one, whichever way.
      return row.ratingAverage ?? 0;
    }
    case "rating_count": {
      return row.ratingCount;
    }
    case "reactions": {
      return row.reactionCount;
    }
    case "series": {
      return row.seriesTitle;
    }
    case "unfollowed": {
      return row.unfollowedCount;
    }
    case "views": {
      return row.viewCount;
    }
    default: {
      return column satisfies never;
    }
  }
};

const AudienceSkeleton = () => (
  <ConsoleSection.Stack>
    <div className="flex flex-wrap items-end gap-4">
      <Skeleton className="h-16 w-44" />
      <Skeleton className="h-16 w-44" />
    </div>
    <FigureLine.Root>
      {(["skeleton-1", "skeleton-2", "skeleton-3", "skeleton-4"] as const).map(
        (key) => (
          <FigureLine.Figure key={key}>
            <FigureLine.Label>
              <SkeletonLine className="h-4 w-24" />
            </FigureLine.Label>
            <FigureLine.Value>
              <SkeletonLine className="h-6 w-12" />
            </FigureLine.Value>
          </FigureLine.Figure>
        )
      )}
    </FigureLine.Root>
    <Skeleton className="h-40" />
    <Table.Skeleton />
  </ConsoleSection.Stack>
);

const AudienceTable = ({
  group,
  hrefFor,
  locale,
  rows,
  sort,
}: {
  group: AudienceGroup;
  hrefFor: (column: AudienceColumn) => string;
  locale: Locale;
  rows: AudienceStatsItem[];
  sort: SortState<AudienceColumn>;
}) => {
  const sorted = (column: AudienceColumn) =>
    sort.column === column ? sort.order : null;

  return (
    <Table.Root>
      <Table.Header>
        <Table.Row>
          {group === "day" ? (
            <SortHead href={hrefFor("date")} sorted={sorted("date")}>
              <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                <Message message="admin.analytics.audience.columns.date" />
              </Suspense>
            </SortHead>
          ) : (
            <SortHead href={hrefFor("series")} sorted={sorted("series")}>
              <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                <Message message="admin.analytics.audience.columns.series" />
              </Suspense>
            </SortHead>
          )}
          <SortHead href={hrefFor("followers")} sorted={sorted("followers")}>
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="admin.analytics.audience.columns.followers" />
            </Suspense>
          </SortHead>
          <SortHead href={hrefFor("followed")} sorted={sorted("followed")}>
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="admin.analytics.audience.columns.followed" />
            </Suspense>
          </SortHead>
          <SortHead href={hrefFor("unfollowed")} sorted={sorted("unfollowed")}>
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="admin.analytics.audience.columns.unfollowed" />
            </Suspense>
          </SortHead>
          <SortHead href={hrefFor("views")} sorted={sorted("views")}>
            <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
              <Message message="admin.analytics.audience.columns.views" />
            </Suspense>
          </SortHead>
          <SortHead
            href={hrefFor("completions")}
            sorted={sorted("completions")}
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="admin.analytics.audience.columns.completions" />
            </Suspense>
          </SortHead>
          <SortHead href={hrefFor("reactions")} sorted={sorted("reactions")}>
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="admin.analytics.audience.columns.reactions" />
            </Suspense>
          </SortHead>
          {group === "series" ? (
            <SortHead href={hrefFor("rating")} sorted={sorted("rating")}>
              <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                <Message message="admin.analytics.audience.columns.rating" />
              </Suspense>
            </SortHead>
          ) : null}
          {group === "series" ? (
            <SortHead
              href={hrefFor("rating_count")}
              sorted={sorted("rating_count")}
            >
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="admin.analytics.audience.columns.rating_count" />
              </Suspense>
            </SortHead>
          ) : null}
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {rows.length === 0 ? (
          <Table.EmptyRow colSpan={group === "series" ? 9 : 7}>
            <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
              <Message message="admin.analytics.audience.empty" />
            </Suspense>
          </Table.EmptyRow>
        ) : (
          sortRows(rows, sort, audienceValue, locale).map((row) => (
            <Table.Row key={row.date || row.seriesPublicId}>
              {group === "day" ? (
                <Table.Cell>{formatPlainDate(row.date, { locale })}</Table.Cell>
              ) : (
                <Table.Cell className="font-medium">
                  {row.seriesTitle}
                </Table.Cell>
              )}
              <Table.Cell>{formatCount(row.followerCount, locale)}</Table.Cell>
              <Table.Cell>{formatCount(row.followedCount, locale)}</Table.Cell>
              <Table.Cell>
                {formatCount(row.unfollowedCount, locale)}
              </Table.Cell>
              <Table.Cell>{formatCount(row.viewCount, locale)}</Table.Cell>
              <Table.Cell>{formatCount(row.completeCount, locale)}</Table.Cell>
              <Table.Cell>{formatCount(row.reactionCount, locale)}</Table.Cell>
              {group === "series" ? (
                <Table.Cell>
                  {row.ratingAverage === null ? (
                    <Suspense fallback={<SkeletonLine className="h-4 w-4" />}>
                      <Message message="admin.analytics.audience.rating_none" />
                    </Suspense>
                  ) : (
                    formatRating(row.ratingAverage, locale)
                  )}
                </Table.Cell>
              ) : null}
              {group === "series" ? (
                <Table.Cell>{formatCount(row.ratingCount, locale)}</Table.Cell>
              ) : null}
            </Table.Row>
          ))
        )}
      </Table.Body>
    </Table.Root>
  );
};

const AudienceContent = async ({
  searchParams,
}: Pick<AudiencePageProps, "searchParams">) => {
  const [sp, tenantId] = await Promise.all([searchParams, getTenantId()]);
  const [locale, timeZone] = await Promise.all([
    getLocale(tenantId),
    getTenantDisplayTimeZone(tenantId),
  ]);
  const { from, to } = parsePeriodSearchParams(sp);
  const period = resolveAnalyticsPeriod({ from, to }, timeZone);
  const group = groupSchema.parse(sp.group);
  const table = audienceTables[group];
  const sort = parseSortSearchParams(sp, table.columns, table.fallback);

  const form = (
    <PeriodForm period={period} resetHref={PATH} timeZone={timeZone}>
      {group === "day" ? null : (
        <input name="group" type="hidden" value={group} />
      )}
    </PeriodForm>
  );
  if (!period.ok) {
    return <ConsoleSection.Stack>{form}</ConsoleSection.Stack>;
  }

  const dates = { end: period.end, start: period.start };
  const [daily, breakdown, t] = await Promise.all([
    getAudienceStats(tenantId, locale, { ...dates, group: "day" }),
    group === "day"
      ? null
      : getAudienceStats(tenantId, locale, { ...dates, group }),
    getMessagesFor(locale),
  ]);
  await redirectToLoginIfSessionRejected(
    daily,
    ...(breakdown ? [breakdown] : [])
  );

  if (!daily.ok) {
    return (
      <ConsoleSection.Stack>
        {form}
        <SectionError.Root>
          <SectionError.Heading>
            <SectionError.Title>
              <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                <Message message="admin.analytics.audience.section_error" />
              </Suspense>
            </SectionError.Title>
            <SectionError.Description>{daily.message}</SectionError.Description>
          </SectionError.Heading>
        </SectionError.Root>
      </ConsoleSection.Stack>
    );
  }

  const rows = breakdown ?? daily;
  const query = { from, group: group === "day" ? "" : group, to };
  const hrefFor = (column: AudienceColumn) =>
    `${PATH}${buildQueryString({
      ...query,
      ...sortSearchParams(nextSort(sort, column, table.columns)),
    })}`;
  const groupHref = (target: AudienceGroup) =>
    `${PATH}${buildQueryString({
      ...query,
      group: target === "day" ? "" : target,
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
                end: formatPlainDate(daily.period.end, { locale }),
                start: formatPlainDate(daily.period.start, { locale }),
                time_zone: daily.period.timeZone,
              }}
            />
          </Suspense>
        </p>
        <FigureLine.Root>
          <FigureLine.Figure>
            <FigureLine.Label>
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="admin.analytics.audience.followers_label" />
              </Suspense>
            </FigureLine.Label>
            <FigureLine.Value>
              {formatCount(daily.totals.followerCount, locale)}
            </FigureLine.Value>
          </FigureLine.Figure>
          <FigureLine.Figure>
            <FigureLine.Label>
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="admin.analytics.audience.views_label" />
              </Suspense>
            </FigureLine.Label>
            <FigureLine.Value>
              {formatCount(daily.totals.viewCount, locale)}
            </FigureLine.Value>
          </FigureLine.Figure>
          <FigureLine.Figure>
            <FigureLine.Label>
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="admin.analytics.audience.completions_label" />
              </Suspense>
            </FigureLine.Label>
            <FigureLine.Value>
              {formatCount(daily.totals.completeCount, locale)}
            </FigureLine.Value>
          </FigureLine.Figure>
          <FigureLine.Figure>
            <FigureLine.Label>
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="admin.analytics.audience.reactions_label" />
              </Suspense>
            </FigureLine.Label>
            <FigureLine.Value>
              {formatCount(daily.totals.reactionCount, locale)}
            </FigureLine.Value>
          </FigureLine.Figure>
        </FigureLine.Root>
        <Chart.Root>
          <Chart.Line
            aria-label={t("admin.analytics.audience.chart_label")}
            values={daily.rows.map((row) => row.followerCount)}
          />
          <Chart.Axis>
            <Chart.AxisLabel>
              {formatPlainDate(daily.period.start, { locale })}
            </Chart.AxisLabel>
            <Chart.AxisLabel>
              {formatPlainDate(daily.period.end, { locale })}
            </Chart.AxisLabel>
          </Chart.Axis>
          <Chart.Caption>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.analytics.audience.chart_label" />
            </Suspense>
          </Chart.Caption>
        </Chart.Root>
        <p className="max-w-3xl text-xs text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-56" />}>
            <Message message="admin.analytics.audience.definition" />
          </Suspense>
        </p>
      </ConsoleSection.Root>

      <ConsoleSection.Root>
        <ConsoleSection.Header>
          <ConsoleSection.Heading>
            <ConsoleSection.Title>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="admin.analytics.audience.breakdown_title" />
              </Suspense>
            </ConsoleSection.Title>
          </ConsoleSection.Heading>
          <ConsoleSection.Actions>
            <GroupNav.Root
              aria-label={t("admin.analytics.audience.group_aria")}
            >
              <GroupNav.Link current={group === "day"} href={groupHref("day")}>
                <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                  <Message message="admin.analytics.audience.group_day" />
                </Suspense>
              </GroupNav.Link>
              <GroupNav.Link
                current={group === "series"}
                href={groupHref("series")}
              >
                <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                  <Message message="admin.analytics.audience.group_series" />
                </Suspense>
              </GroupNav.Link>
            </GroupNav.Root>
            {/* The export is a tenant admin's, whichever report it writes. */}
            <TenantAdminOnly>
              <LinkButton
                href={statsCsvPath({ group, kind: "audience" }, dates)}
                size="sm"
                variant="outline"
              >
                <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                  <Message message="admin.analytics.export.button" />
                </Suspense>
              </LinkButton>
            </TenantAdminOnly>
          </ConsoleSection.Actions>
        </ConsoleSection.Header>
        {rows.ok ? (
          <AudienceTable
            group={group}
            hrefFor={hrefFor}
            locale={locale}
            rows={rows.rows}
            sort={sort}
          />
        ) : (
          <SectionError.Root>
            <SectionError.Heading>
              <SectionError.Title>
                <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                  <Message message="admin.analytics.audience.section_error" />
                </Suspense>
              </SectionError.Title>
              <SectionError.Description>
                {rows.message}
              </SectionError.Description>
            </SectionError.Heading>
          </SectionError.Root>
        )}
      </ConsoleSection.Root>
    </ConsoleSection.Stack>
  );
};

const AudiencePage = ({ searchParams }: AudiencePageProps) => (
  <ConsolePage.Root>
    <ConsolePage.Header>
      <ConsolePage.Heading>
        <ConsolePage.Title>
          <Suspense fallback={<SkeletonLine className="h-7 w-32" />}>
            <Message message="admin.analytics.audience.title" />
          </Suspense>
        </ConsolePage.Title>
        <ConsolePage.Description>
          <Suspense fallback={<SkeletonLine className="h-4 w-96" />}>
            <Message message="admin.analytics.audience.page_description" />
          </Suspense>
        </ConsolePage.Description>
      </ConsolePage.Heading>
    </ConsolePage.Header>
    <ConsolePage.Content>
      <SectionErrorBoundary
        title={
          <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
            <Message message="admin.analytics.audience.section_error" />
          </Suspense>
        }
      >
        <Suspense fallback={<AudienceSkeleton />}>
          <AudienceContent searchParams={searchParams} />
        </Suspense>
      </SectionErrorBoundary>
    </ConsolePage.Content>
  </ConsolePage.Root>
);

export default AudiencePage;
