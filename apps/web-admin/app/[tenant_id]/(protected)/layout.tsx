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
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import { getTenantForSession } from "#lib/tenant-detail";
import { getTenantId } from "#lib/tenant-id";
import { getTenantThemeLogo } from "#lib/theme-settings";

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

  const [result, logo] = await Promise.all([
    getTenantForSession(tenantId),
    getTenantThemeLogo(tenantId),
  ]);
  if (!result.ok) {
    // The proxy let this request in on a cookie the API has since rejected,
    // so the console asks for the session again — with the path to come back
    // to, and the marker that makes the proxy drop the cookie.
    await redirectToLoginIfSessionRejected(result);
    // Invalid/missing session: send back to login instead of a blank 404.
    redirect("/login");
  }

  return (
    <AdminLayout logo={logo} tenant={result.tenant}>
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
