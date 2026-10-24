"use client";

import type { DragEndEvent } from "@dnd-kit/react";
import { FormMessage } from "@publira/ui-components/form-message";
import { useCallback, useOptimistic, useState, useTransition } from "react";

import { useClientMessages } from "#components/client-message";
import * as Sortable from "#components/sortable-list";

import { reorderVolumesAction } from "../_lib/actions";

interface VolumeSortableListProps {
  /** One row per volume, composed on the server, in the series' order. */
  rows: Sortable.Row[];
  seriesId: string;
  tenantId: string;
}

const identity = (id: string): string => id;

/**
 * The order of the volume rows, and the write that changes it.
 *
 * A move posts the whole order rather than the one volume that moved, because
 * that is what `ReorderVolumes` takes: the order the screen was showing goes
 * up beside the order it wants, and a list someone else has changed in the
 * meantime is refused instead of merged.
 */
export const VolumeSortableList = ({
  rows,
  seriesId,
  tenantId,
}: VolumeSortableListProps) => {
  const t = useClientMessages();
  const volumeIds = rows.map((row) => row.id);
  const [isPending, startTransition] = useTransition();
  const [optimisticVolumeIds, setOptimisticVolumeIds] = useOptimistic(
    volumeIds,
    (_currentVolumeIds, nextVolumeIds: string[]) => nextVolumeIds
  );
  const [reorderErrorMessage, setReorderErrorMessage] = useState("");

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const currentVolumeIds = optimisticVolumeIds;
      const nextVolumeIds = Sortable.withItemMoved(
        currentVolumeIds,
        identity,
        event
      );
      if (nextVolumeIds === currentVolumeIds) {
        return;
      }

      startTransition(async () => {
        setOptimisticVolumeIds(nextVolumeIds);

        const formData = new FormData();
        formData.set("tenant_id", tenantId);
        formData.set("series_id", seriesId);
        formData.set("volume_ids", JSON.stringify(nextVolumeIds));
        formData.set("expected_volume_ids", JSON.stringify(currentVolumeIds));

        const result = await reorderVolumesAction(formData);
        setReorderErrorMessage(result.ok ? "" : (result.message ?? ""));
      });
    },
    [optimisticVolumeIds, seriesId, setOptimisticVolumeIds, tenantId]
  );

  return (
    <div className="grid gap-3">
      {reorderErrorMessage ? (
        <FormMessage variant="destructive">{reorderErrorMessage}</FormMessage>
      ) : null}
      <Sortable.Root
        aria-label={t("admin.series.volumes.list_title")}
        className="grid gap-3"
        onDragEnd={handleDragEnd}
      >
        <Sortable.Rows
          disabled={isPending}
          order={optimisticVolumeIds}
          rows={rows}
        />
      </Sortable.Root>
    </div>
  );
};
