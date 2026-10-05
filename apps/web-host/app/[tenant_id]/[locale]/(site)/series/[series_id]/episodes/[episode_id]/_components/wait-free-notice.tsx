import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";

import type { PurchaseSearchParams } from "../_lib/purchase-search-params";

/**
 * What the episode says to a reader whose wait-for-free ticket could not be
 * used because the API was out of reach or the reader tried too often. Every
 * other refusal is a state the gate itself words, so it needs no notice.
 */
export const WaitFreeNotice = ({
  waitFree,
}: {
  waitFree: PurchaseSearchParams["wait_free"];
}) => {
  if (waitFree !== "error") {
    return null;
  }

  return (
    <p
      className="block rounded-control border border-destructive px-4 py-3 text-sm text-destructive"
      role="alert"
    >
      <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
        <Message message="host.episode.wait_free_error" />
      </Suspense>
    </p>
  );
};
