"use client";

import { Button } from "@publira/ui-components/button";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense, useActionState } from "react";

import { ClientMessage } from "#components/client-message";
import { CREATOR_ROLE_NAME_MAX_LENGTH } from "#lib/creator-roles-shared";
import { useTenantId } from "#lib/use-tenant-id";

import { renameCreatorRoleAction } from "../_lib/actions";
import type { CreatorRoleListItem } from "../creator-role-types";

interface CreatorRoleRenameFormProps {
  creatorRole: CreatorRoleListItem;
}

/**
 * The name of one role, edited in place.
 *
 * The field is named by a `<FieldLabel>` the sighted reader does not need —
 * the value in the box is the name — rather than by an `aria-label`. `Field`
 * writes the `for` / `id` pair, so the accessible name is copy that keeps a
 * boundary of its own instead of a string this component would have to block
 * on to resolve.
 *
 * The field holds the saved name and nothing else: React resets an
 * uncontrolled form as soon as its Action settles, and the `key` puts the name
 * that came back from the write into the field a successful rename leaves
 * behind. A refused rename therefore lands the editor back on the name the
 * role still has, under the message saying why the one they typed was not
 * taken.
 */
export const CreatorRoleRenameForm = ({
  creatorRole,
}: CreatorRoleRenameFormProps) => {
  const tenantId = useTenantId();
  const [state, formAction, isPending] = useActionState(
    renameCreatorRoleAction,
    null
  );

  return (
    <form action={formAction} className="grid flex-1 gap-2">
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="public_id" type="hidden" value={creatorRole.publicId} />
      <div className="flex flex-wrap items-center gap-2">
        <Field className="w-full sm:max-w-xs">
          <FieldLabel className="sr-only">
            <Suspense fallback={null}>
              <ClientMessage
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
        <Button disabled={isPending} size="sm" type="submit" variant="outline">
          <Suspense fallback={<SkeletonLine className="h-4 w-10" />}>
            {isPending ? (
              <ClientMessage message="admin.creator_roles.saving" />
            ) : (
              <ClientMessage message="admin.creator_roles.save_action" />
            )}
          </Suspense>
        </Button>
      </div>
      {state && state.publicId === creatorRole.publicId ? (
        <FormMessage variant={state.ok ? "success" : "destructive"}>
          {state.message}
        </FormMessage>
      ) : null}
    </form>
  );
};
