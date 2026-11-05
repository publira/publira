import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";

import type { PurchaseSearchParams } from "../_lib/purchase-search-params";
import { TipReturnCleaner } from "./tip-return-cleaner";

const TipOutcome = ({ tip }: { tip: PurchaseSearchParams["tip"] }) => {
  if (tip === "success") {
    return (
      <output className="block rounded-control border border-success px-4 py-3 text-sm text-success">
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <Message message="storefront.episode.tip.thanks" />
        </Suspense>
      </output>
    );
  }

  if (tip === "cancelled") {
    return (
      <output className="block rounded-control border border-warning px-4 py-3 text-sm text-warning">
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <Message message="storefront.episode.tip.cancelled" />
        </Suspense>
      </output>
    );
  }

  return (
    <p
      className="block rounded-control border border-destructive px-4 py-3 text-sm text-destructive"
      role="alert"
    >
      <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
        <Message message="storefront.episode.tip.start_failed" />
      </Suspense>
    </p>
  );
};

/**
 * What the episode says to a reader coming back from tipping its Authors. It
 * says it once: the query is taken off the URL, so a reload or a shared link
 * does not thank anyone for a tip they did not just give.
 */
export const TipNotice = ({ tip }: { tip: PurchaseSearchParams["tip"] }) =>
  tip ? (
    <>
      <TipOutcome tip={tip} />
      <TipReturnCleaner />
    </>
  ) : null;
