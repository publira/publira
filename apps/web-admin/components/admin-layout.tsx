import {
  ConsoleHeader,
  ConsoleHeaderActions,
  ConsoleHeaderContext,
  ConsoleHeaderLabel,
  ConsoleHeaderUser,
  ConsoleHeaderUserSkeleton,
  ConsoleHeaderText,
  ConsoleLayout,
  ConsoleLayoutContent,
  ConsoleLayoutMain,
  ConsoleMobileNavigation,
  ConsoleMobileNavigationCloseButton,
  ConsoleMobileNavigationOpenButton,
  ConsoleSidebar,
  ConsoleSidebarBrand,
  ConsoleSidebarBrandName,
  ConsoleSidebarContext,
  ConsoleUserMenuAccountLink,
  ConsoleUserMenuContent,
  ConsoleUserMenuIdentity,
  ConsoleUserMenuInitial,
  ConsoleUserMenuLogout,
  ConsoleUserMenuLogoutButton,
  ConsoleUserMenuName,
  ConsoleUserMenuPublicId,
  ConsoleUserMenuRole,
  ConsoleUserMenuSeparator,
  ConsoleUserMenuTrigger,
} from "@publira/layouts/admin";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import type { ReactNode } from "react";

import { Message } from "#components/message";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";

import { getAdminCurrentUser } from "../lib/admin-auth";
import { redirectToLoginIfSessionRejected } from "../lib/auth-session";
import { logoutAction } from "../lib/logout-action";
import { getTenantRoleLabel } from "../lib/role-labels";
import { tenantBrandingVariant } from "../lib/tenant-branding-image";
import type { TenantBrandingImage } from "../lib/tenant-branding-image";
import { getTenantId } from "../lib/tenant-id";
import { AdminBrandLogo } from "./admin-brand-logo";
import { AdminNavigation } from "./admin-navigation";
import { AdminLocaleSwitcher } from "./locale-switcher";
import {
  NotificationBell,
  NotificationBellSkeleton,
} from "./notification-bell";
import { NotificationBellErrorBoundary } from "./notification-bell-error-boundary";

export interface AdminLayoutCurrentUser {
  name: string;
  publicId: string;
  role: string;
}

interface AdminLayoutTenant {
  adminDomain: string;
  name: string;
  publicId: string;
}

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
  const t = await getMessagesFor(locale);

  return (
    <ConsoleHeaderUser>
      <ConsoleUserMenuTrigger
        aria-label={t("admin.shell.account_menu", {
          name: result.user.name,
        })}
      >
        <ConsoleUserMenuInitial>{result.user.name}</ConsoleUserMenuInitial>
      </ConsoleUserMenuTrigger>
      <ConsoleUserMenuContent>
        <ConsoleUserMenuIdentity>
          <ConsoleUserMenuName>{result.user.name}</ConsoleUserMenuName>
          <ConsoleUserMenuPublicId>
            {result.user.publicId}
          </ConsoleUserMenuPublicId>
          <ConsoleUserMenuRole>
            {await getTenantRoleLabel(result.user.role, locale)}
          </ConsoleUserMenuRole>
        </ConsoleUserMenuIdentity>
        <ConsoleUserMenuSeparator />
        <ConsoleUserMenuAccountLink href="/settings/account">
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <Message message="admin.shell.account_settings" />
          </Suspense>
        </ConsoleUserMenuAccountLink>
        <ConsoleUserMenuLogout action={logout}>
          <ConsoleUserMenuLogoutButton>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.shell.logout" />
            </Suspense>
          </ConsoleUserMenuLogoutButton>
        </ConsoleUserMenuLogout>
      </ConsoleUserMenuContent>
    </ConsoleHeaderUser>
  );
};

const AdminMobileNavigation = async ({ tenantId }: { tenantId: string }) => {
  const locale = await getLocale(tenantId);
  const t = await getMessagesFor(locale);

  return (
    <>
      <ConsoleMobileNavigation>
        <ConsoleMobileNavigationCloseButton
          aria-label={t("admin.shell.navigation_close")}
        />
      </ConsoleMobileNavigation>
      <ConsoleMobileNavigationOpenButton
        aria-label={t("admin.shell.navigation_open")}
      />
    </>
  );
};

export const AdminLayout = ({
  children,
  logo,
  tenant,
  tenantId,
}: {
  children: ReactNode;
  logo: TenantBrandingImage | null;
  tenant: AdminLayoutTenant;
  tenantId: string;
}) => {
  const logoVariant = tenantBrandingVariant(logo);
  const headerBrand = logoVariant ? (
    <Suspense fallback={<Skeleton className="h-6 w-[7rem]" />}>
      <AdminBrandLogo priority tenantName={tenant.name} variant={logoVariant} />
    </Suspense>
  ) : null;
  // The sidebar names the tenant either way: as its own mark when it has one,
  // and as the brand text when it does not. The platform name never appears in
  // tenant chrome.
  const sidebarBrand = logoVariant ? (
    <Suspense fallback={<Skeleton className="h-8 w-[10rem]" />}>
      <AdminBrandLogo
        className="h-8 max-w-[10rem]"
        tenantName={tenant.name}
        variant={logoVariant}
      />
    </Suspense>
  ) : (
    <ConsoleSidebarBrandName>{tenant.name}</ConsoleSidebarBrandName>
  );

  return (
    <ConsoleLayout>
      <Suspense fallback={null}>
        <AdminMobileNavigation tenantId={tenantId} />
      </Suspense>
      <ConsoleSidebar>
        <ConsoleSidebarBrand>{sidebarBrand}</ConsoleSidebarBrand>
        {logoVariant ? (
          <ConsoleSidebarContext>{tenant.name}</ConsoleSidebarContext>
        ) : null}
        <AdminNavigation />
      </ConsoleSidebar>

      <ConsoleLayoutContent>
        <ConsoleHeader>
          <ConsoleHeaderContext>
            {headerBrand}
            <ConsoleHeaderText>
              <ConsoleHeaderLabel>{tenant.name}</ConsoleHeaderLabel>
            </ConsoleHeaderText>
          </ConsoleHeaderContext>
          <ConsoleHeaderActions>
            <Suspense
              fallback={<Skeleton className="size-9 rounded-control" />}
            >
              <AdminLocaleSwitcher tenantId={tenantId} />
            </Suspense>
            <NotificationBellErrorBoundary>
              <Suspense fallback={<NotificationBellSkeleton />}>
                <NotificationBell />
              </Suspense>
            </NotificationBellErrorBoundary>
            <Suspense fallback={<ConsoleHeaderUserSkeleton />}>
              <AdminUser
                logoutAction={logoutAction.bind(null, tenant.publicId)}
              />
            </Suspense>
          </ConsoleHeaderActions>
        </ConsoleHeader>
        <ConsoleLayoutMain>{children}</ConsoleLayoutMain>
      </ConsoleLayoutContent>
    </ConsoleLayout>
  );
};
