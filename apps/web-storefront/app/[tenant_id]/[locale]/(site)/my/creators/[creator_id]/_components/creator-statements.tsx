import type { Locale } from "@publira/i18n";
import * as SectionError from "@publira/ui-components/section-error";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import * as Table from "@publira/ui-components/table";
import { formatPlainYearMonth, formatPrice } from "@publira/utils";
import type { ReactNode } from "react";
import { Suspense } from "react";

import * as ListPagination from "#components/list-pagination";
import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { redirectToLogin } from "#lib/auth-session";
import { creatorPageHref, creatorStatementHref } from "#lib/creator-page-paths";
import { listMyCreatorStatements } from "#lib/creator-pages";
import { getMessages } from "#lib/get-messages";
import { getMessagesFor } from "#lib/messages";

import { formatCount } from "../../_lib/figures";

/**
 * Its heading names the section, which is what turns the `<section>` into a
 * landmark a reader can jump to and a test can scope to.
 */
const STATEMENTS_HEADING_ID = "creator-statements-heading";

interface CreatorStatementsProps {
  creatorId: string;
  locale: Locale;
  tenantId: string;
  /** The episode list's cursor, which the statement pages keep. */
  episodesToken: string;
  token: string;
}

const StatementsPaginationNav = async ({
  children,
}: {
  children: ReactNode;
}) => {
  const t = await getMessages();

  return (
    <ListPagination.Root
      aria-label={t("storefront.my_creator.statements_pagination_aria")}
    >
      {children}
    </ListPagination.Root>
  );
};

/**
 * The Author's part of every closed month, newest first, each linking to its
 * lines. A month that credited the Author nothing is listed with zeros, so the
 * list is the tenant's closed months whichever of them paid this Author.
 *
 * A tenant that stopped showing sales after the page read `salesVisible`
 * answers `missing`, and the section is then left out.
 */
export const CreatorStatements = async ({
  creatorId,
  episodesToken,
  locale,
  tenantId,
  token,
}: CreatorStatementsProps) => {
  const result = await listMyCreatorStatements(tenantId, {
    creatorId,
    locale,
    token,
  });

  if (!result.ok && result.missing) {
    return null;
  }

  if (!result.ok && result.requiresSignIn) {
    await redirectToLogin(
      locale,
      creatorPageHref(creatorId, {
        statementsToken: token,
        token: episodesToken,
      }),
      tenantId
    );
  }

  if (!result.ok) {
    return (
      <SectionError.Root>
        <SectionError.Heading>
          <SectionError.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="storefront.my_creator.statements_error" />
            </Suspense>
          </SectionError.Title>
          <SectionError.Description>{result.message}</SectionError.Description>
        </SectionError.Heading>
      </SectionError.Root>
    );
  }

  const { nextToken, previousToken, statements } = result.value;
  const t = await getMessagesFor(locale);

  return (
    <section
      aria-labelledby={STATEMENTS_HEADING_ID}
      className="grid gap-4 border border-border bg-card p-6"
    >
      <div>
        <h2 className="text-lg font-semibold" id={STATEMENTS_HEADING_ID}>
          {t("storefront.my_creator.statements_heading")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("storefront.my_creator.statements_description")}
        </p>
      </div>
      <Table.Root>
        <Table.Header>
          <Table.Row>
            <Table.Head>{t("storefront.my_creator.month")}</Table.Head>
            <Table.Head className="text-right">
              {t("storefront.my_creator.sales")}
            </Table.Head>
            <Table.Head className="text-right">
              {t("storefront.my_creator.gross")}
            </Table.Head>
            <Table.Head className="text-right">
              {t("storefront.my_creator.refunded")}
            </Table.Head>
            <Table.Head className="text-right">
              {t("storefront.my_creator.payout")}
            </Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {statements.length === 0 ? (
            <Table.EmptyRow colSpan={5}>
              {t("storefront.my_creator.statements_empty")}
            </Table.EmptyRow>
          ) : (
            statements.map((statement) => (
              <Table.Row key={statement.period}>
                <Table.Cell className="font-medium">
                  <LocaleLink
                    className="underline-offset-4 hover:underline"
                    href={creatorStatementHref(creatorId, statement.period)}
                  >
                    {formatPlainYearMonth(statement.period, { locale })}
                  </LocaleLink>
                </Table.Cell>
                <Table.Cell className="text-right">
                  {formatCount(statement.saleCount, locale)}
                </Table.Cell>
                <Table.Cell className="text-right">
                  {formatPrice(statement.grossAmount, {
                    currency: statement.currency,
                    locale,
                  })}
                </Table.Cell>
                <Table.Cell className="text-right">
                  {formatPrice(statement.refundedAmount, {
                    currency: statement.currency,
                    locale,
                  })}
                </Table.Cell>
                <Table.Cell className="text-right">
                  {formatPrice(statement.payoutAmount, {
                    currency: statement.currency,
                    locale,
                  })}
                </Table.Cell>
              </Table.Row>
            ))
          )}
        </Table.Body>
      </Table.Root>
      {previousToken || nextToken ? (
        <Suspense fallback={<ListPagination.Skeleton />}>
          <StatementsPaginationNav>
            <ListPagination.Step
              href={
                previousToken
                  ? creatorPageHref(creatorId, {
                      statementsToken: previousToken,
                      token: episodesToken,
                    })
                  : ""
              }
            >
              {t("storefront.common.previous_page")}
            </ListPagination.Step>
            <ListPagination.Step
              href={
                nextToken
                  ? creatorPageHref(creatorId, {
                      statementsToken: nextToken,
                      token: episodesToken,
                    })
                  : ""
              }
            >
              {t("storefront.common.next_page")}
            </ListPagination.Step>
          </StatementsPaginationNav>
        </Suspense>
      ) : null}
    </section>
  );
};

/** What stands in for {@link CreatorStatements} while it reads. */
export const CreatorStatementsSkeleton = () => (
  <section className="grid gap-4 border border-border bg-card p-6">
    <SkeletonLine className="h-6 w-40" />
    <Skeleton className="h-32 w-full" />
  </section>
);
