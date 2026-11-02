import type { Locale } from "@publira/i18n";
import * as FigureLine from "@publira/ui-components/figure-line";
import * as SectionError from "@publira/ui-components/section-error";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import * as Table from "@publira/ui-components/table";
import { formatPlainDate, formatPrice } from "@publira/utils";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Suspense } from "react";

import * as ListPagination from "#components/list-pagination";
import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { redirectToLogin } from "#lib/auth-session";
import { creatorPageHref } from "#lib/creator-page-paths";
import { getMyCreatorStats } from "#lib/creator-pages";
import type { MyCreatorEpisodeStatsItem } from "#lib/creator-pages";
import { getMessages } from "#lib/get-messages";
import { getMessagesFor } from "#lib/messages";

import { formatCount, formatReadThroughRate } from "../../_lib/figures";

/**
 * Its heading names the section, which is what turns the `<section>` into a
 * landmark a reader can jump to and a test can scope to.
 */
const EPISODES_HEADING_ID = "creator-episodes-heading";

interface CreatorStatsProps {
  creatorId: string;
  locale: Locale;
  salesVisible: boolean;
  /** The statements list's cursor, which the episode pages keep. */
  statementsToken: string;
  tenantId: string;
  token: string;
}

const EpisodesPaginationNav = async ({ children }: { children: ReactNode }) => {
  const t = await getMessages();

  return (
    <ListPagination.Root
      aria-label={t("storefront.my_creator.episodes_pagination_aria")}
    >
      {children}
    </ListPagination.Root>
  );
};

const EpisodeRow = ({
  episode,
  locale,
  rateUnavailable,
  salesCurrency,
}: {
  episode: MyCreatorEpisodeStatsItem;
  locale: Locale;
  rateUnavailable: string;
  /** The currency of the sales columns; `null` while they are not shown. */
  salesCurrency: string | null;
}) => (
  <Table.Row>
    <Table.Cell>{episode.seriesTitle}</Table.Cell>
    <Table.Cell>
      <LocaleLink
        className="underline-offset-4 hover:underline"
        href={`/series/${episode.seriesPublicId}/episodes/${episode.episodePublicId}`}
      >
        {episode.episodeTitle}
      </LocaleLink>
    </Table.Cell>
    <Table.Cell className="text-right">
      {formatCount(episode.memberViewCount, locale)}
    </Table.Cell>
    <Table.Cell className="text-right">
      {formatCount(episode.completeCount, locale)}
    </Table.Cell>
    <Table.Cell className="text-right">
      {formatReadThroughRate(
        episode.completeCount,
        episode.memberViewCount,
        locale
      ) ?? rateUnavailable}
    </Table.Cell>
    {salesCurrency === null ? null : (
      <>
        <Table.Cell className="text-right">
          {formatCount(episode.purchaseCount ?? 0, locale)}
        </Table.Cell>
        <Table.Cell className="text-right">
          {formatPrice(episode.netAmount ?? 0, {
            currency: salesCurrency,
            locale,
          })}
        </Table.Cell>
      </>
    )}
  </Table.Row>
);

/**
 * How the Author's episodes were read over the tenant's last 28 whole days:
 * the totals over every episode crediting them, with the readers following
 * them now, and then each episode on its own, with its sales where the tenant
 * shows them.
 */
export const CreatorStats = async ({
  creatorId,
  locale,
  salesVisible,
  statementsToken,
  tenantId,
  token,
}: CreatorStatsProps) => {
  const result = await getMyCreatorStats(tenantId, {
    creatorId,
    locale,
    token,
  });

  if (!result.ok && result.missing) {
    notFound();
  }

  if (!result.ok && result.requiresSignIn) {
    await redirectToLogin(
      locale,
      creatorPageHref(creatorId, { statementsToken, token }),
      tenantId
    );
  }

  if (!result.ok) {
    return (
      <SectionError.Root>
        <SectionError.Heading>
          <SectionError.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="storefront.my_creator.stats_error" />
            </Suspense>
          </SectionError.Title>
          <SectionError.Description>{result.message}</SectionError.Description>
        </SectionError.Heading>
      </SectionError.Root>
    );
  }

  const stats = result.value;
  const t = await getMessagesFor(locale);
  const rateUnavailable = t("storefront.my_creator.rate_unavailable");
  const salesCurrency = salesVisible ? stats.currency : null;
  const columnCount = salesCurrency === null ? 5 : 7;

  return (
    <>
      <section className="grid gap-4 border border-border bg-card p-6">
        <p className="text-sm text-muted-foreground">
          {t("storefront.my_creator.period", {
            end: formatPlainDate(stats.periodEnd, { locale }),
            start: formatPlainDate(stats.periodStart, { locale }),
            time_zone: stats.timeZone,
          })}
        </p>
        <FigureLine.Root>
          <FigureLine.Figure>
            <FigureLine.Label>
              {t("storefront.my_creator.followers")}
            </FigureLine.Label>
            <FigureLine.Value>
              {formatCount(stats.followerCount, locale)}
            </FigureLine.Value>
          </FigureLine.Figure>
          <FigureLine.Figure>
            <FigureLine.Label>
              {t("storefront.my_creator.member_views")}
            </FigureLine.Label>
            <FigureLine.Value>
              {formatCount(stats.totalMemberViewCount, locale)}
            </FigureLine.Value>
          </FigureLine.Figure>
          <FigureLine.Figure>
            <FigureLine.Label>
              {t("storefront.my_creator.completions")}
            </FigureLine.Label>
            <FigureLine.Value>
              {formatCount(stats.totalCompleteCount, locale)}
            </FigureLine.Value>
          </FigureLine.Figure>
          <FigureLine.Figure>
            <FigureLine.Label>
              {t("storefront.my_creator.read_through_rate")}
            </FigureLine.Label>
            <FigureLine.Value>
              {formatReadThroughRate(
                stats.totalCompleteCount,
                stats.totalMemberViewCount,
                locale
              ) ?? rateUnavailable}
            </FigureLine.Value>
          </FigureLine.Figure>
        </FigureLine.Root>
        <p className="max-w-3xl text-sm text-muted-foreground">
          {t("storefront.my_creator.figures_definition")}
        </p>
      </section>

      <section
        aria-labelledby={EPISODES_HEADING_ID}
        className="grid gap-4 border border-border bg-card p-6"
      >
        <div>
          <h2 className="text-lg font-semibold" id={EPISODES_HEADING_ID}>
            {t("storefront.my_creator.episodes_heading")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("storefront.my_creator.episodes_description")}
          </p>
        </div>
        <Table.Root>
          <Table.Header>
            <Table.Row>
              <Table.Head>{t("storefront.my_creator.series")}</Table.Head>
              <Table.Head>{t("storefront.my_creator.episode")}</Table.Head>
              <Table.Head className="text-right">
                {t("storefront.my_creator.member_views")}
              </Table.Head>
              <Table.Head className="text-right">
                {t("storefront.my_creator.completions")}
              </Table.Head>
              <Table.Head className="text-right">
                {t("storefront.my_creator.read_through_rate")}
              </Table.Head>
              {salesCurrency === null ? null : (
                <>
                  <Table.Head className="text-right">
                    {t("storefront.my_creator.sales")}
                  </Table.Head>
                  <Table.Head className="text-right">
                    {t("storefront.my_creator.net_amount")}
                  </Table.Head>
                </>
              )}
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {stats.episodes.length === 0 ? (
              <Table.EmptyRow colSpan={columnCount}>
                {t("storefront.my_creator.episodes_empty")}
              </Table.EmptyRow>
            ) : (
              stats.episodes.map((episode) => (
                <EpisodeRow
                  episode={episode}
                  key={episode.episodePublicId}
                  locale={locale}
                  rateUnavailable={rateUnavailable}
                  salesCurrency={salesCurrency}
                />
              ))
            )}
          </Table.Body>
        </Table.Root>
        {stats.previousToken || stats.nextToken ? (
          <Suspense fallback={<ListPagination.Skeleton />}>
            <EpisodesPaginationNav>
              <ListPagination.Step
                href={
                  stats.previousToken
                    ? creatorPageHref(creatorId, {
                        statementsToken,
                        token: stats.previousToken,
                      })
                    : ""
                }
              >
                {t("storefront.common.previous_page")}
              </ListPagination.Step>
              <ListPagination.Step
                href={
                  stats.nextToken
                    ? creatorPageHref(creatorId, {
                        statementsToken,
                        token: stats.nextToken,
                      })
                    : ""
                }
              >
                {t("storefront.common.next_page")}
              </ListPagination.Step>
            </EpisodesPaginationNav>
          </Suspense>
        ) : null}
      </section>
    </>
  );
};

/** What stands in for {@link CreatorStats} while it reads. */
export const CreatorStatsSkeleton = () => (
  <>
    <section className="grid gap-4 border border-border bg-card p-6">
      <SkeletonLine className="h-4 w-72" />
      <Skeleton className="h-12 w-full" />
    </section>
    <section className="grid gap-4 border border-border bg-card p-6">
      <SkeletonLine className="h-6 w-32" />
      <Skeleton className="h-40 w-full" />
    </section>
  </>
);
