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
import { CREATOR_ROLE_NAME_MAX_LENGTH } from "#lib/creator-roles-shared";

import { renameCreatorRoleAction } from "../_lib/actions";
import type { CreatorRoleListItem } from "../creator-role-types";

interface CreatorRoleRenameFormProps {
  creatorRole: CreatorRoleListItem;
  tenantId: string;
}

/**
 * The name of one role, edited in place.
 *
 * The field is named by a `<FieldLabel>` the sighted reader does not need —
 * the value in the box is the name — rather than by an `aria-label`. The `key`
 * puts the name that came back from the write into the field a successful
 * rename leaves behind; a refused rename keeps what the editor typed, under
 * the message saying why it was not taken.
 */
export const CreatorRoleRenameForm = ({
  creatorRole,
  tenantId,
}: CreatorRoleRenameFormProps) => (
  <ActionForm action={renameCreatorRoleAction} className="grid flex-1 gap-2">
    <input name="tenant_id" type="hidden" value={tenantId} />
    <input name="creator_role_id" type="hidden" value={creatorRole.id} />
    <div className="flex flex-wrap items-center gap-2">
      <ActionFormFieldset className="w-full sm:max-w-xs">
        <Field>
          <FieldLabel className="sr-only">
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <Message
                message="admin.creator_roles.name_field_label"
                values={{ name: creatorRole.name }}
              />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            <Input
              defaultValue={creatorRole.name}
              key={creatorRole.name}
              maxLength={CREATOR_ROLE_NAME_MAX_LENGTH}
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
            <Message message="admin.creator_roles.save_action" />
          </ActionFormIdle>
          <ActionFormPending>
            <Message message="admin.creator_roles.saving" />
          </ActionFormPending>
        </Suspense>
      </ActionFormSubmit>
    </div>
  </ActionForm>
);
