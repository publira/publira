import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { ActionForm, ActionFormSubmit } from "#components/action-form";
import { Message } from "#components/message";

import { createTenantAdminInvitationAction } from "../_lib/actions";

/**
 * Invites one address to become a tenant admin. The Action words its own
 * result: a mailed invitation, or an address that already belonged to a user
 * of the tenant and was made an admin on the spot.
 */
export const MemberInviteForm = ({ tenantId }: { tenantId: string }) => (
  <ActionForm action={createTenantAdminInvitationAction} className="grid gap-4">
    <input name="tenant_id" type="hidden" value={tenantId} />
    <Field>
      <FieldLabel required>
        <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
          <Message message="admin.members.invite_email" />
        </Suspense>
      </FieldLabel>
      <FieldContent>
        <Input
          autoComplete="off"
          className="sm:max-w-sm"
          name="email"
          required
          type="email"
        />
      </FieldContent>
    </Field>
    <div className="flex justify-end">
      <ActionFormSubmit>
        <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
          <Message message="admin.members.invite_action" />
        </Suspense>
      </ActionFormSubmit>
    </div>
  </ActionForm>
);
