import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";

import { parsePlansSearchParams } from "../_lib/search-params";

/**
 * What the plan page says to a reader coming back to it: from Stripe's
 * checkout they left without paying, or from a checkout that could not be
 * started. A reader who arrived any other way sees nothing.
 *
 * It reads the query, so it sits in a `<Suspense>` of its own.
 */
export const PlansNotice = async ({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) => {
  const { subscription } = parsePlansSearchParams(await searchParams);

  if (subscription === "cancelled") {
    return (
      <output className="block rounded-control border border-warning px-4 py-3 text-sm text-warning">
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <Message message="storefront.plans.checkout_cancelled" />
        </Suspense>
      </output>
    );
  }

  if (subscription === "unavailable") {
    return (
      <p
        className="rounded-control border border-destructive px-4 py-3 text-sm text-destructive"
        role="alert"
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <Message message="storefront.plans.checkout_unavailable" />
        </Suspense>
      </p>
    );
  }

  if (subscription === "error") {
    return (
      <p
        className="rounded-control border border-destructive px-4 py-3 text-sm text-destructive"
        role="alert"
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <Message message="storefront.plans.checkout_error" />
        </Suspense>
      </p>
    );
  }

  return null;
};
