import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import {
  ActionForm,
  ActionFormFieldset,
  ActionFormSubmit,
} from "#components/action-form";
import { Message } from "#components/message";
import { CATALOG_NAME_MAX_LENGTH } from "#lib/catalog-name";

import { createGenreAction } from "../_lib/actions";

export const GenreCreateForm = ({
  namePlaceholder,
  tenantId,
}: {
  namePlaceholder: string;
  tenantId: string;
}) => (
  <ActionForm action={createGenreAction} className="grid gap-4">
    <input name="tenant_id" type="hidden" value={tenantId} />
    <ActionFormFieldset>
      <Field>
        <FieldLabel required>
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <Message message="admin.genres.form.name" />
          </Suspense>
        </FieldLabel>
        <FieldContent>
          <Input
            className="sm:max-w-sm"
            maxLength={CATALOG_NAME_MAX_LENGTH}
            name="name"
            placeholder={namePlaceholder}
            required
            type="text"
          />
        </FieldContent>
      </Field>
    </ActionFormFieldset>
    <div className="flex justify-end">
      <ActionFormSubmit>
        <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
          <Message message="admin.genres.create_action" />
        </Suspense>
      </ActionFormSubmit>
    </div>
  </ActionForm>
);
