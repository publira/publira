import { toIntlLocale } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@publira/ui-components/table";
import { formatYen } from "@publira/utils";
import { Suspense } from "react";

import { Message } from "#components/message";
import { formatShareBps } from "#lib/credit-share";
import { groupRoyaltyLinesByCreator } from "#lib/royalty-lines";
import type { RoyaltyLine } from "#lib/royalty-lines";

interface RoyaltyLinesTableProps {
  lines: readonly RoyaltyLine[];
  locale: Locale;
}

/** The columns before the payout, which the subtotal label spans. */
const LEADING_COLUMN_COUNT = 7;

/**
 * The lines grouped by author: a heading row naming the author, their lines,
 * and what those lines pay them. Each group is its own `<tbody>`, so the author
 * row heads exactly the rows under it.
 */
export const RoyaltyLinesTable = ({
  lines,
  locale,
}: RoyaltyLinesTableProps) => {
  const intlLocale = toIntlLocale(locale);

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="admin.royalties.lines.columns.series" />
            </Suspense>
          </TableHead>
          <TableHead>
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="admin.royalties.lines.columns.episode" />
            </Suspense>
          </TableHead>
          <TableHead>
            <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
              <Message message="admin.royalties.lines.columns.role" />
            </Suspense>
          </TableHead>
          <TableHead className="text-right">
            <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
              <Message message="admin.royalties.lines.columns.sale_count" />
            </Suspense>
          </TableHead>
          <TableHead className="text-right">
            <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
              <Message message="admin.royalties.lines.columns.gross" />
            </Suspense>
          </TableHead>
          <TableHead className="text-right">
            <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
              <Message message="admin.royalties.lines.columns.refunded" />
            </Suspense>
          </TableHead>
          <TableHead className="text-right">
            <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
              <Message message="admin.royalties.lines.columns.share" />
            </Suspense>
          </TableHead>
          <TableHead className="text-right">
            <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
              <Message message="admin.royalties.lines.columns.payout" />
            </Suspense>
          </TableHead>
        </TableRow>
      </TableHeader>
      {groupRoyaltyLinesByCreator(lines).map((group) => (
        <TableBody key={group.key}>
          <TableRow className="bg-muted/50 hover:bg-muted/50">
            <TableHead
              className="text-foreground"
              colSpan={LEADING_COLUMN_COUNT + 1}
              scope="rowgroup"
            >
              {group.creatorName}
            </TableHead>
          </TableRow>
          {group.lines.map((line) => (
            <TableRow key={line.lineNumber}>
              <TableCell>{line.seriesTitle}</TableCell>
              <TableCell>{line.episodeTitle}</TableCell>
              <TableCell>
                {line.roleName || (
                  <Message message="admin.royalties.lines.no_role" />
                )}
              </TableCell>
              <TableCell className="text-right">{line.saleCount}</TableCell>
              <TableCell className="text-right">
                {formatYen(line.grossAmount, { locale })}
              </TableCell>
              <TableCell className="text-right">
                {formatYen(line.refundedAmount, { locale })}
              </TableCell>
              <TableCell className="text-right">
                {formatShareBps(line.shareBps, intlLocale)}
              </TableCell>
              <TableCell className="text-right">
                {formatYen(line.payoutAmount, { locale })}
              </TableCell>
            </TableRow>
          ))}
          <TableRow>
            <TableCell
              className="text-right text-muted-foreground"
              colSpan={LEADING_COLUMN_COUNT}
            >
              <Suspense
                fallback={<SkeletonLine className="ml-auto h-4 w-12" />}
              >
                <Message message="admin.royalties.lines.subtotal" />
              </Suspense>
            </TableCell>
            <TableCell className="text-right font-medium">
              {formatYen(group.payoutSubtotal, { locale })}
            </TableCell>
          </TableRow>
        </TableBody>
      ))}
    </Table>
  );
};
