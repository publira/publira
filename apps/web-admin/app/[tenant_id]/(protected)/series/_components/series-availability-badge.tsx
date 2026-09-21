import { Badge } from "@publira/ui-components/badge";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import type { SurfaceAvailabilityValue } from "#lib/surface-availability";

/**
 * Marks a series kept to one surface, so it is recognizable without opening
 * it. A series on both surfaces is the ordinary case and carries nothing.
 */
export const SeriesAvailabilityBadge = ({
  availability,
}: {
  availability: SurfaceAvailabilityValue;
}) => {
  if (availability === "all") {
    return null;
  }

  return (
    // The title column is narrow, and a mark broken over two lines reads as
    // two words rather than one label.
    <Badge className="whitespace-nowrap" tone="muted" variant="soft">
      <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
        {availability === "web" ? (
          <Message message="admin.series.availability.web" />
        ) : (
          <Message message="admin.series.availability.app" />
        )}
      </Suspense>
    </Badge>
  );
};
