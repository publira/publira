"use client";

import type { DragEndEvent } from "@dnd-kit/react";
import { FormMessage } from "@publira/ui-components/form-message";
import { useCallback, useOptimistic, useState, useTransition } from "react";

import { ClientMessage } from "#components/client-message";
import {
  SortableItem,
  SortableItemHandle,
  SortableList,
  withItemMoved,
} from "#components/sortable-list";
import { useTenantId } from "#lib/use-tenant-id";

import { reorderCreatorRolesAction } from "../_lib/actions";
import type { CreatorRoleListItem } from "../creator-role-types";
import { CREATOR_ROLE_LIST_TITLE_ID } from "../creator-role-types";
import { CreatorRoleDeleteButton } from "./creator-role-delete-button";
import { CreatorRoleRenameForm } from "./creator-role-rename-form";

interface CreatorRoleListProps {
  creatorRoles: CreatorRoleListItem[];
}

const creatorRoleId = (creatorRole: CreatorRoleListItem): string =>
  creatorRole.publicId;

/**
 * The tenant's creator roles in priority order, with the controls that write
 * it.
 *
 * The order is the whole point of the screen: it is what every credit is shown
 * in, on the series form and on the public site alike, so the position each
 * row carries is stated rather than left to be counted.
 *
 * A move posts the whole order rather than the one role that moved, because
 * that is what `ReorderCreatorRoles` takes: the order the screen was showing
 * goes up beside the order it wants, and a list someone else has changed in
 * the meantime is refused instead of merged. The whole list therefore has to
 * be on screen, which is why this screen does not page.
 */
export const CreatorRoleList = ({ creatorRoles }: CreatorRoleListProps) => {
  const tenantId = useTenantId();
  const [isPending, startTransition] = useTransition();
  const [optimisticCreatorRoles, setOptimisticCreatorRoles] = useOptimistic(
    creatorRoles,
    (_currentCreatorRoles, nextCreatorRoles: CreatorRoleListItem[]) =>
      nextCreatorRoles
  );
  const [reorderErrorMessage, setReorderErrorMessage] = useState("");

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const currentCreatorRoles = optimisticCreatorRoles;
      const nextCreatorRoles = withItemMoved(
        currentCreatorRoles,
        creatorRoleId,
        event
      );
      if (nextCreatorRoles === currentCreatorRoles) {
        return;
      }

      startTransition(async () => {
        setOptimisticCreatorRoles(nextCreatorRoles);

        const formData = new FormData();
        formData.set("tenant_id", tenantId);
        formData.set(
          "creator_role_public_ids",
          JSON.stringify(nextCreatorRoles.map(creatorRoleId))
        );
        // The order the list was rendered from, so a console left open while
        // someone else moved a role is refused rather than merged.
        formData.set(
          "expected_creator_role_public_ids",
          JSON.stringify(currentCreatorRoles.map(creatorRoleId))
        );

        const result = await reorderCreatorRolesAction(formData);
        setReorderErrorMessage(result.ok ? "" : (result.message ?? ""));
      });
    },
    [optimisticCreatorRoles, setOptimisticCreatorRoles, tenantId]
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
        {optimisticCreatorRoles.map((creatorRole, index) => (
          <SortableItem
            className="grid gap-3 border border-border bg-background px-4 py-3 sm:flex sm:items-start sm:justify-between sm:gap-4"
            disabled={isPending}
            id={creatorRole.publicId}
            index={index}
            key={creatorRole.publicId}
          >
            {/* The height of the name field beside it, so the grip and the
                position are level with the row's first line. */}
            <div className="flex h-10 items-center gap-2 sm:w-28">
              <SortableItemHandle className="h-full">
                <ClientMessage
                  message="admin.creator_roles.reorder_action"
                  values={{ name: creatorRole.name }}
                />
              </SortableItemHandle>
              <p className="text-xs text-muted-foreground">
                <ClientMessage
                  message="admin.creator_roles.priority_hint"
                  values={{ position: String(index + 1) }}
                />
              </p>
            </div>
            <CreatorRoleRenameForm creatorRole={creatorRole} />
            <CreatorRoleDeleteButton creatorRole={creatorRole} />
          </SortableItem>
        ))}
      </SortableList>
    </div>
  );
};
