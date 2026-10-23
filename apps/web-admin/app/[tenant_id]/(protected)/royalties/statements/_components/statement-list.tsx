import type { Locale } from "@publira/i18n";
import { LinkButton } from "@publira/ui-components/button";
import * as EmptyState from "@publira/ui-components/empty-state";
import * as SectionError from "@publira/ui-components/section-error";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import * as Table from "@publira/ui-components/table";
import { formatDateTime, formatPlainYearMonth } from "@publira/utils";
import Link from "next/link";
import { Suspense } from "react";

import { AdminSection } from "#components/admin-page";
import { CursorPageEmptyState } from "#components/cursor-page-empty-state";
import { Message } from "#components/message";
import {
  PaginationControls,
  PaginationFooter,
  PaginationFooterDescription,
} from "#components/pagination-controls";
import type { CursorPageHrefs } from "#lib/cursor-page";
import { hasCursorPageLinks } from "#lib/cursor-page";
import { getMessagesFor } from "#lib/messages";
import { formatTenantAmount } from "#lib/price";
import type { RoyaltyStatementSummary } from "#lib/royalties";
import { royaltyStatementCsvPath } from "#lib/royalty-period";

type StatementListProps = CursorPageHrefs & {
  listErrorMessage?: string;
  locale: Locale;
  pageSize: number;
  statements: RoyaltyStatementSummary[];
  timeZone: string;
};

/** The closed months, newest first, each linking to its statement. */
export const StatementList = async ({
  listErrorMessage,
  locale,
  nextHref,
  pageSize,
  previousHref,
  statements,
  timeZone,
}: StatementListProps) => {
  if (listErrorMessage) {
    return (
      <SectionError.Root>
        <SectionError.Heading>
          <SectionError.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="admin.royalties.statements.section_error" />
            </Suspense>
          </SectionError.Title>
          <SectionError.Description>
            {listErrorMessage}
          </SectionError.Description>
        </SectionError.Heading>
      </SectionError.Root>
    );
  }

  const t = await getMessagesFor(locale);
  const hasPageLinks = hasCursorPageLinks({ nextHref, previousHref });

  return (
    <AdminSection>
      {statements.length === 0 ? (
        <CursorPageEmptyState
          hasPageLinks={hasPageLinks}
          itemLabel={t("admin.royalties.statements.item_label")}
        >
          <EmptyState.Heading>
            <EmptyState.Title>
              <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                <Message message="admin.royalties.statements.empty_title" />
              </Suspense>
            </EmptyState.Title>
            <EmptyState.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
                <Message message="admin.royalties.statements.empty_description" />
              </Suspense>
            </EmptyState.Description>
          </EmptyState.Heading>
        </CursorPageEmptyState>
      ) : (
        <Table.Root>
          <Table.Header>
            <Table.Row>
              <Table.Head>
                <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                  <Message message="admin.royalties.statements.columns.period" />
                </Suspense>
              </Table.Head>
              <Table.Head>
                <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                  <Message message="admin.royalties.statements.columns.closed_at" />
                </Suspense>
              </Table.Head>
              <Table.Head>
                <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                  <Message message="admin.royalties.statements.columns.closed_by" />
                </Suspense>
              </Table.Head>
              <Table.Head className="text-right">
                <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                  <Message message="admin.royalties.statements.columns.gross" />
                </Suspense>
              </Table.Head>
              <Table.Head className="text-right">
                <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                  <Message message="admin.royalties.statements.columns.refunded" />
                </Suspense>
              </Table.Head>
              <Table.Head className="text-right">
                <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                  <Message message="admin.royalties.statements.columns.adjustment" />
                </Suspense>
              </Table.Head>
              <Table.Head className="text-right">
                <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                  <Message message="admin.royalties.statements.columns.payout" />
                </Suspense>
              </Table.Head>
              <Table.Head className="text-right">
                <Suspense fallback={<SkeletonLine className="h-4 w-8" />}>
                  <Message message="admin.royalties.statements.columns.export" />
                </Suspense>
              </Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {statements.map((statement) => (
              <Table.Row key={statement.period}>
                <Table.Cell className="font-medium">
                  <Link
                    className="underline-offset-4 hover:underline"
                    href={`/royalties/statements/${statement.period}`}
                  >
                    {formatPlainYearMonth(statement.period, { locale })}
                  </Link>
                </Table.Cell>
                <Table.Cell>
                  {formatDateTime(statement.closedAt, { locale, timeZone })}
                </Table.Cell>
                <Table.Cell>
                  {statement.closedByUserName || (
                    <Message message="admin.royalties.statements.closed_by_none" />
                  )}
                </Table.Cell>
                <Table.Cell className="text-right">
                  {formatTenantAmount(statement.totals.gross, {
                    currency: statement.currency,
                    locale,
                  })}
                </Table.Cell>
                <Table.Cell className="text-right">
                  {formatTenantAmount(statement.totals.refunded, {
                    currency: statement.currency,
                    locale,
                  })}
                </Table.Cell>
                <Table.Cell className="text-right">
                  {formatTenantAmount(statement.totals.adjustment, {
                    currency: statement.currency,
                    locale,
                  })}
                </Table.Cell>
                <Table.Cell className="text-right">
                  {formatTenantAmount(statement.totals.payout, {
                    currency: statement.currency,
                    locale,
                  })}
                </Table.Cell>
                <Table.Cell className="text-right">
                  <LinkButton
                    aria-label={t("admin.royalties.export.row_label", {
                      period: formatPlainYearMonth(statement.period, {
                        locale,
                      }),
                    })}
                    href={royaltyStatementCsvPath(statement.period)}
                    size="sm"
                    variant="outline"
                  >
                    <Message message="admin.royalties.export.button" />
                  </LinkButton>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      )}

      {statements.length > 0 || hasPageLinks ? (
        <PaginationFooter>
          <PaginationFooterDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
              <Message
                message="admin.royalties.statements.pagination_description"
                values={{ count: String(pageSize) }}
              />
            </Suspense>
          </PaginationFooterDescription>
          <PaginationControls
            aria-label={t("admin.royalties.statements.pagination_aria")}
            nextHref={nextHref}
            previousHref={previousHref}
          />
        </PaginationFooter>
      ) : null}
    </AdminSection>
  );
};
