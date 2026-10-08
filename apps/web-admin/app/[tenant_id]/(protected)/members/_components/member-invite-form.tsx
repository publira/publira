import {
  ActionForm,
  ActionFormFieldset,
  ActionFormSubmit,
} from "@publira/ui-components/action-form";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { Select } from "@publira/ui-components/select";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";

import { createTenantAdminInvitationAction } from "../_lib/actions";
import { memberRoleItems } from "./member-role-items";

/**
 * Invites one address to hold the chosen console role. The Action words its
 * own result: a mailed invitation, or an address that already belonged to a
 * user of the tenant and was given the role on the spot.
 *
 * The role starts at Editor rather than Tenant admin, so that sending the form
 * without looking at it never hands out the role that can change the staff.
 */
export const MemberInviteForm = ({ tenantId }: { tenantId: string }) => (
  <ActionForm action={createTenantAdminInvitationAction} className="grid gap-4">
    <input name="tenant_id" type="hidden" value={tenantId} />
    <ActionFormFieldset className="grid gap-4 sm:max-w-sm">
      <Field>
        <FieldLabel required>
          <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
            <Message message="admin.members.invite_email" />
          </Suspense>
        </FieldLabel>
        <FieldContent>
          <Input autoComplete="off" name="email" required type="email" />
        </FieldContent>
      </Field>
      <Field>
        <FieldLabel required>
          <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
            <Message message="admin.members.invite_role" />
          </Suspense>
        </FieldLabel>
        <FieldContent>
          <Select
            defaultValue="tenant_editor"
            items={memberRoleItems}
            name="role"
          />
        </FieldContent>
      </Field>
    </ActionFormFieldset>
    <div className="flex justify-end">
      <ActionFormSubmit>
        <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
          <Message message="admin.members.invite_action" />
        </Suspense>
      </ActionFormSubmit>
    </div>
  </ActionForm>
);
