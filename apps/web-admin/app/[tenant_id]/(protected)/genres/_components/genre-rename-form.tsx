import {
  ActionForm,
  ActionFormFieldset,
  ActionFormIdle,
  ActionFormPending,
  ActionFormSubmit,
} from "@publira/ui-components/action-form";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import { CATALOG_NAME_MAX_LENGTH } from "#lib/catalog-name";

import { renameGenreAction } from "../_lib/actions";
import type { GenreListItem } from "../genre-types";

interface GenreRenameFormProps {
  genre: GenreListItem;
  tenantId: string;
}

/**
 * The name of one genre, edited in place.
 *
 * The field is named by a `<FieldLabel>` the sighted reader does not need —
 * the value in the box is the name. The `key` puts the name that came back
 * from the write into the field a successful rename leaves behind; a refused
 * rename keeps what the editor typed, under the message saying why it was not
 * taken.
 */
export const GenreRenameForm = ({ genre, tenantId }: GenreRenameFormProps) => (
  <ActionForm action={renameGenreAction} className="grid flex-1 gap-2">
    <input name="tenant_id" type="hidden" value={tenantId} />
    <input name="genre_id" type="hidden" value={genre.id} />
    <div className="flex flex-wrap items-center gap-2">
      <ActionFormFieldset className="w-full sm:max-w-xs">
        <Field>
          <FieldLabel className="sr-only">
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <Message
                message="admin.genres.name_field_label"
                values={{ name: genre.name }}
              />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            <Input
              defaultValue={genre.name}
              key={genre.name}
              maxLength={CATALOG_NAME_MAX_LENGTH}
              name="name"
              required
              type="text"
            />
          </FieldContent>
        </Field>
      </ActionFormFieldset>
      <ActionFormSubmit size="sm" variant="outline">
        <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
          <ActionFormIdle>
            <Message message="admin.genres.save_action" />
          </ActionFormIdle>
          <ActionFormPending>
            <Message message="admin.genres.saving" />
          </ActionFormPending>
        </Suspense>
      </ActionFormSubmit>
      <p className="text-xs text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-3 w-24" />}>
          <Message
            message="admin.genres.slug_hint"
            values={{ slug: genre.slug }}
          />
        </Suspense>
      </p>
    </div>
  </ActionForm>
);
