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

import { useAdminMessages } from "#components/admin-locale-context";
import { ClientMessage } from "#components/client-message";
import { useTenantId } from "#lib/use-tenant-id";

import { deleteGenreAction } from "../_lib/actions";

interface GenreDeleteButtonProps {
  name: string;
  publicId: string;
}

/**
 * Removes one genre, once the editor has confirmed it.
 *
 * A refusal is the interesting outcome rather than the exception: a genre a
 * series still carries cannot be deleted, and the message saying so is what
 * sends the editor to the series form. Success needs no message — the row it
 * was attached to is gone.
 */
export const GenreDeleteButton = ({
  name,
  publicId,
}: GenreDeleteButtonProps) => {
  const t = useAdminMessages();
  const tenantId = useTenantId();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, isPending] = useActionState(
    deleteGenreAction,
    null
  );

  return (
    <div className="grid gap-1">
      <form action={formAction} className="hidden" ref={formRef}>
        <input name="tenant_id" type="hidden" value={tenantId} />
        <input name="public_id" type="hidden" value={publicId} />
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
              {isPending
                ? t("admin.genres.deleting")
                : t("admin.genres.delete_action")}
            </Button>
          }
        />
        <ConfirmDialogContent>
          <ConfirmDialogHeader>
            <ConfirmDialogTitle>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <ClientMessage message="admin.genres.delete_confirm_title" />
              </Suspense>
            </ConfirmDialogTitle>
            <ConfirmDialogDescription>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <ClientMessage
                  message="admin.genres.delete_confirm_description"
                  values={{
                    name,
                  }}
                />
              </Suspense>
            </ConfirmDialogDescription>
          </ConfirmDialogHeader>
          <ConfirmDialogFooter>
            <ConfirmDialogCancel>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <ClientMessage message="admin.common.cancel" />
              </Suspense>
            </ConfirmDialogCancel>
            <ConfirmDialogAction
              onClick={() => {
                formRef.current?.requestSubmit();
              }}
            >
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <ClientMessage message="admin.genres.delete_confirm_action" />
              </Suspense>
            </ConfirmDialogAction>
          </ConfirmDialogFooter>
        </ConfirmDialogContent>
      </ConfirmDialog>
      {state && !state.ok && state.publicId === publicId ? (
        <FormMessage variant="destructive">{state.message}</FormMessage>
      ) : null}
    </div>
  );
};
