"use client";

import type { DragEndEvent } from "@dnd-kit/react";
import { FormMessage } from "@publira/ui-components/form-message";
import { useCallback, useOptimistic, useState, useTransition } from "react";

import * as Sortable from "#components/sortable-list";

import { reorderCoinPacksAction } from "../_lib/actions";
import { COIN_PACK_LIST_TITLE_ID } from "../coin-types";

interface CoinPackSortableListProps {
  /** One row per pack, composed on the server, in the order packs are offered. */
  rows: Sortable.Row[];
  tenantId: string;
}

const identity = (id: string): string => id;

/**
 * The order the packs are offered in, and the write that changes it.
 *
 * A move posts the whole order beside the order the screen was showing, so a
 * list someone else has changed in the meantime is refused instead of merged.
 */
export const CoinPackSortableList = ({
  rows,
  tenantId,
}: CoinPackSortableListProps) => {
  const packIds = rows.map((row) => row.id);
  const [isPending, startTransition] = useTransition();
  const [optimisticPackIds, setOptimisticPackIds] = useOptimistic(
    packIds,
    (_currentPackIds, nextPackIds: string[]) => nextPackIds
  );
  const [reorderErrorMessage, setReorderErrorMessage] = useState("");

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const currentPackIds = optimisticPackIds;
      const nextPackIds = Sortable.withItemMoved(
        currentPackIds,
        identity,
        event
      );
      if (nextPackIds === currentPackIds) {
        return;
      }

      startTransition(async () => {
        setOptimisticPackIds(nextPackIds);

        const formData = new FormData();
        formData.set("tenant_id", tenantId);
        formData.set("coin_pack_ids", JSON.stringify(nextPackIds));
        formData.set("expected_coin_pack_ids", JSON.stringify(currentPackIds));

        const result = await reorderCoinPacksAction(formData);
        setReorderErrorMessage(result.ok ? "" : (result.message ?? ""));
      });
    },
    [optimisticPackIds, setOptimisticPackIds, tenantId]
  );

  return (
    <div className="grid gap-3">
      {reorderErrorMessage ? (
        <FormMessage variant="destructive">{reorderErrorMessage}</FormMessage>
      ) : null}
      <Sortable.Root
        aria-labelledby={COIN_PACK_LIST_TITLE_ID}
        className="grid gap-3"
        onDragEnd={handleDragEnd}
      >
        <Sortable.Rows
          disabled={isPending}
          order={optimisticPackIds}
          rows={rows}
        />
      </Sortable.Root>
    </div>
  );
};
