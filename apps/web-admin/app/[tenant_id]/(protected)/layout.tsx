import { ConsoleLayoutSkeleton } from "@publira/layouts/admin";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import type { ReactNode } from "react";

import { AdminLayout } from "#components/admin-layout";
import { AdminLocaleProvider } from "#components/admin-locale-context";
import { AdminToastProvider } from "#components/admin-toast-provider";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import { getLocale } from "#lib/locale";
import { getTenantForSession } from "#lib/tenant-detail";
import { getTenantId } from "#lib/tenant-id";
import { getTenantThemeLogo } from "#lib/theme-settings";

const AdminLayoutSkeleton = () => <ConsoleLayoutSkeleton />;

const ProtectedLayoutInner = async ({ children }: { children: ReactNode }) => {
  const tenantId = await getTenantId();

  const [result, logo, locale] = await Promise.all([
    getTenantForSession(tenantId),
    getTenantThemeLogo(tenantId),
    getLocale(tenantId),
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
    <AdminLocaleProvider locale={locale}>
      <AdminLayout logo={logo} tenant={result.tenant} tenantId={tenantId}>
        <AdminToastProvider>{children}</AdminToastProvider>
      </AdminLayout>
    </AdminLocaleProvider>
  );
};

const ProtectedLayout = ({ children }: LayoutProps<"/[tenant_id]">) => (
  <Suspense fallback={<AdminLayoutSkeleton />}>
    <ProtectedLayoutInner>{children}</ProtectedLayoutInner>
  </Suspense>
);

export default ProtectedLayout;
