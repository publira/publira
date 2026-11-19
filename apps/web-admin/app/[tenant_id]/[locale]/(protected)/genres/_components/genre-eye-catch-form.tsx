import * as ActionForm from "@publira/ui-components/action-form";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { EyeCatchFormField } from "#components/eye-catch/form-field";
import { Message } from "#components/message";

import { updateGenreEyeCatchAction } from "../_lib/actions";
import type { GenreListItem } from "../genre-types";

interface GenreEyeCatchFormProps {
  genre: GenreListItem;
  tenantId: string;
}

export const GenreEyeCatchForm = ({
  genre,
  tenantId,
}: GenreEyeCatchFormProps) => (
  <ActionForm.Root action={updateGenreEyeCatchAction} className="grid gap-4">
    <input name="tenant_id" type="hidden" value={tenantId} />
    <input name="genre_id" type="hidden" value={genre.id} />
    {/* A save refreshes the page with the eye-catch it stored, and the new
        timestamp remounts the field so the picked file and the delete toggle
        do not outlive the save they were sent with. */}
    <EyeCatchFormField
      eyeCatchImageUpdatedAt={genre.eyeCatchImageUpdatedAt}
      key={genre.eyeCatchImageUpdatedAt}
      variants={genre.eyeCatchImageVariants}
    />
    <div className="flex justify-end">
      <ActionForm.Submit>
        <ActionForm.Idle>
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <Message message="admin.genres.form.eye_catch_update" />
          </Suspense>
        </ActionForm.Idle>
        <ActionForm.Pending>
          <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
            <Message message="admin.genres.form.submitting" />
          </Suspense>
        </ActionForm.Pending>
      </ActionForm.Submit>
    </div>
  </ActionForm.Root>
);
