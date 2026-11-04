import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import type { PurchaseKindValue } from "#lib/purchase";

/**
 * The word for a rental or a tip, set under what was bought, and nothing for
 * a permanent copy, which is what a purchase is unless it says otherwise.
 * Worded one branch at a time so each key stays where anything reading this
 * file for the screen's strings can see it.
 */
export const PurchaseKindLabel = ({ kind }: { kind: PurchaseKindValue }) => {
  switch (kind) {
    case "rental": {
      return (
        <span className="text-xs text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-3 w-12" />}>
            <Message message="admin.purchases.kind_rental" />
          </Suspense>
        </span>
      );
    }

    case "tip": {
      return (
        <span className="text-xs text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-3 w-8" />}>
            <Message message="admin.purchases.kind_tip" />
          </Suspense>
        </span>
      );
    }

    default: {
      return null;
    }
  }
};
