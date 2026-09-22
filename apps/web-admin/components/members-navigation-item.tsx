import { UsersIcon } from "@publira/icons";
import {
  ConsoleSidebarNavigationItem,
  ConsoleSidebarNavigationItemHeading,
  ConsoleSidebarNavigationItemIcon,
  ConsoleSidebarNavigationItemLabel,
} from "@publira/layouts/admin";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { getAdminCurrentUser, isTenantAdminRole } from "#lib/admin-auth";
import { getTenantId } from "#lib/tenant-id";

import { Message } from "./message";

/**
 * The Members entry, which only a tenant admin is shown: every RPC behind it
 * refuses any other role, and the route answers not found to them.
 */
export const MembersNavigationItem = async () => {
  const tenantId = await getTenantId();
  const result = await getAdminCurrentUser(tenantId);
  if (!result.ok || !isTenantAdminRole(result.user.role)) {
    return null;
  }

  return (
    <ConsoleSidebarNavigationItem href="/members">
      <ConsoleSidebarNavigationItemIcon>
        <UsersIcon className="size-4" />
      </ConsoleSidebarNavigationItemIcon>
      <ConsoleSidebarNavigationItemHeading>
        <ConsoleSidebarNavigationItemLabel>
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="admin.nav.members_label" />
          </Suspense>
        </ConsoleSidebarNavigationItemLabel>
      </ConsoleSidebarNavigationItemHeading>
    </ConsoleSidebarNavigationItem>
  );
};
