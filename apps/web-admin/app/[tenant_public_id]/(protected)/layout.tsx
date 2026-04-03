import {
  ConsoleHeaderSkeleton,
  ConsoleLayout,
  ConsoleLayoutContent,
  ConsoleLayoutMain,
  ConsoleSidebarSkeleton,
} from "@publira/layouts/admin";
import { guardPlaceholder } from "@publira/utils/next-static-params";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import type { ReactNode } from "react";

import { AdminLayout } from "#components/admin-layout";
import { AdminToastProvider } from "#components/admin-toast-provider";
import { getTenantForSession } from "#lib/tenant-detail";

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

const ProtectedLayoutInner = async ({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ tenant_public_id: string }>;
}) => {
  const { tenant_public_id } = await params;
  guardPlaceholder(tenant_public_id);

  const tenant = await getTenantForSession(tenant_public_id);
  if (!tenant) {
    notFound();
  }

  return (
    <AdminLayout tenant={tenant} tenantPublicId={tenant_public_id}>
      <AdminToastProvider>{children}</AdminToastProvider>
    </AdminLayout>
  );
};

export default function ProtectedLayout({
  children,
  params,
}: LayoutProps<"/[tenant_public_id]">) {
  return (
    <Suspense fallback={<AdminLayoutSkeleton />}>
      <ProtectedLayoutInner params={params}>{children}</ProtectedLayoutInner>
    </Suspense>
  );
}
