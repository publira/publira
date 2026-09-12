"use client";

import { ChevronDownIcon, ChevronUpIcon } from "@publira/icons";
import { Button } from "@publira/ui-components/button";
import { FormMessage } from "@publira/ui-components/form-message";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import {
  Suspense,
  useCallback,
  useOptimistic,
  useState,
  useTransition,
} from "react";

import { ClientMessage } from "#components/client-message";
import { useTenantId } from "#lib/use-tenant-id";

import { reorderCreatorRolesAction } from "../_lib/actions";
import type { CreatorRoleListItem } from "../creator-role-types";
import { CREATOR_ROLE_LIST_TITLE_ID } from "../creator-role-types";
import { CreatorRoleDeleteButton } from "./creator-role-delete-button";
import { CreatorRoleRenameForm } from "./creator-role-rename-form";

interface CreatorRoleListProps {
  creatorRoles: CreatorRoleListItem[];
}

/** Where a move button sends the role it sits on. */
type MoveDirection = -1 | 1;

const withCreatorRoleMoved = (
  creatorRoles: CreatorRoleListItem[],
  index: number,
  direction: MoveDirection
): CreatorRoleListItem[] | null => {
  const target = index + direction;
  if (target < 0 || target >= creatorRoles.length) {
    return null;
  }

  const moved = [...creatorRoles];
  const [creatorRole] = moved.splice(index, 1);
  moved.splice(target, 0, creatorRole);
  return moved;
};

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
 *
 * Each move button is named by the text inside it rather than by an
 * `aria-label`, so the copy is a node with a boundary of its own and the
 * control is on screen and usable before the catalog arrives.
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

  const moveCreatorRole = useCallback(
    (index: number, direction: MoveDirection) => {
      const currentCreatorRoles = optimisticCreatorRoles;
      const nextCreatorRoles = withCreatorRoleMoved(
        currentCreatorRoles,
        index,
        direction
      );
      if (!nextCreatorRoles) {
        return;
      }

      startTransition(async () => {
        setOptimisticCreatorRoles(nextCreatorRoles);

        const formData = new FormData();
        formData.set("tenant_id", tenantId);
        formData.set(
          "creator_role_public_ids",
          JSON.stringify(
            nextCreatorRoles.map((creatorRole) => creatorRole.publicId)
          )
        );
        // The order the buttons were rendered from, so a console left open
        // while someone else moved a role is refused rather than merged.
        formData.set(
          "expected_creator_role_public_ids",
          JSON.stringify(
            currentCreatorRoles.map((creatorRole) => creatorRole.publicId)
          )
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
      <ul aria-labelledby={CREATOR_ROLE_LIST_TITLE_ID} className="grid gap-3">
        {optimisticCreatorRoles.map((creatorRole, index) => (
          <li
            className="grid gap-3 border border-border bg-background px-4 py-3 sm:flex sm:items-start sm:justify-between sm:gap-4"
            key={creatorRole.publicId}
          >
            <p className="pt-2 text-xs text-muted-foreground sm:w-20">
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <ClientMessage
                  message="admin.creator_roles.priority_hint"
                  values={{ position: String(index + 1) }}
                />
              </Suspense>
            </p>
            <CreatorRoleRenameForm creatorRole={creatorRole} />
            <div className="flex items-start gap-2">
              <Button
                disabled={isPending || index === 0}
                onClick={() => moveCreatorRole(index, -1)}
                size="icon"
                type="button"
                variant="outline"
              >
                <ChevronUpIcon aria-hidden="true" className="size-4" />
                <span className="sr-only">
                  <Suspense fallback={null}>
                    <ClientMessage
                      message="admin.creator_roles.move_up_action"
                      values={{ name: creatorRole.name }}
                    />
                  </Suspense>
                </span>
              </Button>
              <Button
                disabled={
                  isPending || index === optimisticCreatorRoles.length - 1
                }
                onClick={() => moveCreatorRole(index, 1)}
                size="icon"
                type="button"
                variant="outline"
              >
                <ChevronDownIcon aria-hidden="true" className="size-4" />
                <span className="sr-only">
                  <Suspense fallback={null}>
                    <ClientMessage
                      message="admin.creator_roles.move_down_action"
                      values={{ name: creatorRole.name }}
                    />
                  </Suspense>
                </span>
              </Button>
              <CreatorRoleDeleteButton creatorRole={creatorRole} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};
