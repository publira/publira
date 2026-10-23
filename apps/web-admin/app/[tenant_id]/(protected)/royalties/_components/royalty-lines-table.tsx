import { toIntlLocale } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import * as Table from "@publira/ui-components/table";
import { formatPlainYearMonth } from "@publira/utils";
import { Suspense } from "react";

import { Message } from "#components/message";
import { formatShareBps } from "#lib/credit-share";
import { formatTenantAmount } from "#lib/price";
import { groupRoyaltyLinesByCreator } from "#lib/royalty-lines";
import type { RoyaltyLine } from "#lib/royalty-lines";

interface RoyaltyLinesTableProps {
  /**
   * The currency every amount is in, the statement's or the preview's.
   * `null` when the API answered none, and each amount is then a dash.
   */
  currency: string | null;
  lines: readonly RoyaltyLine[];
  locale: Locale;
}

/** The columns before the payout, which the subtotal label spans. */
const LEADING_COLUMN_COUNT = 7;

/**
 * The lines grouped by author: a heading row naming the author, their lines,
 * and what those lines pay them. Each group is its own `<tbody>`, so the author
 * row heads exactly the rows under it. An adjustment names the closed month it
 * takes refunds back from under its episode, which is what tells its negative
 * figures from a line of the month's own sales.
 */
export const RoyaltyLinesTable = ({
  currency,
  lines,
  locale,
}: RoyaltyLinesTableProps) => {
  const intlLocale = toIntlLocale(locale);

  return (
    <Table.Root>
      <Table.Header>
        <Table.Row>
          <Table.Head>
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="admin.royalties.lines.columns.series" />
            </Suspense>
          </Table.Head>
          <Table.Head>
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="admin.royalties.lines.columns.episode" />
            </Suspense>
          </Table.Head>
          <Table.Head>
            <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
              <Message message="admin.royalties.lines.columns.role" />
            </Suspense>
          </Table.Head>
          <Table.Head className="text-right">
            <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
              <Message message="admin.royalties.lines.columns.sale_count" />
            </Suspense>
          </Table.Head>
          <Table.Head className="text-right">
            <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
              <Message message="admin.royalties.lines.columns.gross" />
            </Suspense>
          </Table.Head>
          <Table.Head className="text-right">
            <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
              <Message message="admin.royalties.lines.columns.refunded" />
            </Suspense>
          </Table.Head>
          <Table.Head className="text-right">
            <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
              <Message message="admin.royalties.lines.columns.share" />
            </Suspense>
          </Table.Head>
          <Table.Head className="text-right">
            <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
              <Message message="admin.royalties.lines.columns.payout" />
            </Suspense>
          </Table.Head>
        </Table.Row>
      </Table.Header>
      {groupRoyaltyLinesByCreator(lines).map((group) => (
        <Table.Body key={group.key}>
          <Table.Row className="bg-muted/50 hover:bg-muted/50">
            <Table.Head
              className="text-foreground"
              colSpan={LEADING_COLUMN_COUNT + 1}
              scope="rowgroup"
            >
              {group.creatorName}
            </Table.Head>
          </Table.Row>
          {group.lines.map((line) => (
            <Table.Row key={line.lineNumber}>
              <Table.Cell>{line.seriesTitle}</Table.Cell>
              <Table.Cell>
                {line.episodeTitle}
                {line.adjustedPeriod ? (
                  <span className="block text-xs text-muted-foreground">
                    <Suspense fallback={<SkeletonLine className="h-3 w-32" />}>
                      <Message
                        message="admin.royalties.lines.adjustment"
                        values={{
                          period: formatPlainYearMonth(line.adjustedPeriod, {
                            locale,
                          }),
                        }}
                      />
                    </Suspense>
                  </span>
                ) : null}
              </Table.Cell>
              <Table.Cell>
                {line.roleName || (
                  <Message message="admin.royalties.lines.no_role" />
                )}
              </Table.Cell>
              <Table.Cell className="text-right">{line.saleCount}</Table.Cell>
              <Table.Cell className="text-right">
                {formatTenantAmount(line.grossAmount, { currency, locale })}
              </Table.Cell>
              <Table.Cell className="text-right">
                {formatTenantAmount(line.refundedAmount, { currency, locale })}
              </Table.Cell>
              <Table.Cell className="text-right">
                {formatShareBps(line.shareBps, intlLocale)}
              </Table.Cell>
              <Table.Cell className="text-right">
                {formatTenantAmount(line.payoutAmount, { currency, locale })}
              </Table.Cell>
            </Table.Row>
          ))}
          <Table.Row>
            <Table.Cell
              className="text-right text-muted-foreground"
              colSpan={LEADING_COLUMN_COUNT}
            >
              <Suspense
                fallback={<SkeletonLine className="ml-auto h-4 w-12" />}
              >
                <Message message="admin.royalties.lines.subtotal" />
              </Suspense>
            </Table.Cell>
            <Table.Cell className="text-right font-medium">
              {formatTenantAmount(group.payoutSubtotal, { currency, locale })}
            </Table.Cell>
          </Table.Row>
        </Table.Body>
      ))}
    </Table.Root>
  );
};
