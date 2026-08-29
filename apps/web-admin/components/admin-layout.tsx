import { getMessage } from "@publira/i18n";
import {
  ConsoleHeader,
  ConsoleHeaderActions,
  ConsoleHeaderContext,
  ConsoleHeaderEyebrow,
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
  ConsoleSidebarContext,
  ConsoleSidebarNavigation,
  ConsoleSidebarNavigationContent,
  ConsoleSidebarNavigationIcon,
  ConsoleSidebarNavigationItem,
  ConsoleSidebarNavigationItemDescription,
  ConsoleSidebarNavigationItemLabel,
  ConsoleSidebarNavigationItems,
  ConsoleSidebarNavigationSection,
  ConsoleSidebarNavigationTitle,
  ConsoleUserMenuAccountLink,
  ConsoleUserMenuContent,
  ConsoleUserMenuIdentity,
  ConsoleUserMenuInitial,
  ConsoleUserMenuLogout,
  ConsoleUserMenuName,
  ConsoleUserMenuPublicId,
  ConsoleUserMenuRole,
  ConsoleUserMenuSeparator,
  ConsoleUserMenuTrigger,
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
    <ConsoleHeaderUser>
      <ConsoleUserMenuTrigger
        ariaLabel={getMessage(messages, "admin.shell.account_menu", {
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
        <ConsoleUserMenuLogout
          action={logout}
          ariaLabel={getMessage(messages, "admin.shell.logout")}
        >
          {getMessage(messages, "admin.shell.logout")}
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
          ariaLabel={getMessage(messages, "admin.shell.navigation_close")}
        />
      </ConsoleMobileNavigation>
      <ConsoleMobileNavigationOpenButton
        ariaLabel={getMessage(messages, "admin.shell.navigation_open")}
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
      <Suspense fallback={null}>
        <AdminMobileNavigation tenantId={tenantId} />
      </Suspense>
      <ConsoleSidebar>
        <ConsoleSidebarBrand>{sidebarBrand}</ConsoleSidebarBrand>
        <ConsoleSidebarContext>
          <div className="flex items-start justify-between gap-3">
            <div className="grid gap-1">
              <p className="text-sm font-medium text-foreground">
                {tenant.name}
              </p>
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
        </ConsoleSidebarContext>
        <ConsoleSidebarNavigation>
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
                    <ConsoleSidebarNavigationIcon>
                      <item.icon className="size-5" />
                    </ConsoleSidebarNavigationIcon>
                    <ConsoleSidebarNavigationContent>
                      <ConsoleSidebarNavigationItemLabel>
                        {item.label}
                      </ConsoleSidebarNavigationItemLabel>
                      <ConsoleSidebarNavigationItemDescription>
                        {item.description}
                      </ConsoleSidebarNavigationItemDescription>
                    </ConsoleSidebarNavigationContent>
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
              <ConsoleHeaderEyebrow>
                <Suspense fallback={<SkeletonLine className="h-3 w-28" />}>
                  <Message message="admin.shell.eyebrow" />
                </Suspense>
              </ConsoleHeaderEyebrow>
              <ConsoleHeaderLabel>{tenant.name}</ConsoleHeaderLabel>
            </ConsoleHeaderText>
          </ConsoleHeaderContext>
          <ConsoleHeaderActions>
            <Suspense fallback={<NotificationBellSkeleton />}>
              <NotificationBell />
            </Suspense>
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
