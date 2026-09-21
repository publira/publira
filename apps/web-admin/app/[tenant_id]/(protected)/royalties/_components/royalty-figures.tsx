import type { Locale } from "@publira/i18n";
import {
  Figure,
  FigureLabel,
  FigureLine,
  FigureValue,
} from "@publira/ui-components/figure-line";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { formatYen } from "@publira/utils";
import { Suspense } from "react";

import { Message } from "#components/message";
import type { RoyaltyTotals } from "#lib/royalties";

interface RoyaltyFiguresProps {
  locale: Locale;
  totals: RoyaltyTotals;
}

/** A month's own sales, its refunds, and what its lines pay out. */
export const RoyaltyFigures = ({ locale, totals }: RoyaltyFiguresProps) => (
  <FigureLine>
    <Figure>
      <FigureLabel>
        <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
          <Message message="admin.royalties.totals.gross" />
        </Suspense>
      </FigureLabel>
      <FigureValue>{formatYen(totals.gross, { locale })}</FigureValue>
    </Figure>
    <Figure>
      <FigureLabel>
        <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
          <Message message="admin.royalties.totals.refunded" />
        </Suspense>
      </FigureLabel>
      <FigureValue>{formatYen(totals.refunded, { locale })}</FigureValue>
    </Figure>
    <Figure>
      <FigureLabel>
        <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
          <Message message="admin.royalties.totals.payout" />
        </Suspense>
      </FigureLabel>
      <FigureValue>{formatYen(totals.payout, { locale })}</FigureValue>
    </Figure>
  </FigureLine>
);
