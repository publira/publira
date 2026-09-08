import { getMessage } from "@publira/i18n";
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
  ConsoleSidebarNavigation,
  ConsoleSidebarNavigationItem,
  ConsoleSidebarNavigationItemHeading,
  ConsoleSidebarNavigationItemIcon,
  ConsoleSidebarNavigationItemLabel,
  ConsoleSidebarNavigationItems,
  ConsoleSidebarNavigationSection,
  ConsoleSidebarNavigationTitle,
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
  navigationHrefs,
} from "@publira/layouts/admin";
import { Skeleton } from "@publira/ui-components/skeleton";
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
  const messages = await loadAdminMessages(locale);

  return (
    <ConsoleHeaderUser>
      <ConsoleUserMenuTrigger
        aria-label={getMessage(messages, "admin.shell.account_menu", {
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
            {getTenantRoleLabel(result.user.role, messages)}
          </ConsoleUserMenuRole>
        </ConsoleUserMenuIdentity>
        <ConsoleUserMenuSeparator />
        <ConsoleUserMenuAccountLink href="/settings/account">
          {getMessage(messages, "admin.shell.account_settings")}
        </ConsoleUserMenuAccountLink>
        <ConsoleUserMenuLogout action={logout}>
          <ConsoleUserMenuLogoutButton>
            {getMessage(messages, "admin.shell.logout")}
          </ConsoleUserMenuLogoutButton>
        </ConsoleUserMenuLogout>
      </ConsoleUserMenuContent>
    </ConsoleHeaderUser>
  );
};

const AdminMobileNavigation = async ({ tenantId }: { tenantId: string }) => {
  const locale = await getLocale(tenantId);
  const messages = await loadAdminMessages(locale);

  return (
    <>
      <ConsoleMobileNavigation>
        <ConsoleMobileNavigationCloseButton
          aria-label={getMessage(messages, "admin.shell.navigation_close")}
        />
      </ConsoleMobileNavigation>
      <ConsoleMobileNavigationOpenButton
        aria-label={getMessage(messages, "admin.shell.navigation_open")}
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
        <ConsoleSidebarNavigation hrefs={navigationHrefs(navigation)}>
          {navigation.map((section) => (
            <ConsoleSidebarNavigationSection
              key={section.id ?? section.items[0]?.href}
            >
              <ConsoleSidebarNavigationTitle>
                {section.title}
              </ConsoleSidebarNavigationTitle>
              <ConsoleSidebarNavigationItems>
                {section.items.map((item) => (
                  <ConsoleSidebarNavigationItem
                    href={item.href}
                    key={item.href}
                  >
                    <ConsoleSidebarNavigationItemIcon>
                      <item.icon className="size-4" />
                    </ConsoleSidebarNavigationItemIcon>
                    <ConsoleSidebarNavigationItemHeading>
                      <ConsoleSidebarNavigationItemLabel>
                        {item.label}
                      </ConsoleSidebarNavigationItemLabel>
                      {item.badge}
                    </ConsoleSidebarNavigationItemHeading>
                  </ConsoleSidebarNavigationItem>
                ))}
              </ConsoleSidebarNavigationItems>
            </ConsoleSidebarNavigationSection>
          ))}
        </ConsoleSidebarNavigation>
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
            <Suspense fallback={<Skeleton className="h-8 w-24 rounded-full" />}>
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
