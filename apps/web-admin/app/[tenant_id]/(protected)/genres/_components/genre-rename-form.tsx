import * as ActionForm from "@publira/ui-components/action-form";
import * as Field from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import { CATALOG_NAME_MAX_LENGTH } from "#lib/catalog-name";

import { renameGenreAction } from "../_lib/actions";
import { nameField, savedNameField } from "../_lib/genre-name-fields";
import type { GenreListItem } from "../genre-types";

interface GenreRenameFormProps {
  genre: GenreListItem;
  tenantId: string;
}

/**
 * The name of one genre in the default language, edited in place. The genre's
 * own screen names it in the other languages the site offers.
 *
 * The field is named by a `<Field.Label>` the sighted reader does not need —
 * the value in the box is the name. The `key` puts the name that came back
 * from the write into the field a successful rename leaves behind; a refused
 * rename keeps what the editor typed, under the message saying why it was not
 * taken.
 */
export const GenreRenameForm = ({ genre, tenantId }: GenreRenameFormProps) => (
  <ActionForm.Root action={renameGenreAction} className="grid flex-1 gap-2">
    <input name="tenant_id" type="hidden" value={tenantId} />
    <input name="genre_id" type="hidden" value={genre.id} />
    <input name={savedNameField()} type="hidden" value={genre.name} />
    <div className="flex flex-wrap items-center gap-2">
      <ActionForm.Fieldset className="w-full sm:max-w-xs">
        <Field.Root>
          <Field.Label className="sr-only">
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <Message
                message="admin.genres.name_field_label"
                values={{ name: genre.name }}
              />
            </Suspense>
          </Field.Label>
          <Field.Content>
            <Input
              defaultValue={genre.name}
              key={genre.name}
              maxLength={CATALOG_NAME_MAX_LENGTH}
              name={nameField()}
              required
              type="text"
            />
          </Field.Content>
        </Field.Root>
      </ActionForm.Fieldset>
      <ActionForm.Submit size="sm" variant="outline">
        <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
          <ActionForm.Idle>
            <Message message="admin.genres.save_action" />
          </ActionForm.Idle>
          <ActionForm.Pending>
            <Message message="admin.genres.saving" />
          </ActionForm.Pending>
        </Suspense>
      </ActionForm.Submit>
      <p className="text-xs text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-3 w-24" />}>
          <Message
            message="admin.genres.slug_hint"
            values={{ slug: genre.slug }}
          />
        </Suspense>
      </p>
    </div>
  </ActionForm.Root>
);
