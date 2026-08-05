import {
  ConsoleHeaderSkeleton,
  ConsoleLayout,
  ConsoleLayoutContent,
  ConsoleLayoutMain,
  ConsoleSidebarSkeleton,
} from "@publira/layouts/admin";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import type { ReactNode } from "react";

import { AdminLayout } from "#components/admin-layout";
import { AdminToastProvider } from "#components/admin-toast-provider";
import { getTenantForSession } from "#lib/tenant-detail";
import { getTenantId } from "#lib/tenant-id";

const AdminLayoutSkeleton = () => (
  <ConsoleLayout>
    <ConsoleSidebarSkeleton />
    <ConsoleLayoutContent>
      <ConsoleHeaderSkeleton />
      <ConsoleLayoutMain>
        <div className="p-8" />
      </ConsoleLayoutMain>
    </ConsoleLayoutContent>
  </ConsoleLayout>
);

const ProtectedLayoutInner = async ({ children }: { children: ReactNode }) => {
  const tenantId = await getTenantId();

  const tenant = await getTenantForSession(tenantId);
  if (!tenant) {
    // Invalid/missing session: send back to login instead of a blank 404.
    redirect("/login");
  }

  return (
    <AdminLayout tenant={tenant}>
      <AdminToastProvider>{children}</AdminToastProvider>
    </AdminLayout>
  );
};

const ProtectedLayout = ({ children }: LayoutProps<"/[tenant_id]">) => (
  <Suspense fallback={<AdminLayoutSkeleton />}>
    <ProtectedLayoutInner>{children}</ProtectedLayoutInner>
  </Suspense>
);

export default ProtectedLayout;
