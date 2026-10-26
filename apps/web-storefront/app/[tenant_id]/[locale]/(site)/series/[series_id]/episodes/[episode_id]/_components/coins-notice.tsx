import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";

import type { PurchaseSearchParams } from "../_lib/purchase-search-params";

/**
 * What the episode says to a reader whose coins the gate could not use: a
 * price that changed after the gate showed it, a payment that failed, or a
 * pack checkout that could not be started. Every other refusal is a state the
 * gate itself words, so it needs no notice.
 */
export const CoinsNotice = ({
  coinName,
  coins,
}: {
  /** The tenant's word for its coins in the reader's locale. */
  coinName: string;
  coins: PurchaseSearchParams["coins"];
}) => {
  if (coins === "price_changed") {
    return (
      <p
        className="block rounded-control border border-warning px-4 py-3 text-sm text-warning"
        role="alert"
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <Message
            message="storefront.episode.coin_price_changed"
            values={{ coin_name: coinName }}
          />
        </Suspense>
      </p>
    );
  }

  if (coins === "pay_error") {
    return (
      <p
        className="block rounded-control border border-destructive px-4 py-3 text-sm text-destructive"
        role="alert"
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <Message
            message="storefront.episode.coin_pay_error"
            values={{ coin_name: coinName }}
          />
        </Suspense>
      </p>
    );
  }

  if (coins === "pack_unavailable") {
    return (
      <p
        className="block rounded-control border border-destructive px-4 py-3 text-sm text-destructive"
        role="alert"
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <Message message="storefront.coins.checkout_unavailable" />
        </Suspense>
      </p>
    );
  }

  if (coins === "pack_error") {
    return (
      <p
        className="block rounded-control border border-destructive px-4 py-3 text-sm text-destructive"
        role="alert"
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <Message message="storefront.coins.checkout_error" />
        </Suspense>
      </p>
    );
  }

  return null;
};
