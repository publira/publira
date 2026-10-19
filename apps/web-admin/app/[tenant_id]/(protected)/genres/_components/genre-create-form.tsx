import {
  ActionForm,
  ActionFormFieldset,
  ActionFormSubmit,
} from "@publira/ui-components/action-form";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import type { TenantLocales } from "#lib/tenant-locales";

import { createGenreAction } from "../_lib/actions";
import { GenreNameFields } from "./genre-name-fields";

export const GenreCreateForm = ({
  namePlaceholder,
  tenantId,
  tenantLocales,
}: {
  namePlaceholder: string;
  tenantId: string;
  tenantLocales: TenantLocales | null;
}) => (
  <ActionForm action={createGenreAction} className="grid gap-4">
    <input name="tenant_id" type="hidden" value={tenantId} />
    <ActionFormFieldset>
      <GenreNameFields
        namePlaceholder={namePlaceholder}
        tenantLocales={tenantLocales}
      />
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
