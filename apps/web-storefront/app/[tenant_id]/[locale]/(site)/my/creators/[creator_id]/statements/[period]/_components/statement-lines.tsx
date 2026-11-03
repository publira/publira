import type { Locale } from "@publira/i18n";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import * as Table from "@publira/ui-components/table";
import { formatPlainYearMonth, formatPrice } from "@publira/utils";
import { Suspense } from "react";

import { Message } from "#components/message";
import type { MyCreatorStatementLineItem } from "#lib/creator-pages";

import { formatCount, formatShareBps } from "../../../../_lib/figures";

/**
 * The column labels, which name nothing the statement says, so the skeleton
 * writes the same row above its placeholder and they stay in the static shell.
 */
const StatementLinesHeader = () => (
  <Table.Header>
    <Table.Row>
      <Table.Head>
        <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
          <Message message="storefront.my_creator.series" />
        </Suspense>
      </Table.Head>
      <Table.Head>
        <Suspense fallback={<SkeletonLine className="h-4 w-14" />}>
          <Message message="storefront.my_creator.episode" />
        </Suspense>
      </Table.Head>
      <Table.Head>
        <Suspense fallback={<SkeletonLine className="h-4 w-10" />}>
          <Message message="storefront.my_creator.role" />
        </Suspense>
      </Table.Head>
      <Table.Head className="text-right">
        <Suspense fallback={<SkeletonLine className="ml-auto h-4 w-10" />}>
          <Message message="storefront.my_creator.sales" />
        </Suspense>
      </Table.Head>
      <Table.Head className="text-right">
        <Suspense fallback={<SkeletonLine className="ml-auto h-4 w-10" />}>
          <Message message="storefront.my_creator.gross" />
        </Suspense>
      </Table.Head>
      <Table.Head className="text-right">
        <Suspense fallback={<SkeletonLine className="ml-auto h-4 w-16" />}>
          <Message message="storefront.my_creator.refunded" />
        </Suspense>
      </Table.Head>
      <Table.Head className="text-right">
        <Suspense fallback={<SkeletonLine className="ml-auto h-4 w-10" />}>
          <Message message="storefront.my_creator.share" />
        </Suspense>
      </Table.Head>
      <Table.Head className="text-right">
        <Suspense fallback={<SkeletonLine className="ml-auto h-4 w-12" />}>
          <Message message="storefront.my_creator.payout" />
        </Suspense>
      </Table.Head>
    </Table.Row>
  </Table.Header>
);

/**
 * The Author's lines of one closed month, in the statement's order. A line of
 * subscription payments says so under its episode, and an adjustment names
 * the closed month it takes refunds back from there too, which is what tells
 * its negative figures from a line of the month's own sales — as the console's
 * statement marks them.
 */
export const StatementLines = ({
  currency,
  lines,
  locale,
}: {
  currency: string;
  lines: readonly MyCreatorStatementLineItem[];
  locale: Locale;
}) => (
  <Table.Root>
    <StatementLinesHeader />
    <Table.Body>
      {lines.length === 0 ? (
        <Table.EmptyRow colSpan={8}>
          <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
            <Message message="storefront.my_creator.lines_empty" />
          </Suspense>
        </Table.EmptyRow>
      ) : (
        lines.map((line) => (
          <Table.Row key={line.lineNumber}>
            <Table.Cell>{line.seriesTitle}</Table.Cell>
            <Table.Cell>
              {line.episodeTitle}
              {line.source === "subscription" ? (
                <span className="block text-xs text-muted-foreground">
                  <Suspense fallback={<SkeletonLine className="h-3 w-24" />}>
                    <Message message="storefront.my_creator.subscription" />
                  </Suspense>
                </span>
              ) : null}
              {line.adjustedPeriod ? (
                <span className="block text-xs text-muted-foreground">
                  <Suspense fallback={<SkeletonLine className="h-3 w-40" />}>
                    <Message
                      message="storefront.my_creator.adjustment"
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
                <Suspense fallback={<SkeletonLine className="h-4 w-4" />}>
                  <Message message="storefront.my_creator.no_role" />
                </Suspense>
              )}
            </Table.Cell>
            <Table.Cell className="text-right">
              {formatCount(line.saleCount, locale)}
            </Table.Cell>
            <Table.Cell className="text-right">
              {formatPrice(line.grossAmount, { currency, locale })}
            </Table.Cell>
            <Table.Cell className="text-right">
              {formatPrice(line.refundedAmount, { currency, locale })}
            </Table.Cell>
            <Table.Cell className="text-right">
              {formatShareBps(line.shareBps, locale)}
            </Table.Cell>
            <Table.Cell className="text-right">
              {formatPrice(line.payoutAmount, { currency, locale })}
            </Table.Cell>
          </Table.Row>
        ))
      )}
    </Table.Body>
  </Table.Root>
);

/** What stands in for {@link StatementLines} while the statement reads. */
export const StatementLinesSkeleton = () => (
  <Table.Root>
    <StatementLinesHeader />
    <Table.Body>
      <Table.Row>
        <Table.Cell colSpan={8}>
          <Skeleton className="h-24 w-full" />
        </Table.Cell>
      </Table.Row>
    </Table.Body>
  </Table.Root>
);
