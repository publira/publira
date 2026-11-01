import type { Locale } from "@publira/i18n";
import * as ConsolePage from "@publira/layouts/admin/console-page";
import * as ConsoleSection from "@publira/layouts/admin/console-section";
import { LinkButton } from "@publira/ui-components/button";
import * as Chart from "@publira/ui-components/chart";
import * as FigureLine from "@publira/ui-components/figure-line";
import * as SectionError from "@publira/ui-components/section-error";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import * as Table from "@publira/ui-components/table";
import { formatPlainDate, formatPrice } from "@publira/utils";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import { searchParamEnum } from "@publira/utils/search-params";
import type { Metadata } from "next";
import { Suspense } from "react";

import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import {
  TenantAdminRoute,
  TenantRoleRouteSkeleton,
} from "#components/tenant-role-gate";
import {
  isSignedInTenantAdmin,
  redirectToLoginIfSessionRejected,
} from "#lib/auth-session";
import { getRevenueStats, statsCsvPath } from "#lib/engagement";
import type {
  RevenueGroup,
  RevenueStatsItem,
  RevenueStatsTotalsItem,
} from "#lib/engagement";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { buildQueryString } from "#lib/query-string";
import { getTenantId } from "#lib/tenant-id";
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";

import * as GroupNav from "../_components/group-nav";
import { PeriodForm } from "../_components/period-form";
import { SortHead } from "../_components/sort-head";
import { formatCount } from "../_lib/format";
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

type RevenuePageProps = PageProps<"/[tenant_id]/analytics/revenue">;

const PATH = "/analytics/revenue";

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();

  const [locale, isAdmin] = await Promise.all([
    getLocale(tenantId),
    isSignedInTenantAdmin(tenantId),
  ]);

  const t = await getMessagesFor(locale);

  return {
    title: isAdmin
      ? t("admin.analytics.revenue.title")
      : t("admin.not_found.title"),
  };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

type RevenueColumn =
  | "date"
  | "episode"
  | "gross"
  | "net"
  | "purchase_count"
  | "refunded"
  | "series"
  | "subscription"
  | "subscription_refunded";

const figureColumns = {
  gross: "desc",
  net: "desc",
  purchase_count: "desc",
  refunded: "desc",
} as const;

const subscriptionColumns = {
  subscription: "desc",
  subscription_refunded: "desc",
} as const;

/** The columns a breakdown can be sorted by, and the one it is at first. */
interface RevenueSortColumns {
  columns: SortColumns<RevenueColumn>;
  fallback: RevenueColumn;
}

/**
 * The columns of each breakdown. Only a day carries subscription payments, and
 * only a period that has any shows their columns.
 */
const revenueSortColumns = (
  group: RevenueGroup,
  withSubscriptions: boolean
): RevenueSortColumns => {
  switch (group) {
    case "day": {
      const columns = { date: "asc", ...figureColumns } as const;

      return {
        columns: withSubscriptions
          ? { ...columns, ...subscriptionColumns }
          : columns,
        fallback: "date",
      };
    }

    case "episode": {
      return {
        columns: { episode: "asc", series: "asc", ...figureColumns },
        fallback: "net",
      };
    }

    case "series": {
      return { columns: { series: "asc", ...figureColumns }, fallback: "net" };
    }

    default: {
      return group satisfies never;
    }
  }
};

/**
 * What the tenant kept: the purchases net of their refunds, and the
 * subscription payments net of theirs, which a series or an episode row has
 * none of.
 */
const netOf = (row: RevenueStatsTotalsItem): number =>
  row.netAmount + row.subscriptionAmount - row.subscriptionRefundedAmount;

const revenueGroups = ["day", "series", "episode"] as const;

const groupSchema = searchParamEnum(revenueGroups, { fallback: "day" });

const revenueValue = (
  row: RevenueStatsItem,
  column: RevenueColumn
): number | string => {
  switch (column) {
    case "date": {
      return row.date;
    }

    case "episode": {
      return row.episodeTitle;
    }

    case "gross": {
      return row.grossAmount;
    }

    case "net": {
      return netOf(row);
    }

    case "purchase_count": {
      return row.purchaseCount;
    }

    case "refunded": {
      return row.refundedAmount;
    }

    case "series": {
      return row.seriesTitle;
    }

    case "subscription": {
      return row.subscriptionAmount;
    }

    case "subscription_refunded": {
      return row.subscriptionRefundedAmount;
    }

    default: {
      return column satisfies never;
    }
  }
};

const rowKey = (row: RevenueStatsItem): string =>
  row.date || `${row.seriesPublicId}-${row.episodePublicId}`;

const RevenueSkeleton = () => (
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
              <SkeletonLine className="h-6 w-16" />
            </FigureLine.Value>
          </FigureLine.Figure>
        )
      )}
    </FigureLine.Root>
    <Skeleton className="h-40" />
    <Table.Skeleton />
  </ConsoleSection.Stack>
);

const RevenueTable = ({
  currency,
  group,
  hrefFor,
  locale,
  rows,
  sort,
  withSubscriptions,
}: {
  currency: string;
  group: RevenueGroup;
  hrefFor: (column: RevenueColumn) => string;
  locale: Locale;
  rows: RevenueStatsItem[];
  sort: SortState<RevenueColumn>;
  /** Whether the period has subscription payments, which a day row carries. */
  withSubscriptions: boolean;
}) => {
  const sorted = (column: RevenueColumn) =>
    sort.column === column ? sort.order : null;

  const amount = (value: number) => formatPrice(value, { currency, locale });
  const subscriptionCells = group === "day" && withSubscriptions;

  const columnCount =
    (group === "episode" ? 6 : 5) + (subscriptionCells ? 2 : 0);

  return (
    <Table.Root>
      <Table.Header>
        <Table.Row>
          {group === "day" ? (
            <SortHead href={hrefFor("date")} sorted={sorted("date")}>
              <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                <Message message="admin.analytics.revenue.columns.date" />
              </Suspense>
            </SortHead>
          ) : (
            <SortHead href={hrefFor("series")} sorted={sorted("series")}>
              <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                <Message message="admin.analytics.revenue.columns.series" />
              </Suspense>
            </SortHead>
          )}
          {group === "episode" ? (
            <SortHead href={hrefFor("episode")} sorted={sorted("episode")}>
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="admin.analytics.revenue.columns.episode" />
              </Suspense>
            </SortHead>
          ) : null}
          <SortHead
            className="w-32"
            href={hrefFor("purchase_count")}
            sorted={sorted("purchase_count")}
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="admin.analytics.revenue.columns.purchase_count" />
            </Suspense>
          </SortHead>
          <SortHead
            className="w-36"
            href={hrefFor("gross")}
            sorted={sorted("gross")}
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="admin.analytics.revenue.columns.gross" />
            </Suspense>
          </SortHead>
          <SortHead
            className="w-36"
            href={hrefFor("refunded")}
            sorted={sorted("refunded")}
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="admin.analytics.revenue.columns.refunded" />
            </Suspense>
          </SortHead>
          {subscriptionCells ? (
            <>
              <SortHead
                className="w-36"
                href={hrefFor("subscription")}
                sorted={sorted("subscription")}
              >
                <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                  <Message message="admin.analytics.revenue.columns.subscription" />
                </Suspense>
              </SortHead>
              <SortHead
                className="w-36"
                href={hrefFor("subscription_refunded")}
                sorted={sorted("subscription_refunded")}
              >
                <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                  <Message message="admin.analytics.revenue.columns.subscription_refunded" />
                </Suspense>
              </SortHead>
            </>
          ) : null}
          <SortHead
            className="w-36"
            href={hrefFor("net")}
            sorted={sorted("net")}
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="admin.analytics.revenue.columns.net" />
            </Suspense>
          </SortHead>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {rows.length === 0 ? (
          <Table.EmptyRow colSpan={columnCount}>
            <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
              <Message message="admin.analytics.revenue.empty" />
            </Suspense>
          </Table.EmptyRow>
        ) : (
          sortRows(rows, sort, revenueValue, locale).map((row) => (
            <Table.Row key={rowKey(row)}>
              {group === "day" ? (
                <Table.Cell>{formatPlainDate(row.date, { locale })}</Table.Cell>
              ) : (
                <Table.Cell>{row.seriesTitle}</Table.Cell>
              )}
              {group === "episode" ? (
                <Table.Cell className="font-medium">
                  {row.episodeTitle}
                </Table.Cell>
              ) : null}
              <Table.Cell>{formatCount(row.purchaseCount, locale)}</Table.Cell>
              <Table.Cell>{amount(row.grossAmount)}</Table.Cell>
              <Table.Cell>{amount(row.refundedAmount)}</Table.Cell>
              {subscriptionCells ? (
                <>
                  <Table.Cell>{amount(row.subscriptionAmount)}</Table.Cell>
                  <Table.Cell>
                    {amount(row.subscriptionRefundedAmount)}
                  </Table.Cell>
                </>
              ) : null}
              <Table.Cell className="font-medium">
                {amount(netOf(row))}
              </Table.Cell>
            </Table.Row>
          ))
        )}
      </Table.Body>
    </Table.Root>
  );
};

const RevenueContent = async ({
  searchParams,
}: Pick<RevenuePageProps, "searchParams">) => {
  const [sp, tenantId] = await Promise.all([searchParams, getTenantId()]);

  const [locale, timeZone] = await Promise.all([
    getLocale(tenantId),
    getTenantDisplayTimeZone(tenantId),
  ]);

  const { from, to } = parsePeriodSearchParams(sp);
  const period = resolveAnalyticsPeriod({ from, to }, timeZone);
  const group = groupSchema.parse(sp.group);

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
    getRevenueStats(tenantId, locale, { ...dates, group: "day" }),
    group === "day"
      ? null
      : getRevenueStats(tenantId, locale, { ...dates, group }),
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
                <Message message="admin.analytics.revenue.section_error" />
              </Suspense>
            </SectionError.Title>
            <SectionError.Description>{daily.message}</SectionError.Description>
          </SectionError.Heading>
        </SectionError.Root>
      </ConsoleSection.Stack>
    );
  }

  const rows = breakdown ?? daily;
  // A payment is never zero, so a period with none has a total of zero.
  const withSubscriptions = daily.totals.subscriptionAmount > 0;
  const table = revenueSortColumns(group, withSubscriptions);
  const sort = parseSortSearchParams(sp, table.columns, table.fallback);

  const amount = (value: number) =>
    formatPrice(value, { currency: daily.currency, locale });

  const query = { from, group: group === "day" ? "" : group, to };

  const hrefFor = (column: RevenueColumn) =>
    `${PATH}${buildQueryString({
      ...query,
      ...sortSearchParams(nextSort(sort, column, table.columns)),
    })}`;

  const groupHref = (target: RevenueGroup) =>
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
                <Message message="admin.analytics.revenue.purchase_count_label" />
              </Suspense>
            </FigureLine.Label>
            <FigureLine.Value>
              {formatCount(daily.totals.purchaseCount, locale)}
            </FigureLine.Value>
          </FigureLine.Figure>
          <FigureLine.Figure>
            <FigureLine.Label>
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="admin.analytics.revenue.gross_label" />
              </Suspense>
            </FigureLine.Label>
            <FigureLine.Value>
              {amount(daily.totals.grossAmount)}
            </FigureLine.Value>
          </FigureLine.Figure>
          <FigureLine.Figure>
            <FigureLine.Label>
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="admin.analytics.revenue.refunded_label" />
              </Suspense>
            </FigureLine.Label>
            <FigureLine.Value>
              {amount(daily.totals.refundedAmount)}
            </FigureLine.Value>
          </FigureLine.Figure>
          {withSubscriptions ? (
            <>
              <FigureLine.Figure>
                <FigureLine.Label>
                  <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                    <Message message="admin.analytics.revenue.subscription_label" />
                  </Suspense>
                </FigureLine.Label>
                <FigureLine.Value>
                  {amount(daily.totals.subscriptionAmount)}
                </FigureLine.Value>
              </FigureLine.Figure>
              <FigureLine.Figure>
                <FigureLine.Label>
                  <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                    <Message message="admin.analytics.revenue.subscription_refunded_label" />
                  </Suspense>
                </FigureLine.Label>
                <FigureLine.Value>
                  {amount(daily.totals.subscriptionRefundedAmount)}
                </FigureLine.Value>
              </FigureLine.Figure>
            </>
          ) : null}
          <FigureLine.Figure>
            <FigureLine.Label>
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="admin.analytics.revenue.net_label" />
              </Suspense>
            </FigureLine.Label>
            <FigureLine.Value>{amount(netOf(daily.totals))}</FigureLine.Value>
          </FigureLine.Figure>
        </FigureLine.Root>
        <Chart.Root>
          {withSubscriptions ? (
            <Chart.StackedBars
              aria-label={t("admin.analytics.revenue.chart_label")}
              series={[
                daily.rows.map((row) => row.netAmount),
                daily.rows.map(
                  (row) =>
                    row.subscriptionAmount - row.subscriptionRefundedAmount
                ),
              ]}
            />
          ) : (
            <Chart.Bars
              aria-label={t("admin.analytics.revenue.chart_label")}
              values={daily.rows.map((row) => row.netAmount)}
            />
          )}
          <Chart.Axis>
            <Chart.AxisLabel>
              {formatPlainDate(daily.period.start, { locale })}
            </Chart.AxisLabel>
            <Chart.AxisLabel>
              {formatPlainDate(daily.period.end, { locale })}
            </Chart.AxisLabel>
          </Chart.Axis>
          {withSubscriptions ? (
            <Chart.Legend>
              <Chart.LegendItem series={0}>
                <Suspense fallback={<SkeletonLine className="h-3 w-16" />}>
                  <Message message="admin.analytics.revenue.chart_purchases" />
                </Suspense>
              </Chart.LegendItem>
              <Chart.LegendItem series={1}>
                <Suspense fallback={<SkeletonLine className="h-3 w-20" />}>
                  <Message message="admin.analytics.revenue.chart_subscriptions" />
                </Suspense>
              </Chart.LegendItem>
            </Chart.Legend>
          ) : null}
          <Chart.Caption>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.analytics.revenue.chart_label" />
            </Suspense>
          </Chart.Caption>
        </Chart.Root>
        <p className="max-w-3xl text-xs text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-56" />}>
            <Message message="admin.analytics.revenue.definition" />
          </Suspense>
        </p>
        {withSubscriptions ? (
          <p className="max-w-3xl text-xs text-muted-foreground">
            <Suspense fallback={<SkeletonLine className="h-4 w-56" />}>
              <Message message="admin.analytics.revenue.subscription_definition" />
            </Suspense>
          </p>
        ) : null}
      </ConsoleSection.Root>

      <ConsoleSection.Root>
        <ConsoleSection.Header>
          <ConsoleSection.Heading>
            <ConsoleSection.Title>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="admin.analytics.revenue.breakdown_title" />
              </Suspense>
            </ConsoleSection.Title>
          </ConsoleSection.Heading>
          <ConsoleSection.Actions>
            <GroupNav.Root aria-label={t("admin.analytics.revenue.group_aria")}>
              <GroupNav.Link current={group === "day"} href={groupHref("day")}>
                <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                  <Message message="admin.analytics.revenue.group_day" />
                </Suspense>
              </GroupNav.Link>
              <GroupNav.Link
                current={group === "series"}
                href={groupHref("series")}
              >
                <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                  <Message message="admin.analytics.revenue.group_series" />
                </Suspense>
              </GroupNav.Link>
              <GroupNav.Link
                current={group === "episode"}
                href={groupHref("episode")}
              >
                <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                  <Message message="admin.analytics.revenue.group_episode" />
                </Suspense>
              </GroupNav.Link>
            </GroupNav.Root>
            <LinkButton
              href={statsCsvPath({ group, kind: "revenue" }, dates)}
              size="sm"
              variant="outline"
            >
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="admin.analytics.export.button" />
              </Suspense>
            </LinkButton>
          </ConsoleSection.Actions>
        </ConsoleSection.Header>
        {rows.ok ? (
          <RevenueTable
            currency={daily.currency}
            group={group}
            hrefFor={hrefFor}
            locale={locale}
            rows={rows.rows}
            sort={sort}
            withSubscriptions={withSubscriptions}
          />
        ) : (
          <SectionError.Root>
            <SectionError.Heading>
              <SectionError.Title>
                <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                  <Message message="admin.analytics.revenue.section_error" />
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

const RevenuePage = ({ searchParams }: RevenuePageProps) => (
  <ConsolePage.Root>
    <Suspense fallback={<TenantRoleRouteSkeleton />}>
      <TenantAdminRoute>
        <ConsolePage.Header>
          <ConsolePage.Heading>
            <ConsolePage.Title>
              <Suspense fallback={<SkeletonLine className="h-7 w-32" />}>
                <Message message="admin.analytics.revenue.title" />
              </Suspense>
            </ConsolePage.Title>
            <ConsolePage.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-96" />}>
                <Message message="admin.analytics.revenue.page_description" />
              </Suspense>
            </ConsolePage.Description>
          </ConsolePage.Heading>
        </ConsolePage.Header>
        <ConsolePage.Content>
          <SectionErrorBoundary
            title={
              <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                <Message message="admin.analytics.revenue.section_error" />
              </Suspense>
            }
          >
            <Suspense fallback={<RevenueSkeleton />}>
              <RevenueContent searchParams={searchParams} />
            </Suspense>
          </SectionErrorBoundary>
        </ConsolePage.Content>
      </TenantAdminRoute>
    </Suspense>
  </ConsolePage.Root>
);

export default RevenuePage;
