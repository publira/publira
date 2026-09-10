"use client";

import { Button } from "@publira/ui-components/button";
import {
  ConfirmDialog,
  ConfirmDialogAction,
  ConfirmDialogCancel,
  ConfirmDialogContent,
  ConfirmDialogDescription,
  ConfirmDialogFooter,
  ConfirmDialogHeader,
  ConfirmDialogTitle,
  ConfirmDialogTrigger,
} from "@publira/ui-components/dialog";
import { FormMessage } from "@publira/ui-components/form-message";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense, useActionState, useRef } from "react";

import { ClientMessage } from "#components/client-message";
import { useTenantId } from "#lib/use-tenant-id";

import { deleteCreatorRoleAction } from "../_lib/actions";
import type { CreatorRoleListItem } from "../creator-role-types";

interface CreatorRoleDeleteButtonProps {
  creatorRole: CreatorRoleListItem;
}

/**
 * Removes one role, once the editor has confirmed it.
 *
 * A refusal is the interesting outcome rather than the exception: a role that
 * a series or an episode is still credited in cannot be deleted, and the
 * message saying so is what sends the editor to re-credit them. Success needs
 * no message — the row it was attached to is gone.
 */
export const CreatorRoleDeleteButton = ({
  creatorRole,
}: CreatorRoleDeleteButtonProps) => {
  const tenantId = useTenantId();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, isPending] = useActionState(
    deleteCreatorRoleAction,
    null
  );

  return (
    <div className="grid gap-1">
      <form action={formAction} className="hidden" ref={formRef}>
        <input name="tenant_id" type="hidden" value={tenantId} />
        <input name="public_id" type="hidden" value={creatorRole.publicId} />
      </form>
      <ConfirmDialog>
        <ConfirmDialogTrigger
          render={
            <Button
              disabled={isPending}
              size="sm"
              type="button"
              variant="destructive"
            >
              <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                {isPending ? (
                  <ClientMessage message="admin.creator_roles.deleting" />
                ) : (
                  <ClientMessage message="admin.creator_roles.delete_action" />
                )}
              </Suspense>
            </Button>
          }
        />
        <ConfirmDialogContent>
          <ConfirmDialogHeader>
            <ConfirmDialogTitle>
              <Suspense fallback={<SkeletonLine className="h-5 w-48" />}>
                <ClientMessage message="admin.creator_roles.delete_confirm_title" />
              </Suspense>
            </ConfirmDialogTitle>
            <ConfirmDialogDescription>
              <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
                <ClientMessage
                  message="admin.creator_roles.delete_confirm_description"
                  values={{ name: creatorRole.name }}
                />
              </Suspense>
            </ConfirmDialogDescription>
          </ConfirmDialogHeader>
          <ConfirmDialogFooter>
            <ConfirmDialogCancel>
              <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                <ClientMessage message="admin.common.cancel" />
              </Suspense>
            </ConfirmDialogCancel>
            <ConfirmDialogAction
              onClick={() => {
                formRef.current?.requestSubmit();
              }}
            >
              <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                <ClientMessage message="admin.creator_roles.delete_confirm_action" />
              </Suspense>
            </ConfirmDialogAction>
          </ConfirmDialogFooter>
        </ConfirmDialogContent>
      </ConfirmDialog>
      {state && !state.ok && state.publicId === creatorRole.publicId ? (
        <FormMessage variant="destructive">{state.message}</FormMessage>
      ) : null}
    </div>
  );
};
