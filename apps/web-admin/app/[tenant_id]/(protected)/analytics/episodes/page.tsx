import type { Locale } from "@publira/i18n";
import * as ConsolePage from "@publira/layouts/admin/console-page";
import * as ConsoleSection from "@publira/layouts/admin/console-section";
import * as EmptyState from "@publira/ui-components/empty-state";
import * as FigureLine from "@publira/ui-components/figure-line";
import * as SectionError from "@publira/ui-components/section-error";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import * as Table from "@publira/ui-components/table";
import { formatPercent, formatPlainDate } from "@publira/utils";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { CursorPageEmptyState } from "#components/cursor-page-empty-state";
import { Message } from "#components/message";
import * as PaginationFooter from "#components/pagination-controls";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import {
  cursorPageHrefs,
  DEFAULT_PAGE_SIZE,
  hasCursorPageLinks,
  parseCursorSearchParams,
} from "#lib/cursor-page";
import { listEpisodeReadThrough, readThroughRate } from "#lib/engagement";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getTenantId } from "#lib/tenant-id";

import { formatCount } from "../_lib/format";

type EpisodesPageProps = PageProps<"/[tenant_id]/analytics/episodes">;

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const t = await getMessagesFor(locale);

  return { title: t("admin.analytics.episodes.title") };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

/**
 * The rate as the console words it. `null` is not zero: no member opened the
 * episode in the period, so there is nothing a completion could be a share of.
 */
const formatReadThroughRate = async (
  rate: number | null,
  locale: Locale
): Promise<string> => {
  const t = await getMessagesFor(locale);

  return rate === null
    ? t("admin.analytics.episodes.rate_unavailable")
    : formatPercent(rate, { locale });
};

/**
 * One episode's read-through rate, as its own async component: the "no reader
 * opened it" wording comes from the catalog, and a row rendered inside `.map()`
 * cannot await.
 */
const ReadThroughRateCell = async ({
  completeCount,
  locale,
  memberViewCount,
}: {
  completeCount: number;
  locale: Locale;
  memberViewCount: number;
}) =>
  await formatReadThroughRate(
    readThroughRate(completeCount, memberViewCount),
    locale
  );

const EpisodesSkeleton = () => (
  <ConsoleSection.Stack>
    <FigureLine.Root>
      {(["skeleton-1", "skeleton-2", "skeleton-3"] as const).map((key) => (
        <FigureLine.Figure key={key}>
          <FigureLine.Label>
            <SkeletonLine className="h-4 w-28" />
          </FigureLine.Label>
          <FigureLine.Value>
            <SkeletonLine className="h-6 w-12" />
          </FigureLine.Value>
        </FigureLine.Figure>
      ))}
    </FigureLine.Root>

    <Table.Root>
      <Table.Header>
        <Table.Row>
          <Table.Head>
            <SkeletonLine className="h-4 w-24" />
          </Table.Head>
          <Table.Head>
            <SkeletonLine className="h-4 w-32" />
          </Table.Head>
          <Table.Head>
            <SkeletonLine className="h-4 w-16" />
          </Table.Head>
          <Table.Head>
            <SkeletonLine className="h-4 w-16" />
          </Table.Head>
          <Table.Head>
            <SkeletonLine className="h-4 w-20" />
          </Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        <Table.LoadingRow colSpan={5} rows={6} />
      </Table.Body>
    </Table.Root>
  </ConsoleSection.Stack>
);

const EpisodesContent = async ({
  searchParams,
}: Pick<EpisodesPageProps, "searchParams">) => {
  const [sp, tenantId] = await Promise.all([searchParams, getTenantId()]);
  const { token } = parseCursorSearchParams(sp);
  const locale = await getLocale(tenantId);

  const [result, t] = await Promise.all([
    listEpisodeReadThrough(tenantId, locale, {
      limit: DEFAULT_PAGE_SIZE,
      token,
    }),
    getMessagesFor(locale),
  ]);

  await redirectToLoginIfSessionRejected(result);

  if (!result.ok) {
    return (
      <SectionError.Root>
        <SectionError.Heading>
          <SectionError.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="admin.analytics.episodes.section_error" />
            </Suspense>
          </SectionError.Title>
          <SectionError.Description>{result.message}</SectionError.Description>
        </SectionError.Heading>
      </SectionError.Root>
    );
  }

  const pageHrefs = cursorPageHrefs(result);
  const hasPageLinks = hasCursorPageLinks(pageHrefs);

  const totalRate = readThroughRate(
    result.totalCompleteCount,
    result.totalMemberViewCount
  );

  return (
    <ConsoleSection.Stack>
      <ConsoleSection.Root>
        <p className="max-w-3xl text-sm text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-56" />}>
            <Message
              message="admin.analytics.episodes.period"
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
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="admin.analytics.episodes.complete_count_label" />
              </Suspense>
            </FigureLine.Label>
            <FigureLine.Value>
              {formatCount(result.totalCompleteCount, locale)}
            </FigureLine.Value>
          </FigureLine.Figure>
          <FigureLine.Figure>
            <FigureLine.Label>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="admin.analytics.episodes.member_view_count_label" />
              </Suspense>
            </FigureLine.Label>
            <FigureLine.Value>
              {formatCount(result.totalMemberViewCount, locale)}
            </FigureLine.Value>
          </FigureLine.Figure>
          <FigureLine.Figure>
            <FigureLine.Label>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="admin.analytics.episodes.rate_label" />
              </Suspense>
            </FigureLine.Label>
            <FigureLine.Value>
              {await formatReadThroughRate(totalRate, locale)}
            </FigureLine.Value>
          </FigureLine.Figure>
        </FigureLine.Root>
        <p className="text-xs text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-56" />}>
            <Message message="admin.analytics.episodes.definition" />
          </Suspense>
        </p>
      </ConsoleSection.Root>

      <ConsoleSection.Root>
        <ConsoleSection.Header>
          <ConsoleSection.Heading>
            <ConsoleSection.Title>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="admin.analytics.episodes.list_title" />
              </Suspense>
            </ConsoleSection.Title>
            <ConsoleSection.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="admin.analytics.episodes.list_description" />
              </Suspense>
            </ConsoleSection.Description>
          </ConsoleSection.Heading>
        </ConsoleSection.Header>
        {result.episodes.length === 0 ? (
          <CursorPageEmptyState
            hasPageLinks={hasPageLinks}
            itemLabel={t("admin.analytics.episodes.title")}
          >
            <EmptyState.Heading>
              <EmptyState.Title>
                {t("admin.analytics.episodes.empty_title")}
              </EmptyState.Title>
              <EmptyState.Description>
                <Message message="admin.analytics.episodes.empty_description" />
              </EmptyState.Description>
            </EmptyState.Heading>
          </CursorPageEmptyState>
        ) : (
          <Table.Root>
            <Table.Header>
              <Table.Row>
                <Table.Head>
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <Message message="admin.analytics.episodes.columns.series" />
                  </Suspense>
                </Table.Head>
                <Table.Head>
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <Message message="admin.analytics.episodes.columns.episode" />
                  </Suspense>
                </Table.Head>
                <Table.Head className="w-32">
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <Message message="admin.analytics.episodes.columns.complete_count" />
                  </Suspense>
                </Table.Head>
                <Table.Head className="w-32">
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <Message message="admin.analytics.episodes.columns.member_view_count" />
                  </Suspense>
                </Table.Head>
                <Table.Head className="w-32">
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <Message message="admin.analytics.episodes.columns.rate" />
                  </Suspense>
                </Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {result.episodes.map((item) => (
                <Table.Row
                  key={`${item.seriesPublicId}-${item.episodePublicId}`}
                >
                  <Table.Cell>{item.seriesTitle}</Table.Cell>
                  <Table.Cell className="font-medium">
                    <Link
                      className="underline-offset-4 hover:underline"
                      href={`/analytics/episodes/${item.seriesPublicId}/${item.episodePublicId}`}
                    >
                      {item.episodeTitle}
                    </Link>
                  </Table.Cell>
                  <Table.Cell>
                    {formatCount(item.completeCount, locale)}
                  </Table.Cell>
                  <Table.Cell>
                    {formatCount(item.memberViewCount, locale)}
                  </Table.Cell>
                  <Table.Cell>
                    <ReadThroughRateCell
                      completeCount={item.completeCount}
                      locale={locale}
                      memberViewCount={item.memberViewCount}
                    />
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        )}

        {result.episodes.length > 0 || hasPageLinks ? (
          <PaginationFooter.Root>
            <PaginationFooter.Description>
              {t("admin.analytics.episodes.pagination_description", {
                count: DEFAULT_PAGE_SIZE,
              })}
            </PaginationFooter.Description>
            <PaginationFooter.Controls
              {...pageHrefs}
              aria-label={t("admin.analytics.episodes.pagination_aria")}
            />
          </PaginationFooter.Root>
        ) : null}
      </ConsoleSection.Root>
    </ConsoleSection.Stack>
  );
};

const EpisodesPage = ({ searchParams }: EpisodesPageProps) => (
  <ConsolePage.Root>
    <ConsolePage.Header>
      <ConsolePage.Heading>
        <ConsolePage.Title>
          <Suspense fallback={<SkeletonLine className="h-7 w-40" />}>
            <Message message="admin.analytics.episodes.title" />
          </Suspense>
        </ConsolePage.Title>
        <ConsolePage.Description>
          <Suspense fallback={<SkeletonLine className="h-4 w-96" />}>
            <Message message="admin.analytics.episodes.page_description" />
          </Suspense>
        </ConsolePage.Description>
      </ConsolePage.Heading>
    </ConsolePage.Header>
    <ConsolePage.Content>
      <SectionErrorBoundary
        title={
          <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
            <Message message="admin.analytics.episodes.section_error" />
          </Suspense>
        }
      >
        <Suspense fallback={<EpisodesSkeleton />}>
          <EpisodesContent searchParams={searchParams} />
        </Suspense>
      </SectionErrorBoundary>
    </ConsolePage.Content>
  </ConsolePage.Root>
);

export default EpisodesPage;
