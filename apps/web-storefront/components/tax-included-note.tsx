import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";

/**
 * "incl. tax", set beside a price the tenant offers while it states a tax
 * rate: a price shown to a reader has to be the total they pay, and the note
 * says that it is. The caller decides whether the tenant states a rate; a
 * price under a site that states none carries no note.
 */
export const TaxIncludedNote = () => (
  <span className="text-xs font-normal text-muted-foreground">
    <Suspense fallback={<SkeletonLine className="inline-block h-3 w-12" />}>
      <Message message="storefront.common.tax_included" />
    </Suspense>
  </span>
);
