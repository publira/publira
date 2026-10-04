import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import { SortableItem, SortableItemHandle } from "#components/sortable-list";

import type { CreatorRoleListItem } from "../creator-role-types";
import { CREATOR_ROLE_LIST_TITLE_ID } from "../creator-role-types";
import { CreatorRoleDeleteButton } from "./creator-role-delete-button";
import { CreatorRoleRenameForm } from "./creator-role-rename-form";
import {
  CreatorRolePriority,
  CreatorRoleSortableList,
} from "./creator-role-sortable-list";

interface CreatorRoleListProps {
  /**
   * Whether the operator may write the roles. Without it the list is the roles
   * in their priority order and nothing that would change them.
   */
  canEdit: boolean;
  creatorRoles: CreatorRoleListItem[];
  tenantId: string;
}

const CreatorRoleRow = ({
  creatorRole,
  tenantId,
}: {
  creatorRole: CreatorRoleListItem;
  tenantId: string;
}) => (
  <SortableItem
    className="grid gap-3 border border-border bg-background px-4 py-3 sm:flex sm:items-start sm:justify-between sm:gap-4"
    id={creatorRole.id}
    label={creatorRole.name}
  >
    {/* The height of the name field beside it, so the grip and the position
        are level with the row's first line. */}
    <div className="flex h-10 items-center gap-2 sm:w-28">
      <SortableItemHandle className="h-full">
        <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
          <Message
            message="admin.creator_roles.reorder_action"
            values={{ name: creatorRole.name }}
          />
        </Suspense>
      </SortableItemHandle>
      <p className="text-xs text-muted-foreground">
        <CreatorRolePriority />
      </p>
    </div>
    <CreatorRoleRenameForm creatorRole={creatorRole} tenantId={tenantId} />
    <CreatorRoleDeleteButton
      id={creatorRole.id}
      name={creatorRole.name}
      tenantId={tenantId}
    />
  </SortableItem>
);

/**
 * The tenant's creator roles in priority order, with the controls that write
 * it.
 *
 * The order is the whole point of the screen: it is what every credit is shown
 * in, on the series form and on the public site alike, so the position each
 * row carries is stated rather than left to be counted.
 */
export const CreatorRoleList = ({
  canEdit,
  creatorRoles,
  tenantId,
}: CreatorRoleListProps) =>
  canEdit ? (
    <CreatorRoleSortableList
      rows={creatorRoles.map((creatorRole) => ({
        content: (
          <CreatorRoleRow creatorRole={creatorRole} tenantId={tenantId} />
        ),
        id: creatorRole.id,
      }))}
      tenantId={tenantId}
    />
  ) : (
    <ol aria-labelledby={CREATOR_ROLE_LIST_TITLE_ID} className="grid gap-3">
      {creatorRoles.map((creatorRole, index) => (
        <li
          className="flex items-center gap-4 border border-border bg-background px-4 py-3"
          key={creatorRole.id}
        >
          <p className="text-xs text-muted-foreground sm:w-28">
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message
                message="admin.creator_roles.priority_hint"
                values={{ position: String(index + 1) }}
              />
            </Suspense>
          </p>
          <p className="text-sm font-medium">{creatorRole.name}</p>
        </li>
      ))}
    </ol>
  );
