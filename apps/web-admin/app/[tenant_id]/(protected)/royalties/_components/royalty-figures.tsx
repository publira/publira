import type { Locale } from "@publira/i18n";
import {
  Figure,
  FigureLabel,
  FigureLine,
  FigureValue,
} from "@publira/ui-components/figure-line";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import { formatTenantAmount } from "#lib/price";
import type { RoyaltyTotals } from "#lib/royalties";

interface RoyaltyFiguresProps {
  /**
   * The currency every amount is in, the statement's or the preview's.
   * `null` when the API answered none, and each amount is then a dash.
   */
  currency: string | null;
  locale: Locale;
  totals: RoyaltyTotals;
}

/** A month's own sales, its refunds, and what its lines pay out. */
export const RoyaltyFigures = ({
  currency,
  locale,
  totals,
}: RoyaltyFiguresProps) => (
  <FigureLine>
    <Figure>
      <FigureLabel>
        <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
          <Message message="admin.royalties.totals.gross" />
        </Suspense>
      </FigureLabel>
      <FigureValue>
        {formatTenantAmount(totals.gross, { currency, locale })}
      </FigureValue>
    </Figure>
    <Figure>
      <FigureLabel>
        <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
          <Message message="admin.royalties.totals.refunded" />
        </Suspense>
      </FigureLabel>
      <FigureValue>
        {formatTenantAmount(totals.refunded, { currency, locale })}
      </FigureValue>
    </Figure>
    <Figure>
      <FigureLabel>
        <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
          <Message message="admin.royalties.totals.payout" />
        </Suspense>
      </FigureLabel>
      <FigureValue>
        {formatTenantAmount(totals.payout, { currency, locale })}
      </FigureValue>
    </Figure>
  </FigureLine>
);
