import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { LocaleLink } from "#components/locale-link";
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
 *
 * It also says that the reader paid what the payment page showed. The checkout
 * prices the episode when it starts, so a campaign that ended after this page
 * quoted it was charged at the regular price, and a page rendered now no
 * longer knows which one the reader saw. The library is where what they paid
 * is written down.
 */
export const CheckoutNotice = ({
  checkout,
}: {
  checkout: PurchaseSearchParams["checkout"];
}) => {
  if (checkout === "success") {
    return (
      <output className="grid gap-1 rounded-control border border-success px-4 py-3 text-sm text-success">
        <span>
          <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
            <Message message="storefront.episode.checkout_success" />
          </Suspense>
        </span>
        <span>
          <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
            <Message message="storefront.episode.checkout_charged" />
          </Suspense>{" "}
          <LocaleLink
            className="underline underline-offset-4"
            href="/my/library"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <Message message="storefront.episode.checkout_view_purchases" />
            </Suspense>
          </LocaleLink>
        </span>
      </output>
    );
  }

  if (checkout === "cancelled") {
    return (
      <output className="block rounded-control border border-warning px-4 py-3 text-sm text-warning">
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <Message message="storefront.episode.checkout_cancelled" />
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
          <Message message="storefront.episode.checkout_error" />
        </Suspense>
      </p>
    );
  }

  return null;
};
