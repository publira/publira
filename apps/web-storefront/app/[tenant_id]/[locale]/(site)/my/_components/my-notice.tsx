import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";

import { parseMyNoticeSearchParams } from "../_lib/notice-search-params";
import type { MyPageSearchParams } from "../_lib/search-params";

/**
 * What `/my` says to a reader coming back to it from a plan's checkout, or
 * from a billing portal that could not be opened. A reader who arrived any
 * other way sees nothing.
 *
 * A paid checkout is worded as a payment still being confirmed: the
 * subscription is recorded by Stripe's notification, so the plan section may
 * not show it on this very request.
 */
export const MyNotice = async ({
  searchParams,
}: {
  searchParams: MyPageSearchParams;
}) => {
  const { billing, subscription } = parseMyNoticeSearchParams(
    await searchParams
  );

  if (subscription === "success") {
    return (
      <output className="block rounded-control border border-success px-4 py-3 text-sm text-success">
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <Message message="storefront.my.subscription_success" />
        </Suspense>
      </output>
    );
  }

  if (billing === "unavailable") {
    return (
      <p
        className="rounded-control border border-destructive px-4 py-3 text-sm text-destructive"
        role="alert"
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <Message message="storefront.my.billing_unavailable" />
        </Suspense>
      </p>
    );
  }

  if (billing === "error") {
    return (
      <p
        className="rounded-control border border-destructive px-4 py-3 text-sm text-destructive"
        role="alert"
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <Message message="storefront.my.billing_error" />
        </Suspense>
      </p>
    );
  }

  return null;
};
