import { StatusChip } from "@publira/ui-components/badge";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";

/** Whether readers can buy the volume now. */
export const VolumeStatusChip = ({ published }: { published: boolean }) => (
  <StatusChip status={published ? "success" : "warning"}>
    <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
      {published ? (
        <Message message="admin.series.volumes.status.on_sale" />
      ) : (
        <Message message="admin.series.volumes.status.off_sale" />
      )}
    </Suspense>
  </StatusChip>
);
