import { LinkButton } from "@publira/ui-components/button";
import * as FigureLine from "@publira/ui-components/figure-line";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { formatDate, formatPlainYearMonth, formatPrice } from "@publira/utils";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Suspense } from "react";
import { z } from "zod";

import * as ListPagination from "#components/list-pagination";
import { LocaleLink } from "#components/locale-link";
import { PageLoadError } from "#components/page-load-error";
import { redirectToLogin } from "#lib/auth-session";
import {
  creatorIdParamSchema,
  creatorPageHref,
  creatorStatementHref,
  periodParamSchema,
} from "#lib/creator-page-paths";
import { getMyCreatorStatement, listMyCreators } from "#lib/creator-pages";
import { cursorTokenSchema } from "#lib/cursor-token";
import { getMessages } from "#lib/get-messages";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getTenantDisplayTimeZone } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

import { CreatorHeading } from "../../../_components/creator-heading";
import { formatCount } from "../../../_lib/figures";
import { StatementLines } from "./_components/statement-lines";

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id", "creator_id", "period");

export const generateMetadata = async (): Promise<Metadata> => {
  const t = await getMessages();

  return { title: t("storefront.my_creator.title") };
};

type StatementPageProps =
  PageProps<"/[tenant_id]/[locale]/my/creators/[creator_id]/statements/[period]">;

const paramsSchema = z.object({
  creator_id: creatorIdParamSchema,
  period: periodParamSchema,
});

const searchParamsSchema = z.object({ token: cursorTokenSchema });

/**
 * The Route Handler that answers the Author's lines of a closed month as CSV.
 * It sits outside the locale tree, as the purchase history download does, so
 * the language goes in the query.
 */
const statementCsvPath = (creatorId: string, period: string): string =>
  `/api/v1/my/creators/${creatorId}/statements/${period}/csv`;

const LinesPaginationNav = async ({ children }: { children: ReactNode }) => {
  const t = await getMessages();

  return (
    <ListPagination.Root
      aria-label={t("storefront.my_creator.lines_pagination_aria")}
    >
      {children}
    </ListPagination.Root>
  );
};

const StatementPageSkeleton = () => (
  <div className="space-y-6 px-4 py-6 sm:px-6 lg:px-8">
    <section className="border border-border bg-card p-6">
      <SkeletonLine className="h-4 w-32" />
      <SkeletonLine className="mt-2 h-6 w-56" />
    </section>
    <Skeleton className="h-64 w-full" />
  </div>
);

/**
 * The Author's part of one closed month: what it sums to, and the lines that
 * name them, with the download of those lines. The month's lines for other
 * Authors and its totals are never read, so nothing here can show them.
 */
const StatementPageContent = async ({
  params,
  searchParams,
}: StatementPageProps) => {
  const [rawParams, resolvedSearchParams, tenantId, locale] = await Promise.all(
    [params, searchParams, getTenantId(), getLocale()]
  );

  const parsed = paramsSchema.safeParse(rawParams);

  if (!parsed.success) {
    notFound();
  }

  const { creator_id: creatorId, period } = parsed.data;
  const { token } = searchParamsSchema.parse(resolvedSearchParams);
  const returnTo = creatorStatementHref(creatorId, period, token);

  const [creators, result, timeZone, t] = await Promise.all([
    listMyCreators(tenantId, locale),
    getMyCreatorStatement(tenantId, { creatorId, locale, period, token }),
    getTenantDisplayTimeZone(tenantId),
    getMessagesFor(locale),
  ]);

  const requiresSignIn = [creators, result].some(
    (read) => !read.ok && !read.missing && read.requiresSignIn
  );

  if (requiresSignIn) {
    await redirectToLogin(locale, returnTo, tenantId);
  }

  if ((!creators.ok && creators.missing) || (!result.ok && result.missing)) {
    notFound();
  }

  if (!creators.ok) {
    return <PageLoadError description={creators.message} />;
  }

  if (!result.ok) {
    return <PageLoadError description={result.message} />;
  }

  const creator = creators.value.creators.find(({ id }) => id === creatorId);

  if (!creator) {
    notFound();
  }

  const { lines, nextToken, previousToken, statement } = result.value;
  const { currency } = statement;
  const month = formatPlainYearMonth(statement.period, { locale });

  return (
    <div className="space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <section className="grid gap-4 border border-border bg-card p-6">
        <CreatorHeading creator={creator}>
          <p className="text-sm text-muted-foreground">{creator.name}</p>
          <h1 className="text-xl font-semibold">
            {t("storefront.my_creator.statement_title", { period: month })}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("storefront.my_creator.statement_closed_at", {
              currency,
              date: formatDate(statement.closedAt, { locale, timeZone }),
            })}
          </p>
        </CreatorHeading>
        <FigureLine.Root>
          <FigureLine.Figure>
            <FigureLine.Label>
              {t("storefront.my_creator.sales")}
            </FigureLine.Label>
            <FigureLine.Value>
              {formatCount(statement.saleCount, locale)}
            </FigureLine.Value>
          </FigureLine.Figure>
          <FigureLine.Figure>
            <FigureLine.Label>
              {t("storefront.my_creator.gross")}
            </FigureLine.Label>
            <FigureLine.Value>
              {formatPrice(statement.grossAmount, { currency, locale })}
            </FigureLine.Value>
          </FigureLine.Figure>
          <FigureLine.Figure>
            <FigureLine.Label>
              {t("storefront.my_creator.refunded")}
            </FigureLine.Label>
            <FigureLine.Value>
              {formatPrice(statement.refundedAmount, { currency, locale })}
            </FigureLine.Value>
          </FigureLine.Figure>
          <FigureLine.Figure>
            <FigureLine.Label>
              {t("storefront.my_creator.payout")}
            </FigureLine.Label>
            <FigureLine.Value>
              {formatPrice(statement.payoutAmount, { currency, locale })}
            </FigureLine.Value>
          </FigureLine.Figure>
        </FigureLine.Root>
      </section>

      <section className="grid gap-4 border border-border bg-card p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold">
              {t("storefront.my_creator.lines_heading")}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("storefront.my_creator.lines_description")}
            </p>
          </div>
          {lines.length > 0 ? (
            <LinkButton
              className="shrink-0"
              href={`${statementCsvPath(creatorId, period)}?${new URLSearchParams({ locale })}`}
              variant="outline"
            >
              {t("storefront.my_creator.download_csv")}
            </LinkButton>
          ) : null}
        </div>
        <StatementLines currency={currency} lines={lines} locale={locale} />
        {previousToken || nextToken ? (
          <Suspense fallback={<ListPagination.Skeleton />}>
            <LinesPaginationNav>
              <ListPagination.Step
                href={
                  previousToken
                    ? creatorStatementHref(creatorId, period, previousToken)
                    : ""
                }
              >
                {t("storefront.common.previous_page")}
              </ListPagination.Step>
              <ListPagination.Step
                href={
                  nextToken
                    ? creatorStatementHref(creatorId, period, nextToken)
                    : ""
                }
              >
                {t("storefront.common.next_page")}
              </ListPagination.Step>
            </LinesPaginationNav>
          </Suspense>
        ) : null}
      </section>

      <p>
        <LocaleLink
          className="text-sm text-primary underline underline-offset-4"
          href={creatorPageHref(creatorId)}
        >
          {t("storefront.my_creator.back_to_creator", { name: creator.name })}
        </LocaleLink>
      </p>
    </div>
  );
};

const StatementPage = (props: StatementPageProps) => (
  <Suspense fallback={<StatementPageSkeleton />}>
    <StatementPageContent {...props} />
  </Suspense>
);

export default StatementPage;
