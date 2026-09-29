import type { Locale } from "@publira/i18n";
import { LinkButton } from "@publira/ui-components/button";
import {
  EmptyStateDescription,
  EmptyStateHeading,
  EmptyStateTitle,
} from "@publira/ui-components/empty-state";
import {
  SectionError,
  SectionErrorDescription,
  SectionErrorHeading,
  SectionErrorTitle,
} from "@publira/ui-components/section-error";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@publira/ui-components/table";
import {
  formatDateTime,
  formatPlainYearMonth,
  formatYen,
} from "@publira/utils";
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
      <SectionError>
        <SectionErrorHeading>
          <SectionErrorTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="admin.royalties.statements.section_error" />
            </Suspense>
          </SectionErrorTitle>
          <SectionErrorDescription>{listErrorMessage}</SectionErrorDescription>
        </SectionErrorHeading>
      </SectionError>
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
          <EmptyStateHeading>
            <EmptyStateTitle>
              <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                <Message message="admin.royalties.statements.empty_title" />
              </Suspense>
            </EmptyStateTitle>
            <EmptyStateDescription>
              <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
                <Message message="admin.royalties.statements.empty_description" />
              </Suspense>
            </EmptyStateDescription>
          </EmptyStateHeading>
        </CursorPageEmptyState>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                  <Message message="admin.royalties.statements.columns.period" />
                </Suspense>
              </TableHead>
              <TableHead>
                <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                  <Message message="admin.royalties.statements.columns.closed_at" />
                </Suspense>
              </TableHead>
              <TableHead>
                <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                  <Message message="admin.royalties.statements.columns.closed_by" />
                </Suspense>
              </TableHead>
              <TableHead className="text-right">
                <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                  <Message message="admin.royalties.statements.columns.gross" />
                </Suspense>
              </TableHead>
              <TableHead className="text-right">
                <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                  <Message message="admin.royalties.statements.columns.refunded" />
                </Suspense>
              </TableHead>
              <TableHead className="text-right">
                <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                  <Message message="admin.royalties.statements.columns.payout" />
                </Suspense>
              </TableHead>
              <TableHead className="text-right">
                <Suspense fallback={<SkeletonLine className="h-4 w-8" />}>
                  <Message message="admin.royalties.statements.columns.export" />
                </Suspense>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {statements.map((statement) => (
              <TableRow key={statement.period}>
                <TableCell className="font-medium">
                  <Link
                    className="underline-offset-4 hover:underline"
                    href={`/royalties/statements/${statement.period}`}
                  >
                    {formatPlainYearMonth(statement.period, { locale })}
                  </Link>
                </TableCell>
                <TableCell>
                  {formatDateTime(statement.closedAt, { locale, timeZone })}
                </TableCell>
                <TableCell>
                  {statement.closedByUserName || (
                    <Message message="admin.royalties.statements.closed_by_none" />
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {formatYen(statement.totals.gross, { locale })}
                </TableCell>
                <TableCell className="text-right">
                  {formatYen(statement.totals.refunded, { locale })}
                </TableCell>
                <TableCell className="text-right">
                  {formatYen(statement.totals.payout, { locale })}
                </TableCell>
                <TableCell className="text-right">
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
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
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
