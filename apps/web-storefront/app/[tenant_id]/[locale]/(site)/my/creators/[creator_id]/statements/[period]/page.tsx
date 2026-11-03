import { LinkButton } from "@publira/ui-components/button";
import * as FigureLine from "@publira/ui-components/figure-line";
import * as SectionError from "@publira/ui-components/section-error";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { formatDate, formatPlainYearMonth, formatPrice } from "@publira/utils";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Suspense } from "react";
import { z } from "zod";

import * as ListPagination from "#components/list-pagination";
import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";
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
import { getTenantDisplayTimeZone } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

import { CreatorHeading } from "../../../_components/creator-heading";
import { formatCount } from "../../../_lib/figures";
import {
  StatementLines,
  StatementLinesSkeleton,
} from "./_components/statement-lines";

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

const resolveRequest = async ({ params, searchParams }: StatementPageProps) => {
  const [rawParams, resolvedSearchParams, tenantId, locale] = await Promise.all(
    [params, searchParams, getTenantId(), getLocale()]
  );

  const parsed = paramsSchema.safeParse(rawParams);

  if (!parsed.success) {
    notFound();
  }

  const { creator_id: creatorId, period } = parsed.data;
  const { token } = searchParamsSchema.parse(resolvedSearchParams);

  return { creatorId, locale, period, tenantId, token };
};

/**
 * The Author the path names, out of those the account is linked to; any other
 * Author is not found. The heading and the back link both read it.
 */
const readCreator = async (props: StatementPageProps) => {
  const { creatorId, locale, period, tenantId, token } =
    await resolveRequest(props);

  const result = await listMyCreators(tenantId, locale);

  if (!result.ok && result.missing) {
    notFound();
  }

  if (!result.ok) {
    if (result.requiresSignIn) {
      await redirectToLogin(
        locale,
        creatorStatementHref(creatorId, period, token),
        tenantId
      );
    }

    return { message: result.message, ok: false as const };
  }

  const creator = result.value.creators.find(({ id }) => id === creatorId);

  if (!creator) {
    notFound();
  }

  return { ok: true as const, value: creator };
};

/**
 * The Author's part of the closed month the path names, with one page of the
 * lines that make it up. The API answers `missing` for an Author the account
 * is not linked to as well, so the statement needs no Author read of its own.
 * Every section that shows part of it reads it here.
 */
const readStatement = async (props: StatementPageProps) => {
  const request = await resolveRequest(props);
  const { creatorId, locale, period, tenantId, token } = request;

  const result = await getMyCreatorStatement(tenantId, {
    creatorId,
    locale,
    period,
    token,
  });

  if (!result.ok && result.missing) {
    notFound();
  }

  if (!result.ok) {
    if (result.requiresSignIn) {
      await redirectToLogin(
        locale,
        creatorStatementHref(creatorId, period, token),
        tenantId
      );
    }

    return { message: result.message, ok: false as const };
  }

  return { ok: true as const, request, value: result.value };
};

const StatementAuthor = async (props: StatementPageProps) => {
  const creator = await readCreator(props);

  if (!creator.ok) {
    return (
      <SectionError.Root>
        <SectionError.Heading>
          <SectionError.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="storefront.my_creator.load_error" />
            </Suspense>
          </SectionError.Title>
          <SectionError.Description>{creator.message}</SectionError.Description>
        </SectionError.Heading>
      </SectionError.Root>
    );
  }

  return (
    <CreatorHeading creator={creator.value}>
      <p className="font-medium">{creator.value.name}</p>
    </CreatorHeading>
  );
};

/**
 * The month comes from the path, which the statement is read by, so the
 * heading does not wait on that read.
 */
const StatementTitle = async (props: StatementPageProps) => {
  const { locale, period } = await resolveRequest(props);

  return (
    <Message
      message="storefront.my_creator.statement_title"
      values={{ period: formatPlainYearMonth(period, { locale }) }}
    />
  );
};

/** A failed read is reported once, by {@link StatementFigures}. */
const StatementClosedAt = async (props: StatementPageProps) => {
  const result = await readStatement(props);

  if (!result.ok) {
    return null;
  }

  const { locale, tenantId } = result.request;
  const { statement } = result.value;
  const timeZone = await getTenantDisplayTimeZone(tenantId);

  return (
    <p className="text-sm text-muted-foreground">
      <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
        <Message
          message="storefront.my_creator.statement_closed_at"
          values={{
            currency: statement.currency,
            date: formatDate(statement.closedAt, { locale, timeZone }),
          }}
        />
      </Suspense>
    </p>
  );
};

/** What the month sums to for the Author. */
const StatementFigures = async (props: StatementPageProps) => {
  const result = await readStatement(props);

  if (!result.ok) {
    return (
      <SectionError.Root>
        <SectionError.Heading>
          <SectionError.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="storefront.my_creator.statement_error" />
            </Suspense>
          </SectionError.Title>
          <SectionError.Description>{result.message}</SectionError.Description>
        </SectionError.Heading>
      </SectionError.Root>
    );
  }

  const { locale } = result.request;
  const { statement } = result.value;
  const { currency } = statement;

  return (
    <FigureLine.Root>
      <FigureLine.Figure>
        <FigureLine.Label>
          <Suspense fallback={<SkeletonLine className="h-4 w-10" />}>
            <Message message="storefront.my_creator.sales" />
          </Suspense>
        </FigureLine.Label>
        <FigureLine.Value>
          {formatCount(statement.saleCount, locale)}
        </FigureLine.Value>
      </FigureLine.Figure>
      <FigureLine.Figure>
        <FigureLine.Label>
          <Suspense fallback={<SkeletonLine className="h-4 w-10" />}>
            <Message message="storefront.my_creator.gross" />
          </Suspense>
        </FigureLine.Label>
        <FigureLine.Value>
          {formatPrice(statement.grossAmount, { currency, locale })}
        </FigureLine.Value>
      </FigureLine.Figure>
      <FigureLine.Figure>
        <FigureLine.Label>
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="storefront.my_creator.refunded" />
          </Suspense>
        </FigureLine.Label>
        <FigureLine.Value>
          {formatPrice(statement.refundedAmount, { currency, locale })}
        </FigureLine.Value>
      </FigureLine.Figure>
      <FigureLine.Figure>
        <FigureLine.Label>
          <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
            <Message message="storefront.my_creator.payout" />
          </Suspense>
        </FigureLine.Label>
        <FigureLine.Value>
          {formatPrice(statement.payoutAmount, { currency, locale })}
        </FigureLine.Value>
      </FigureLine.Figure>
    </FigureLine.Root>
  );
};

/**
 * What stands in for {@link StatementFigures}. Its labels name nothing the
 * statement says, so it writes them into the same geometry around a
 * placeholder for each figure.
 */
const StatementFiguresSkeleton = () => (
  <FigureLine.Root>
    <FigureLine.Figure>
      <FigureLine.Label>
        <Suspense fallback={<SkeletonLine className="h-4 w-10" />}>
          <Message message="storefront.my_creator.sales" />
        </Suspense>
      </FigureLine.Label>
      <FigureLine.Value>
        <SkeletonLine className="h-7 w-12" />
      </FigureLine.Value>
    </FigureLine.Figure>
    <FigureLine.Figure>
      <FigureLine.Label>
        <Suspense fallback={<SkeletonLine className="h-4 w-10" />}>
          <Message message="storefront.my_creator.gross" />
        </Suspense>
      </FigureLine.Label>
      <FigureLine.Value>
        <SkeletonLine className="h-7 w-20" />
      </FigureLine.Value>
    </FigureLine.Figure>
    <FigureLine.Figure>
      <FigureLine.Label>
        <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
          <Message message="storefront.my_creator.refunded" />
        </Suspense>
      </FigureLine.Label>
      <FigureLine.Value>
        <SkeletonLine className="h-7 w-20" />
      </FigureLine.Value>
    </FigureLine.Figure>
    <FigureLine.Figure>
      <FigureLine.Label>
        <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
          <Message message="storefront.my_creator.payout" />
        </Suspense>
      </FigureLine.Label>
      <FigureLine.Value>
        <SkeletonLine className="h-7 w-20" />
      </FigureLine.Value>
    </FigureLine.Figure>
  </FigureLine.Root>
);

/** Offered only for a month with lines to download. */
const StatementDownload = async (props: StatementPageProps) => {
  const result = await readStatement(props);

  if (!result.ok || result.value.lines.length === 0) {
    return null;
  }

  const { creatorId, locale, period } = result.request;

  return (
    <LinkButton
      className="shrink-0"
      href={`${statementCsvPath(creatorId, period)}?${new URLSearchParams({ locale })}`}
      variant="outline"
    >
      <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
        <Message message="storefront.my_creator.download_csv" />
      </Suspense>
    </LinkButton>
  );
};

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

/** A failed read is reported once, by {@link StatementFigures}. */
const StatementLinesSection = async (props: StatementPageProps) => {
  const result = await readStatement(props);

  if (!result.ok) {
    return null;
  }

  const { creatorId, locale, period } = result.request;
  const { lines, nextToken, previousToken, statement } = result.value;

  return (
    <>
      <StatementLines
        currency={statement.currency}
        lines={lines}
        locale={locale}
      />
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
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="storefront.common.previous_page" />
              </Suspense>
            </ListPagination.Step>
            <ListPagination.Step
              href={
                nextToken
                  ? creatorStatementHref(creatorId, period, nextToken)
                  : ""
              }
            >
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="storefront.common.next_page" />
              </Suspense>
            </ListPagination.Step>
          </LinesPaginationNav>
        </Suspense>
      ) : null}
    </>
  );
};

const StatementBackLink = async (props: StatementPageProps) => {
  const creator = await readCreator(props);

  if (!creator.ok) {
    return null;
  }

  return (
    <LocaleLink
      className="text-sm text-primary underline underline-offset-4"
      href={creatorPageHref(creator.value.id)}
    >
      <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
        <Message
          message="storefront.my_creator.back_to_creator"
          values={{ name: creator.value.name }}
        />
      </Suspense>
    </LocaleLink>
  );
};

/**
 * The Author's part of one closed month: what it sums to, and the lines that
 * name them, with the download of those lines. The month's lines for other
 * Authors and its totals are never read, so nothing here can show them.
 */
const StatementPage = (props: StatementPageProps) => (
  <div className="space-y-6 px-4 py-6 sm:px-6 lg:px-8">
    <section className="grid gap-4 border border-border bg-card p-6">
      <Suspense fallback={<SkeletonLine className="h-14 w-48" />}>
        <StatementAuthor {...props} />
      </Suspense>
      <div className="grid gap-1">
        <h1 className="text-xl font-semibold">
          <Suspense fallback={<SkeletonLine className="h-6 w-48" />}>
            <StatementTitle {...props} />
          </Suspense>
        </h1>
        <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
          <StatementClosedAt {...props} />
        </Suspense>
      </div>
      <SectionErrorBoundary
        title={
          <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
            <Message message="storefront.my_creator.statement_error" />
          </Suspense>
        }
      >
        <Suspense fallback={<StatementFiguresSkeleton />}>
          <StatementFigures {...props} />
        </Suspense>
      </SectionErrorBoundary>
    </section>

    <section className="grid gap-4 border border-border bg-card p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">
            <Suspense fallback={<SkeletonLine className="h-6 w-20" />}>
              <Message message="storefront.my_creator.lines_heading" />
            </Suspense>
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
              <Message message="storefront.my_creator.lines_description" />
            </Suspense>
          </p>
        </div>
        <Suspense fallback={null}>
          <StatementDownload {...props} />
        </Suspense>
      </div>
      <SectionErrorBoundary
        title={
          <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
            <Message message="storefront.my_creator.statement_error" />
          </Suspense>
        }
      >
        <Suspense fallback={<StatementLinesSkeleton />}>
          <StatementLinesSection {...props} />
        </Suspense>
      </SectionErrorBoundary>
    </section>

    <p>
      <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
        <StatementBackLink {...props} />
      </Suspense>
    </p>
  </div>
);

export default StatementPage;
