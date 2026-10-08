import { SkeletonLine } from "@publira/ui-components/skeleton";
import type { ReactNode } from "react";
import { Suspense } from "react";

import { Message } from "#components/message";

import type { TenantMemberRole } from "../member-roles";

/**
 * The console roles as select items, shared by the member list's role change
 * and the invitation form so both offer them in the same order and words.
 */
export const memberRoleItems: readonly {
  label: ReactNode;
  value: TenantMemberRole;
}[] = [
  {
    label: (
      <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
        <Message message="admin.common.roles.tenant_admin" />
      </Suspense>
    ),
    value: "tenant_admin",
  },
  {
    label: (
      <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
        <Message message="admin.common.roles.tenant_editor" />
      </Suspense>
    ),
    value: "tenant_editor",
  },
  {
    label: (
      <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
        <Message message="admin.common.roles.tenant_auditor" />
      </Suspense>
    ),
    value: "tenant_auditor",
  },
];

/** The word for a console role; a role this screen does not know shows as stored. */
export const MemberRoleLabel = ({ role }: { role: string }) =>
  memberRoleItems.find((item) => item.value === role)?.label ?? role;
