import * as ActionForm from "@publira/ui-components/action-form";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import type { TenantLocales } from "#lib/tenant-locales";

import { renameGenreAction } from "../_lib/actions";
import type { GenreListItem } from "../genre-types";
import { GenreNameFields } from "./genre-name-fields";

interface GenreNamesFormProps {
  genre: GenreListItem;
  namePlaceholder: string;
  tenantId: string;
  tenantLocales: TenantLocales | null;
}

/** The genre's name in every language the site offers, on its own screen. */
export const GenreNamesForm = ({
  genre,
  namePlaceholder,
  tenantId,
  tenantLocales,
}: GenreNamesFormProps) => (
  <ActionForm.Root action={renameGenreAction} className="grid gap-4">
    <input name="tenant_id" type="hidden" value={tenantId} />
    <input name="genre_id" type="hidden" value={genre.id} />
    <ActionForm.Fieldset>
      <GenreNameFields
        genre={genre}
        namePlaceholder={namePlaceholder}
        tenantLocales={tenantLocales}
      />
    </ActionForm.Fieldset>
    <p className="text-xs text-muted-foreground">
      <Suspense fallback={<SkeletonLine className="h-3 w-24" />}>
        <Message
          message="admin.genres.slug_hint"
          values={{ slug: genre.slug }}
        />
      </Suspense>
    </p>
    <div className="flex justify-end">
      <ActionForm.Submit>
        <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
          <ActionForm.Idle>
            <Message message="admin.genres.save_action" />
          </ActionForm.Idle>
          <ActionForm.Pending>
            <Message message="admin.genres.saving" />
          </ActionForm.Pending>
        </Suspense>
      </ActionForm.Submit>
    </div>
  </ActionForm.Root>
);
