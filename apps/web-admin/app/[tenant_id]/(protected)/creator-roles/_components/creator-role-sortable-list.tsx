"use client";

import type { DragEndEvent } from "@dnd-kit/react";
import { FormMessage } from "@publira/ui-components/form-message";
import { useCallback, useOptimistic, useState, useTransition } from "react";

import { ClientMessage } from "#components/client-message";
import {
  SortableList,
  SortableRows,
  useSortableRowIndex,
  withItemMoved,
} from "#components/sortable-list";
import type { SortableRow } from "#components/sortable-list";

import { reorderCreatorRolesAction } from "../_lib/actions";
import { CREATOR_ROLE_LIST_TITLE_ID } from "../creator-role-types";

interface CreatorRoleSortableListProps {
  /** One row per role, composed on the server, in priority order. */
  rows: SortableRow[];
  tenantId: string;
}

const identity = (id: string): string => id;

/**
 * The priority order of the role rows, and the write that changes it.
 *
 * A move posts the whole order rather than the one role that moved, because
 * that is what `ReorderCreatorRoles` takes: the order the screen was showing
 * goes up beside the order it wants, and a list someone else has changed in
 * the meantime is refused instead of merged. The whole list therefore has to
 * be on screen, which is why this screen does not page.
 */
export const CreatorRoleSortableList = ({
  rows,
  tenantId,
}: CreatorRoleSortableListProps) => {
  const creatorRoleIds = rows.map((row) => row.id);
  const [isPending, startTransition] = useTransition();
  const [optimisticCreatorRoleIds, setOptimisticCreatorRoleIds] = useOptimistic(
    creatorRoleIds,
    (_currentCreatorRoleIds, nextCreatorRoleIds: string[]) => nextCreatorRoleIds
  );
  const [reorderErrorMessage, setReorderErrorMessage] = useState("");

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const currentCreatorRoleIds = optimisticCreatorRoleIds;
      const nextCreatorRoleIds = withItemMoved(
        currentCreatorRoleIds,
        identity,
        event
      );
      if (nextCreatorRoleIds === currentCreatorRoleIds) {
        return;
      }

      startTransition(async () => {
        setOptimisticCreatorRoleIds(nextCreatorRoleIds);

        const formData = new FormData();
        formData.set("tenant_id", tenantId);
        formData.set("creator_role_ids", JSON.stringify(nextCreatorRoleIds));
        // The order the list was rendered from, so a console left open while
        // someone else moved a role is refused rather than merged.
        formData.set(
          "expected_creator_role_ids",
          JSON.stringify(currentCreatorRoleIds)
        );

        const result = await reorderCreatorRolesAction(formData);
        setReorderErrorMessage(result.ok ? "" : (result.message ?? ""));
      });
    },
    [optimisticCreatorRoleIds, setOptimisticCreatorRoleIds, tenantId]
  );

  return (
    <div className="grid gap-3">
      {reorderErrorMessage ? (
        <FormMessage variant="destructive">{reorderErrorMessage}</FormMessage>
      ) : null}
      <SortableList
        aria-labelledby={CREATOR_ROLE_LIST_TITLE_ID}
        className="grid gap-3"
        onDragEnd={handleDragEnd}
      >
        <SortableRows
          disabled={isPending}
          order={optimisticCreatorRoleIds}
          rows={rows}
        />
      </SortableList>
    </div>
  );
};

/**
 * The position a row holds, stated rather than left to be counted. It follows
 * a drop before the server has taken the new order.
 */
export const CreatorRolePriority = () => {
  const position = useSortableRowIndex() + 1;

  return (
    <ClientMessage
      message="admin.creator_roles.priority_hint"
      values={{ position: String(position) }}
    />
  );
};
