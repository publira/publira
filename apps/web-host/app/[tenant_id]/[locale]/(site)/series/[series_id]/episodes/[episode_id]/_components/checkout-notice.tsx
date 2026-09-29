import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";

import type { PurchaseSearchParams } from "../_lib/purchase-search-params";

/**
 * What the episode says to a reader coming back from the payment provider.
 * The three outcomes are one state of one thing, so they are decided here
 * rather than as three conditions on the page; a reader who arrived any other
 * way sees nothing.
 *
 * A success is worded as a payment still being applied: the purchase is
 * recorded by the webhook, so the body may still be locked on this very
 * request.
 */
export const CheckoutNotice = ({
  checkout,
}: {
  checkout: PurchaseSearchParams["checkout"];
}) => {
  if (checkout === "success") {
    return (
      <output className="block rounded-control border border-success px-4 py-3 text-sm text-success">
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <Message message="host.episode.checkout_success" />
        </Suspense>
      </output>
    );
  }

  if (checkout === "cancelled") {
    return (
      <output className="block rounded-control border border-warning px-4 py-3 text-sm text-warning">
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <Message message="host.episode.checkout_cancelled" />
        </Suspense>
      </output>
    );
  }

  if (checkout === "error") {
    return (
      <p
        className="block rounded-control border border-destructive px-4 py-3 text-sm text-destructive"
        role="alert"
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <Message message="host.episode.checkout_error" />
        </Suspense>
      </p>
    );
  }

  return null;
};
