import type { Locale } from "@publira/i18n";
import * as FigureLine from "@publira/ui-components/figure-line";
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

/**
 * A month's own sales, its refunds, what it takes back of earlier months'
 * sales refunded since their close, and what its lines pay out.
 */
export const RoyaltyFigures = ({
  currency,
  locale,
  totals,
}: RoyaltyFiguresProps) => (
  <FigureLine.Root>
    <FigureLine.Figure>
      <FigureLine.Label>
        <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
          <Message message="admin.royalties.totals.gross" />
        </Suspense>
      </FigureLine.Label>
      <FigureLine.Value>
        {formatTenantAmount(totals.gross, { currency, locale })}
      </FigureLine.Value>
    </FigureLine.Figure>
    <FigureLine.Figure>
      <FigureLine.Label>
        <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
          <Message message="admin.royalties.totals.refunded" />
        </Suspense>
      </FigureLine.Label>
      <FigureLine.Value>
        {formatTenantAmount(totals.refunded, { currency, locale })}
      </FigureLine.Value>
    </FigureLine.Figure>
    <FigureLine.Figure>
      <FigureLine.Label>
        <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
          <Message message="admin.royalties.totals.adjustment" />
        </Suspense>
      </FigureLine.Label>
      <FigureLine.Value>
        {formatTenantAmount(totals.adjustment, { currency, locale })}
      </FigureLine.Value>
    </FigureLine.Figure>
    <FigureLine.Figure>
      <FigureLine.Label>
        <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
          <Message message="admin.royalties.totals.payout" />
        </Suspense>
      </FigureLine.Label>
      <FigureLine.Value>
        {formatTenantAmount(totals.payout, { currency, locale })}
      </FigureLine.Value>
    </FigureLine.Figure>
  </FigureLine.Root>
);
