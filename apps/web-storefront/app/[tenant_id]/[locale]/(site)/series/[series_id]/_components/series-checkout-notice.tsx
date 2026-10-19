import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";

import { parseSeriesCheckoutSearchParams } from "../_lib/checkout-search-params";

/**
 * What the series page says to a reader coming back from buying a volume or
 * the rest of the series. The three outcomes are one state of one thing, so
 * they are decided here; a reader who arrived any other way sees nothing.
 *
 * A success is worded as a payment still being applied: the purchase is
 * recorded by the provider's notification, so the episodes may still be
 * locked on this very request.
 *
 * It reads the query, so it sits in a `<Suspense>` of its own, and the series
 * read the rest of the page waits on comes before any request data.
 */
export const SeriesCheckoutNotice = async ({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) => {
  const { checkout } = parseSeriesCheckoutSearchParams(await searchParams);

  if (checkout === "success") {
    return (
      <output className="block rounded-control border border-success px-4 py-3 text-sm text-success">
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <Message message="storefront.series.checkout_success" />
        </Suspense>
      </output>
    );
  }

  if (checkout === "cancelled") {
    return (
      <output className="block rounded-control border border-warning px-4 py-3 text-sm text-warning">
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <Message message="storefront.series.checkout_cancelled" />
        </Suspense>
      </output>
    );
  }

  if (checkout === "error") {
    return (
      <p
        className="rounded-control border border-destructive px-4 py-3 text-sm text-destructive"
        role="alert"
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <Message message="storefront.series.checkout_error" />
        </Suspense>
      </p>
    );
  }

  return null;
};
