import type { Locale } from "@publira/i18n";
import * as ConsolePage from "@publira/layouts/admin/console-page";
import * as ConsoleSection from "@publira/layouts/admin/console-section";
import * as Field from "@publira/ui-components/field";
import * as FigureLine from "@publira/ui-components/figure-line";
import { FormMessage } from "@publira/ui-components/form-message";
import * as SectionError from "@publira/ui-components/section-error";
import { Select } from "@publira/ui-components/select";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import * as Table from "@publira/ui-components/table";
import { formatPercent, formatPlainDate } from "@publira/utils";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import { searchParamString } from "@publira/utils/search-params";
import type { Metadata } from "next";
import { Suspense } from "react";
import type { ReactNode } from "react";

import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import {
  isSignedInTenantAdmin,
  redirectToLoginIfSessionRejected,
} from "#lib/auth-session";
import { getRetentionCohorts, getSignUpFunnel } from "#lib/engagement";
import type { RetentionCohortItem, SignUpFunnelItem } from "#lib/engagement";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { listAllSeries } from "#lib/series";
import { getTenantId } from "#lib/tenant-id";
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";

import { PeriodForm } from "../_components/period-form";
import { formatCount, formatDays } from "../_lib/format";
import {
  parsePeriodSearchParams,
  resolveAnalyticsPeriod,
} from "../_lib/period";
import { RETENTION_WEEKS, cohortCells, cohortShade } from "./_lib/cohorts";
import type { CohortCell } from "./_lib/cohorts";

type CohortsPageProps = PageProps<"/[tenant_id]/analytics/cohorts">;

const PATH = "/analytics/cohorts";

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const t = await getMessagesFor(locale);

  return { title: t("admin.analytics.cohorts.title") };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

/** The series the activity is narrowed to, by its public ID; empty for all. */
const seriesSchema = searchParamString({ fallback: "" });

const WEEKS = Array.from({ length: RETENTION_WEEKS }, (_, week) => week);

const CohortsSkeleton = () => (
  <ConsoleSection.Stack>
    <div className="flex flex-wrap items-end gap-4">
      <Skeleton className="h-16 w-44" />
      <Skeleton className="h-16 w-44" />
      <Skeleton className="h-16 w-56" />
    </div>
    <Table.Skeleton />
  </ConsoleSection.Stack>
);

const SeriesField = async ({
  locale,
  series,
}: {
  locale: Locale;
  series: string;
}) => {
  const [list, t] = await Promise.all([
    listAllSeries(),
    getMessagesFor(locale),
  ]);

  return (
    <Field.Root className="w-56">
      <Field.Label>
        <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
          <Message message="admin.analytics.cohorts.series" />
        </Suspense>
      </Field.Label>
      <Field.Content>
        <Select
          defaultValue={series}
          items={[
            { label: t("admin.analytics.cohorts.series_all"), value: "" },
            ...(list.ok ? list.series : []).map((item) => ({
              label: item.title,
              value: item.publicId,
            })),
          ]}
          name="series"
        />
        {/* The report does not depend on the list: without it, every series
            is the one choice left. */}
        {list.ok ? null : (
          <FormMessage variant="destructive">{list.message}</FormMessage>
        )}
      </Field.Content>
    </Field.Root>
  );
};

const CohortWeekCell = ({
  cell,
  locale,
}: {
  cell: CohortCell;
  locale: Locale;
}) => {
  switch (cell.state) {
    case "counted": {
      return (
        <Table.Cell style={{ backgroundColor: cohortShade(cell.share) }}>
          {formatPercent(cell.share, { fractionDigits: 0, locale })}
        </Table.Cell>
      );
    }
    case "no_readers": {
      return (
        <Table.Cell>
          <Suspense fallback={<SkeletonLine className="h-4 w-4" />}>
            <Message message="admin.analytics.cohorts.share_unavailable" />
          </Suspense>
        </Table.Cell>
      );
    }
    case "open": {
      // A week still under way is left blank: its readers are not all in.
      return <Table.Cell />;
    }
    default: {
      return cell satisfies never;
    }
  }
};

const CohortTable = ({
  cohorts,
  locale,
}: {
  cohorts: RetentionCohortItem[];
  locale: Locale;
}) => (
  <Table.Root>
    <Table.Header>
      <Table.Row>
        <Table.Head>
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="admin.analytics.cohorts.columns.week" />
          </Suspense>
        </Table.Head>
        <Table.Head>
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="admin.analytics.cohorts.columns.readers" />
          </Suspense>
        </Table.Head>
        {WEEKS.map((week) => (
          <Table.Head key={week}>
            <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
              <Message
                message="admin.analytics.cohorts.columns.week_after"
                values={{ week }}
              />
            </Suspense>
          </Table.Head>
        ))}
      </Table.Row>
    </Table.Header>
    <Table.Body>
      {cohorts.map((cohort) => (
        <Table.Row key={cohort.weekStart}>
          <Table.Cell className="whitespace-nowrap">
            {formatPlainDate(cohort.weekStart, { locale })}
          </Table.Cell>
          <Table.Cell>{formatCount(cohort.cohortSize, locale)}</Table.Cell>
          {cohortCells(cohort).map((cell) => (
            <CohortWeekCell cell={cell} key={cell.week} locale={locale} />
          ))}
        </Table.Row>
      ))}
    </Table.Body>
  </Table.Root>
);

/**
 * One step of the funnel: its label, the readers who reached it, and their
 * share of every reader who signed up.
 */
const FunnelStep = ({
  children,
  count,
  locale,
  signedUp,
}: {
  children: ReactNode;
  count: number;
  locale: Locale;
  signedUp: number;
}) => (
  <Table.Row>
    <Table.Cell className="font-medium">{children}</Table.Cell>
    <Table.Cell>{formatCount(count, locale)}</Table.Cell>
    <Table.Cell>
      {signedUp > 0 ? (
        formatPercent(count / signedUp, { locale })
      ) : (
        <Suspense fallback={<SkeletonLine className="h-4 w-4" />}>
          <Message message="admin.analytics.funnel.share_unavailable" />
        </Suspense>
      )}
    </Table.Cell>
  </Table.Row>
);

const Funnel = ({
  funnel,
  locale,
}: {
  funnel: SignUpFunnelItem;
  locale: Locale;
}) => (
  <>
    <FigureLine.Root>
      <FigureLine.Figure>
        <FigureLine.Label>
          <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
            <Message message="admin.analytics.funnel.median_label" />
          </Suspense>
        </FigureLine.Label>
        <FigureLine.Value>
          {funnel.medianDaysToFirstPurchase === null ? (
            <Suspense fallback={<SkeletonLine className="h-6 w-6" />}>
              <Message message="admin.analytics.funnel.share_unavailable" />
            </Suspense>
          ) : (
            formatDays(funnel.medianDaysToFirstPurchase, locale)
          )}
        </FigureLine.Value>
      </FigureLine.Figure>
    </FigureLine.Root>
    <Table.Root>
      <Table.Header>
        <Table.Row>
          <Table.Head>
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="admin.analytics.funnel.columns.step" />
            </Suspense>
          </Table.Head>
          <Table.Head>
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="admin.analytics.funnel.columns.readers" />
            </Suspense>
          </Table.Head>
          <Table.Head>
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <Message message="admin.analytics.funnel.columns.share" />
            </Suspense>
          </Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        <FunnelStep
          count={funnel.signedUpCount}
          locale={locale}
          signedUp={funnel.signedUpCount}
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
            <Message message="admin.analytics.funnel.steps.signed_up" />
          </Suspense>
        </FunnelStep>
        <FunnelStep
          count={funnel.activeCount}
          locale={locale}
          signedUp={funnel.signedUpCount}
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
            <Message message="admin.analytics.funnel.steps.active" />
          </Suspense>
        </FunnelStep>
        <FunnelStep
          count={funnel.purchasedWithinSevenDaysCount}
          locale={locale}
          signedUp={funnel.signedUpCount}
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <Message message="admin.analytics.funnel.steps.within_seven_days" />
          </Suspense>
        </FunnelStep>
        <FunnelStep
          count={funnel.purchasedWithinThirtyDaysCount}
          locale={locale}
          signedUp={funnel.signedUpCount}
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <Message message="admin.analytics.funnel.steps.within_thirty_days" />
          </Suspense>
        </FunnelStep>
        <FunnelStep
          count={funnel.purchasedCount}
          locale={locale}
          signedUp={funnel.signedUpCount}
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="admin.analytics.funnel.steps.purchased" />
          </Suspense>
        </FunnelStep>
      </Table.Body>
    </Table.Root>
  </>
);

const CohortsContent = async ({
  searchParams,
}: Pick<CohortsPageProps, "searchParams">) => {
  const [sp, tenantId] = await Promise.all([searchParams, getTenantId()]);
  const [locale, timeZone, isAdmin] = await Promise.all([
    getLocale(tenantId),
    getTenantDisplayTimeZone(tenantId),
    isSignedInTenantAdmin(tenantId),
  ]);
  const { from, to } = parsePeriodSearchParams(sp);
  const period = resolveAnalyticsPeriod({ from, to }, timeZone);
  const series = seriesSchema.parse(sp.series);

  const form = (
    <PeriodForm period={period} resetHref={PATH} timeZone={timeZone}>
      <SeriesField locale={locale} series={series} />
    </PeriodForm>
  );
  if (!period.ok) {
    return <ConsoleSection.Stack>{form}</ConsoleSection.Stack>;
  }

  const dates = { end: period.end, start: period.start };
  // The funnel counts purchases, which only a tenant admin may read: anyone
  // else is shown the cohorts alone, and the API is not asked for it.
  const [cohorts, funnel] = await Promise.all([
    getRetentionCohorts(tenantId, locale, { ...dates, seriesPublicId: series }),
    isAdmin ? getSignUpFunnel(tenantId, locale, dates) : null,
  ]);
  await redirectToLoginIfSessionRejected(cohorts, ...(funnel ? [funnel] : []));

  return (
    <ConsoleSection.Stack>
      {form}

      <ConsoleSection.Root>
        <ConsoleSection.Header>
          <ConsoleSection.Heading>
            <ConsoleSection.Title>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="admin.analytics.cohorts.table_title" />
              </Suspense>
            </ConsoleSection.Title>
          </ConsoleSection.Heading>
        </ConsoleSection.Header>
        {cohorts.ok ? (
          <>
            <p className="max-w-3xl text-sm text-muted-foreground">
              <Suspense fallback={<SkeletonLine className="h-4 w-56" />}>
                <Message
                  message="admin.analytics.period.covered"
                  values={{
                    end: formatPlainDate(cohorts.period.end, { locale }),
                    start: formatPlainDate(cohorts.period.start, { locale }),
                    time_zone: cohorts.period.timeZone,
                  }}
                />
              </Suspense>
            </p>
            <CohortTable cohorts={cohorts.cohorts} locale={locale} />
            <p className="max-w-3xl text-xs text-muted-foreground">
              <Suspense fallback={<SkeletonLine className="h-4 w-56" />}>
                <Message message="admin.analytics.cohorts.definition" />
              </Suspense>
            </p>
          </>
        ) : (
          <SectionError.Root>
            <SectionError.Heading>
              <SectionError.Title>
                <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                  <Message message="admin.analytics.cohorts.section_error" />
                </Suspense>
              </SectionError.Title>
              <SectionError.Description>
                {cohorts.message}
              </SectionError.Description>
            </SectionError.Heading>
          </SectionError.Root>
        )}
      </ConsoleSection.Root>

      {funnel ? (
        <ConsoleSection.Root>
          <ConsoleSection.Header>
            <ConsoleSection.Heading>
              <ConsoleSection.Title>
                <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                  <Message message="admin.analytics.funnel.title" />
                </Suspense>
              </ConsoleSection.Title>
            </ConsoleSection.Heading>
          </ConsoleSection.Header>
          {funnel.ok ? (
            <>
              <Funnel funnel={funnel.funnel} locale={locale} />
              <p className="max-w-3xl text-xs text-muted-foreground">
                <Suspense fallback={<SkeletonLine className="h-4 w-56" />}>
                  <Message message="admin.analytics.funnel.definition" />
                </Suspense>
              </p>
            </>
          ) : (
            <SectionError.Root>
              <SectionError.Heading>
                <SectionError.Title>
                  <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                    <Message message="admin.analytics.funnel.section_error" />
                  </Suspense>
                </SectionError.Title>
                <SectionError.Description>
                  {funnel.message}
                </SectionError.Description>
              </SectionError.Heading>
            </SectionError.Root>
          )}
        </ConsoleSection.Root>
      ) : null}

      <p className="max-w-3xl text-xs text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-56" />}>
          <Message message="admin.analytics.cohorts.activity_note" />
        </Suspense>
      </p>
    </ConsoleSection.Stack>
  );
};

const CohortsPage = ({ searchParams }: CohortsPageProps) => (
  <ConsolePage.Root>
    <ConsolePage.Header>
      <ConsolePage.Heading>
        <ConsolePage.Title>
          <Suspense fallback={<SkeletonLine className="h-7 w-32" />}>
            <Message message="admin.analytics.cohorts.title" />
          </Suspense>
        </ConsolePage.Title>
        <ConsolePage.Description>
          <Suspense fallback={<SkeletonLine className="h-4 w-96" />}>
            <Message message="admin.analytics.cohorts.page_description" />
          </Suspense>
        </ConsolePage.Description>
      </ConsolePage.Heading>
    </ConsolePage.Header>
    <ConsolePage.Content>
      <SectionErrorBoundary
        title={
          <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
            <Message message="admin.analytics.cohorts.section_error" />
          </Suspense>
        }
      >
        <Suspense fallback={<CohortsSkeleton />}>
          <CohortsContent searchParams={searchParams} />
        </Suspense>
      </SectionErrorBoundary>
    </ConsolePage.Content>
  </ConsolePage.Root>
);

export default CohortsPage;
