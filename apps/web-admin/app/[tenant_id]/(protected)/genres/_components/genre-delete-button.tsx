"use client";

import {
  ActionFormIdle,
  ActionFormPending,
} from "@publira/ui-components/action-form";
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
import { useActionState, useRef } from "react";

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
  const tenantId = useTenantId();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, isPending] = useActionState(
    deleteGenreAction,
    null
  );

  return (
    <form action={formAction} className="grid gap-1" ref={formRef}>
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="public_id" type="hidden" value={publicId} />
      <ConfirmDialog>
        <ConfirmDialogTrigger
          render={
            <Button
              disabled={isPending}
              size="sm"
              type="button"
              variant="destructive"
            >
              <ActionFormIdle>
                <ClientMessage message="admin.genres.delete_action" />
              </ActionFormIdle>
              <ActionFormPending>
                <ClientMessage message="admin.genres.deleting" />
              </ActionFormPending>
            </Button>
          }
        />
        <ConfirmDialogContent>
          <ConfirmDialogHeader>
            <ConfirmDialogTitle>
              <ClientMessage message="admin.genres.delete_confirm_title" />
            </ConfirmDialogTitle>
            <ConfirmDialogDescription>
              <ClientMessage
                message="admin.genres.delete_confirm_description"
                values={{
                  name,
                }}
              />
            </ConfirmDialogDescription>
          </ConfirmDialogHeader>
          <ConfirmDialogFooter>
            <ConfirmDialogCancel>
              <ClientMessage message="admin.common.cancel" />
            </ConfirmDialogCancel>
            <ConfirmDialogAction
              onClick={() => {
                formRef.current?.requestSubmit();
              }}
            >
              <ClientMessage message="admin.genres.delete_confirm_action" />
            </ConfirmDialogAction>
          </ConfirmDialogFooter>
        </ConfirmDialogContent>
      </ConfirmDialog>
      {state && !state.ok && state.publicId === publicId ? (
        <FormMessage variant="destructive">{state.message}</FormMessage>
      ) : null}
    </form>
  );
};
