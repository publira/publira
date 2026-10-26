import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";

import { parseCoinsSearchParams } from "../_lib/search-params";
import type { CoinsPageSearchParams } from "../_lib/search-params";

/**
 * What `/my/coins` says to a reader coming back from buying a pack. A reader
 * who arrived any other way sees nothing.
 *
 * A paid checkout is worded as a payment still being confirmed: the coins are
 * granted by the payment provider's notification, so the balance may not show
 * them on this very request.
 */
export const CoinsNotice = async ({
  coinName,
  searchParams,
}: {
  /** The tenant's word for its coins in the reader's locale. */
  coinName: string;
  searchParams: CoinsPageSearchParams;
}) => {
  const { checkout } = parseCoinsSearchParams(await searchParams);

  if (checkout === "success") {
    return (
      <output className="block rounded-control border border-success px-4 py-3 text-sm text-success">
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <Message
            message="storefront.coins.checkout_success"
            values={{ coin_name: coinName }}
          />
        </Suspense>
      </output>
    );
  }

  if (checkout === "cancelled") {
    return (
      <output className="block rounded-control border border-warning px-4 py-3 text-sm text-warning">
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <Message message="storefront.coins.checkout_cancelled" />
        </Suspense>
      </output>
    );
  }

  if (checkout === "unavailable") {
    return (
      <p
        className="rounded-control border border-destructive px-4 py-3 text-sm text-destructive"
        role="alert"
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <Message message="storefront.coins.checkout_unavailable" />
        </Suspense>
      </p>
    );
  }

  if (checkout === "error") {
    return (
      <p
        className="rounded-control border border-destructive px-4 py-3 text-sm text-destructive"
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
