"use client";

import type { DragEndEvent } from "@dnd-kit/react";
import { FormMessage } from "@publira/ui-components/form-message";
import { useCallback, useOptimistic, useState, useTransition } from "react";

import { useClientMessages } from "#components/client-message";
import {
  SortableList,
  SortableRows,
  withItemMoved,
} from "#components/sortable-list";
import type { SortableRow } from "#components/sortable-list";

import { reorderGenresAction } from "../_lib/actions";

interface GenreSortableListProps {
  /** One row per genre, composed on the server, in the tenant's order. */
  rows: SortableRow[];
  tenantId: string;
}

const identity = (id: string): string => id;

/**
 * The order of the genre rows, and the write that changes it.
 *
 * A move posts the whole order rather than the one genre that moved, because
 * that is what `ReorderGenres` takes: the order the screen was showing goes up
 * beside the order it wants, and a list someone else has changed in the
 * meantime is refused instead of merged. The whole list therefore has to be on
 * screen, which is why this screen does not page.
 */
export const GenreSortableList = ({
  rows,
  tenantId,
}: GenreSortableListProps) => {
  const t = useClientMessages();
  const genreIds = rows.map((row) => row.id);
  const [isPending, startTransition] = useTransition();
  const [optimisticGenreIds, setOptimisticGenreIds] = useOptimistic(
    genreIds,
    (_currentGenreIds, nextGenreIds: string[]) => nextGenreIds
  );
  const [reorderErrorMessage, setReorderErrorMessage] = useState("");

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const currentGenreIds = optimisticGenreIds;
      const nextGenreIds = withItemMoved(currentGenreIds, identity, event);
      if (nextGenreIds === currentGenreIds) {
        return;
      }

      startTransition(async () => {
        setOptimisticGenreIds(nextGenreIds);

        const formData = new FormData();
        formData.set("tenant_id", tenantId);
        formData.set("genre_ids", JSON.stringify(nextGenreIds));
        // The order the list was rendered from, so a console left open while
        // someone else moved a genre is refused rather than merged.
        formData.set("expected_genre_ids", JSON.stringify(currentGenreIds));

        const result = await reorderGenresAction(formData);
        setReorderErrorMessage(result.ok ? "" : (result.message ?? ""));
      });
    },
    [optimisticGenreIds, setOptimisticGenreIds, tenantId]
  );

  return (
    <div className="grid gap-3">
      {reorderErrorMessage ? (
        <FormMessage variant="destructive">{reorderErrorMessage}</FormMessage>
      ) : null}
      <SortableList
        aria-label={t("admin.genres.list_title")}
        className="grid gap-3"
        onDragEnd={handleDragEnd}
      >
        <SortableRows
          disabled={isPending}
          order={optimisticGenreIds}
          rows={rows}
        />
      </SortableList>
    </div>
  );
};
