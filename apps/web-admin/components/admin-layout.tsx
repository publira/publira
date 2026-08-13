import {
  ConsoleHeader,
  ConsoleHeaderUser,
  ConsoleHeaderUserSkeleton,
  ConsoleLayout,
  ConsoleLayoutContent,
  ConsoleLayoutMain,
  ConsoleSidebar,
} from "@publira/layouts/admin";
import { StatusChip } from "@publira/ui-components/badge";
import { Button } from "@publira/ui-components/button";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import type { ReactNode } from "react";

import { getAdminCurrentUser } from "../lib/admin-auth";
import { logoutAction } from "../lib/logout-action";
import { getTenantId } from "../lib/tenant-id";
import { navigation } from "./admin-navigation";

export interface AdminLayoutCurrentUser {
  name: string;
  publicId: string;
  role: string;
}

interface AdminLayoutTenant {
  adminDomain: string;
  domain: string;
  name: string;
  publicId: string;
}

const adminGradient =
  "bg-[radial-gradient(circle_at_top_left,rgba(15,124,130,0.12),transparent_28%),radial-gradient(circle_at_top_right,rgba(217,111,74,0.13),transparent_30%),linear-gradient(180deg,rgba(255,253,248,0.78),rgba(246,242,233,0.98))]";

export const AdminUser = async () => {
  const tenantId = await getTenantId();
  const currentUser = await getAdminCurrentUser(tenantId);
  if (!currentUser) {
    redirect("/login");
  }

  return <ConsoleHeaderUser currentUser={currentUser} />;
};

export const AdminLayout = ({
  children,
  tenant,
}: {
  children: ReactNode;
  tenant: AdminLayoutTenant;
}) => (
  <ConsoleLayout gradient={adminGradient}>
    <ConsoleSidebar logoLabel="Admin Console" navigation={navigation}>
      <div className="flex items-start justify-between gap-3">
        <div className="grid gap-1">
          <p className="text-sm font-medium text-foreground">{tenant.name}</p>
          <p className="text-xs leading-5 text-muted-foreground">
            ドメイン: {tenant.domain || "-"}
          </p>
        </div>
        <StatusChip status="success">Online</StatusChip>
      </div>
    </ConsoleSidebar>

    <ConsoleLayoutContent>
      <ConsoleHeader
        contextLabel={tenant.name}
        eyebrow="現在の運用先"
        logoutAction={logoutAction.bind(null, tenant.publicId)}
      >
        <Suspense fallback={<ConsoleHeaderUserSkeleton />}>
          <AdminUser />
        </Suspense>
        <Button size="sm" type="button" variant="outline">
          プレビュー
        </Button>
      </ConsoleHeader>
      <ConsoleLayoutMain>{children}</ConsoleLayoutMain>
    </ConsoleLayoutContent>
  </ConsoleLayout>
);
