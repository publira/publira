import { toIntlLocale } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import * as Table from "@publira/ui-components/table";
import { formatPlainYearMonth } from "@publira/utils";
import { Suspense } from "react";

import { Message } from "#components/message";
import type { AdminMessageKey } from "#components/message";
import { formatShareBps } from "#lib/credit-share";
import { formatTenantAmount } from "#lib/price";
import { groupRoyaltyLinesByCreator } from "#lib/royalty-lines";
import type { RoyaltyLine, RoyaltyLineSource } from "#lib/royalty-lines";

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

/** The tax rate and the tax, after the payout, on a month that states tax. */
const TAX_COLUMN_COUNT = 2;

/** What a line that is not one of sales says under its episode. */
const SOURCE_LABELS: Record<
  Exclude<RoyaltyLineSource, "sale">,
  AdminMessageKey
> = {
  subscription: "admin.royalties.lines.subscription",
  tip: "admin.royalties.lines.tip",
};

const SOURCE_SUBTOTAL_LABELS: Record<RoyaltyLineSource, AdminMessageKey> = {
  sale: "admin.royalties.lines.sale_subtotal",
  subscription: "admin.royalties.lines.subscription_subtotal",
  tip: "admin.royalties.lines.tip_subtotal",
};

/** A subtotal's cells under the tax columns: none, or the tax it includes. */
const TaxSubtotalCells = ({
  currency,
  locale,
  tax,
}: {
  currency: string | null;
  locale: Locale;
  tax: bigint | null;
}) => (
  <>
    <Table.Cell />
    <Table.Cell className="text-right">
      {tax === null ? null : formatTenantAmount(tax, { currency, locale })}
    </Table.Cell>
  </>
);

/**
 * The lines grouped by author: a heading row naming the author, their lines,
 * and what those lines pay them. Each group is its own `<tbody>`, so the author
 * row heads exactly the rows under it. An adjustment names the closed month it
 * takes refunds back from under its episode, which is what tells its negative
 * figures from a line of the month's own sales. A line of tips or of
 * subscription payments says so under its episode too, and an author who has
 * one is given a subtotal for each source above their total. Where a line
 * has a tax rate, every line gives its rate and the tax its payout includes,
 * and the Author's total the tax of their lines.
 */
export const RoyaltyLinesTable = ({
  currency,
  lines,
  locale,
}: RoyaltyLinesTableProps) => {
  const intlLocale = toIntlLocale(locale);

  // A tenant that never set a rate has no line with one, and keeps the
  // columns it always had.
  const withTax = lines.some(
    (line) => line.taxRateBps !== null || line.taxAmount !== null
  );

  const columnCount =
    LEADING_COLUMN_COUNT + 1 + (withTax ? TAX_COLUMN_COUNT : 0);

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
          {withTax ? (
            <>
              <Table.Head className="text-right">
                <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                  <Message message="admin.royalties.lines.columns.tax_rate" />
                </Suspense>
              </Table.Head>
              <Table.Head className="text-right">
                <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                  <Message message="admin.royalties.lines.columns.tax" />
                </Suspense>
              </Table.Head>
            </>
          ) : null}
        </Table.Row>
      </Table.Header>
      {groupRoyaltyLinesByCreator(lines).map((group) => (
        <Table.Body key={group.key}>
          <Table.Row className="bg-muted/50 hover:bg-muted/50">
            <Table.Head
              className="text-foreground"
              colSpan={columnCount}
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
                {line.source === "sale" ? null : (
                  <span className="block text-xs text-muted-foreground">
                    <Suspense fallback={<SkeletonLine className="h-3 w-28" />}>
                      <Message message={SOURCE_LABELS[line.source]} />
                    </Suspense>
                  </span>
                )}
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
              {withTax ? (
                <>
                  <Table.Cell className="text-right">
                    {line.taxRateBps === null ? (
                      <Message message="admin.royalties.lines.no_tax_rate" />
                    ) : (
                      formatShareBps(line.taxRateBps, intlLocale)
                    )}
                  </Table.Cell>
                  <Table.Cell className="text-right">
                    {line.taxAmount === null ? (
                      <Message message="admin.royalties.lines.no_tax_rate" />
                    ) : (
                      formatTenantAmount(line.taxAmount, { currency, locale })
                    )}
                  </Table.Cell>
                </>
              ) : null}
            </Table.Row>
          ))}
          {group.sourceSubtotals?.map(({ payoutAmount, source }) => (
            <Table.Row key={source}>
              <Table.Cell
                className="text-right text-muted-foreground"
                colSpan={LEADING_COLUMN_COUNT}
              >
                <Suspense
                  fallback={<SkeletonLine className="ml-auto h-4 w-32" />}
                >
                  <Message message={SOURCE_SUBTOTAL_LABELS[source]} />
                </Suspense>
              </Table.Cell>
              <Table.Cell className="text-right">
                {formatTenantAmount(payoutAmount, { currency, locale })}
              </Table.Cell>
              {withTax ? (
                <TaxSubtotalCells
                  currency={currency}
                  locale={locale}
                  tax={null}
                />
              ) : null}
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
            {withTax ? (
              <TaxSubtotalCells
                currency={currency}
                locale={locale}
                tax={group.taxSubtotal}
              />
            ) : null}
          </Table.Row>
        </Table.Body>
      ))}
    </Table.Root>
  );
};
