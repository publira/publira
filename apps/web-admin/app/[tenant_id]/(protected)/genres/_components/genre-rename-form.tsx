"use client";

import {
  ActionFormIdle,
  ActionFormPending,
} from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { useActionState } from "react";

import { ClientMessage, useClientMessages } from "#components/client-message";
import { CATALOG_NAME_MAX_LENGTH } from "#lib/catalog-name";
import { useTenantId } from "#lib/use-tenant-id";

import { renameGenreAction } from "../_lib/actions";
import type { GenreListItem } from "../genre-types";

interface GenreRenameFormProps {
  genre: GenreListItem;
}

/**
 * The name of one genre, edited in place.
 *
 * The field holds the saved name and nothing else: React resets an
 * uncontrolled form as soon as its Action settles, and the `key` puts the name
 * that came back from the write into the field a successful rename leaves
 * behind. A refused rename therefore lands the editor back on the name the
 * genre still has, under the message saying why the one they typed was not
 * taken.
 */
export const GenreRenameForm = ({ genre }: GenreRenameFormProps) => {
  const t = useClientMessages();
  const tenantId = useTenantId();
  const [state, formAction, isPending] = useActionState(
    renameGenreAction,
    null
  );

  return (
    <form action={formAction} className="grid flex-1 gap-2">
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="public_id" type="hidden" value={genre.publicId} />
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label={t("admin.genres.name_field_label", {
            name: genre.name,
          })}
          className="w-full sm:max-w-xs"
          disabled={isPending}
          defaultValue={genre.name}
          key={genre.name}
          maxLength={CATALOG_NAME_MAX_LENGTH}
          name="name"
          required
          type="text"
        />
        <Button disabled={isPending} size="sm" type="submit" variant="outline">
          <ActionFormIdle>
            <ClientMessage message="admin.genres.save_action" />
          </ActionFormIdle>
          <ActionFormPending>
            <ClientMessage message="admin.genres.saving" />
          </ActionFormPending>
        </Button>
        <p className="text-xs text-muted-foreground">
          <ClientMessage
            message="admin.genres.slug_hint"
            values={{ slug: genre.slug }}
          />
        </p>
      </div>
      {state && state.publicId === genre.publicId ? (
        <FormMessage variant={state.ok ? "success" : "destructive"}>
          {state.message}
        </FormMessage>
      ) : null}
    </form>
  );
};
