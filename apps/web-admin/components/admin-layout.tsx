import { getMessage } from "@publira/i18n";
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
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import type { ReactNode } from "react";

import { getAdminCurrentUser } from "../lib/admin-auth";
import { redirectToLoginIfSessionRejected } from "../lib/auth-session";
import { getLocale, loadAdminMessages } from "../lib/locale";
import { logoutAction } from "../lib/logout-action";
import { getTenantRoleLabel } from "../lib/role-labels";
import { tenantBrandingVariant } from "../lib/tenant-branding-image";
import type { TenantBrandingImage } from "../lib/tenant-branding-image";
import { getTenantId } from "../lib/tenant-id";
import { AdminBrandLogo } from "./admin-brand-logo";
import { navigation } from "./admin-navigation";
import { Message } from "./message";
import {
  NotificationBell,
  NotificationBellSkeleton,
} from "./notification-bell";

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
  logoutAction: logout,
}: {
  logoutAction: () => Promise<void>;
}) => {
  const tenantId = await getTenantId();
  const result = await getAdminCurrentUser(tenantId);
  if (!result.ok) {
    await redirectToLoginIfSessionRejected(result);
    redirect("/login");
  }

  const locale = await getLocale(tenantId);
  const messages = await loadAdminMessages(locale);

  return (
    <ConsoleHeaderUser
      accountHref="/settings/account"
      currentUser={result.user}
      logoutAction={logout}
      roleLabel={getTenantRoleLabel(result.user.role, messages)}
      userMenuCopy={{
        accountMenuAriaLabel: getMessage(messages, "admin.shell.account_menu", {
          name: result.user.name,
        }),
        accountSettings: getMessage(messages, "admin.shell.account_settings"),
        logout: getMessage(messages, "admin.shell.logout"),
        logoutAriaLabel: getMessage(messages, "admin.shell.logout"),
      }}
    />
  );
};

export const AdminLayout = ({
  children,
  logo,
  tenant,
}: {
  children: ReactNode;
  logo: TenantBrandingImage | null;
  tenant: AdminLayoutTenant;
}) => {
  const logoVariant = tenantBrandingVariant(logo);
  const headerBrand = logoVariant ? (
    <Suspense fallback={<Skeleton className="h-8 w-[9rem]" />}>
      <AdminBrandLogo priority tenantName={tenant.name} variant={logoVariant} />
    </Suspense>
  ) : null;
  // ConsoleSidebar falls back to "Publira" when brandMark is omitted. Tenant
  // chrome always supplies its own mark so the platform name never appears.
  const sidebarBrand = logoVariant ? (
    <Suspense fallback={<Skeleton className="h-9 w-[11rem]" />}>
      <AdminBrandLogo
        className="h-9 max-w-[11rem]"
        tenantName={tenant.name}
        variant={logoVariant}
      />
    </Suspense>
  ) : (
    <p className="font-serif text-xl font-semibold tracking-tight text-foreground">
      {tenant.name}
    </p>
  );

  return (
    <ConsoleLayout gradient={adminGradient}>
      <ConsoleSidebar brandMark={sidebarBrand} navigation={navigation}>
        <div className="flex items-start justify-between gap-3">
          <div className="grid gap-1">
            <p className="text-sm font-medium text-foreground">{tenant.name}</p>
            <p className="text-xs leading-5 text-muted-foreground">
              <Suspense fallback={<SkeletonLine className="h-3 w-40" />}>
                <Message
                  message="admin.shell.domain"
                  values={{ domain: tenant.domain || "-" }}
                />
              </Suspense>
            </p>
          </div>
          <StatusChip status="success">
            <Suspense fallback={<SkeletonLine className="h-3 w-12" />}>
              <Message message="admin.shell.status_online" />
            </Suspense>
          </StatusChip>
        </div>
      </ConsoleSidebar>

      <ConsoleLayoutContent>
        <ConsoleHeader
          brandMark={headerBrand}
          contextLabel={tenant.name}
          eyebrow={
            <Suspense fallback={<SkeletonLine className="h-3 w-28" />}>
              <Message message="admin.shell.eyebrow" />
            </Suspense>
          }
        >
          <Suspense fallback={<NotificationBellSkeleton />}>
            <NotificationBell />
          </Suspense>
          <Suspense fallback={<ConsoleHeaderUserSkeleton />}>
            <AdminUser
              logoutAction={logoutAction.bind(null, tenant.publicId)}
            />
          </Suspense>
        </ConsoleHeader>
        <ConsoleLayoutMain>{children}</ConsoleLayoutMain>
      </ConsoleLayoutContent>
    </ConsoleLayout>
  );
};
