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

export const AdminUser = async ({
  tenantPublicId,
}: {
  tenantPublicId: string;
}) => {
  const currentUser = await getAdminCurrentUser(tenantPublicId);
  if (!currentUser) {
    redirect("/login");
  }

  return <ConsoleHeaderUser currentUser={currentUser} />;
};

export const AdminLayout = ({
  children,
  tenant,
  tenantPublicId,
}: {
  children: ReactNode;
  tenant: AdminLayoutTenant;
  tenantPublicId: string;
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
      <ConsoleHeader contextLabel={tenant.name} eyebrow="現在の運用先">
        <Suspense fallback={<ConsoleHeaderUserSkeleton />}>
          <AdminUser tenantPublicId={tenantPublicId} />
        </Suspense>
        <Button size="sm" type="button" variant="outline">
          プレビュー
        </Button>
      </ConsoleHeader>
      <ConsoleLayoutMain>{children}</ConsoleLayoutMain>
    </ConsoleLayoutContent>
  </ConsoleLayout>
);
