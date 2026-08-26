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
import { redirectToLoginIfSessionRejected } from "../lib/auth-session";
import { logoutAction } from "../lib/logout-action";
import { countUnreadNotifications } from "../lib/notification";
import { tenantBrandingVariant } from "../lib/tenant-branding-image";
import type { TenantBrandingImage } from "../lib/tenant-branding-image";
import { getTenantId } from "../lib/tenant-id";
import { navigation } from "./admin-navigation";
import {
  NotificationBell,
  NotificationBellSkeleton,
} from "./notification-bell";
import { TenantBrandLogo } from "./tenant-brand-logo";

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

  return (
    <ConsoleHeaderUser
      accountHref="/settings/account"
      currentUser={result.user}
      logoutAction={logout}
    />
  );
};

export const AdminNotificationBell = async () => {
  const tenantId = await getTenantId();
  const unread = await countUnreadNotifications(tenantId);

  return <NotificationBell unreadCount={unread.unreadCount} />;
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
  const logoAlt = `${tenant.name}のロゴ`;
  const headerBrand = logoVariant ? (
    <TenantBrandLogo alt={logoAlt} priority variant={logoVariant} />
  ) : null;
  // ConsoleSidebar falls back to "Publira" when brandMark is omitted. Tenant
  // chrome always supplies its own mark so the platform name never appears.
  const sidebarBrand = logoVariant ? (
    <TenantBrandLogo
      alt={logoAlt}
      className="h-9 max-w-[11rem]"
      variant={logoVariant}
    />
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
              ドメイン: {tenant.domain || "-"}
            </p>
          </div>
          <StatusChip status="success">Online</StatusChip>
        </div>
      </ConsoleSidebar>

      <ConsoleLayoutContent>
        <ConsoleHeader
          brandMark={headerBrand}
          contextLabel={tenant.name}
          eyebrow="現在の運用先"
        >
          <Suspense fallback={<NotificationBellSkeleton />}>
            <AdminNotificationBell />
          </Suspense>
          <Button size="sm" type="button" variant="outline">
            プレビュー
          </Button>
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
