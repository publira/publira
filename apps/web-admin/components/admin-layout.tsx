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
import { Suspense } from "react";
import type { ReactNode } from "react";

import { Message } from "#components/message";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";

import { verifyAdminSession } from "../lib/auth-session";
import { logoutAction } from "../lib/logout-action";
import { getTenantName } from "../lib/public-api";
import { getTenantRoleLabel } from "../lib/role-labels";
import { tenantBrandingVariant } from "../lib/tenant-branding-image";
import type { TenantBrandingImageVariant } from "../lib/tenant-branding-image";
import { getTenantId } from "../lib/tenant-id";
import { getTenantThemeLogo } from "../lib/theme-settings";
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

/**
 * The name the console chrome gives the tenant, from the public `GetTenant`
 * every operator of the tenant shares. Empty while that read fails: the chrome
 * has nothing to report a failure in, and the page below it reports its own.
 */
const getConsoleTenantName = async (): Promise<string> => {
  const tenantId = await getTenantId();
  return (await getTenantName(tenantId)) ?? "";
};

const getConsoleLogo = async (): Promise<TenantBrandingImageVariant | null> => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);

  return tenantBrandingVariant(await getTenantThemeLogo(tenantId, locale));
};

/**
 * The signed-in operator's menu.
 *
 * The proxy lets a request in on the cookie alone, so this is where a session
 * the API has since rejected is sent back to `/login` on every screen — with
 * the path to come back to, and the marker that makes the proxy drop the
 * cookie.
 */
export const AdminUser = async () => {
  const tenantId = await getTenantId();
  const user = await verifyAdminSession(tenantId);

  const locale = await getLocale(tenantId);
  const t = await getMessagesFor(locale);

  return (
    <ConsoleHeaderUser>
      <ConsoleUserMenuTrigger
        aria-label={t("admin.shell.account_menu", {
          name: user.name,
        })}
      >
        <ConsoleUserMenuInitial>{user.name}</ConsoleUserMenuInitial>
      </ConsoleUserMenuTrigger>
      <ConsoleUserMenuContent>
        <ConsoleUserMenuIdentity>
          <ConsoleUserMenuName>{user.name}</ConsoleUserMenuName>
          <ConsoleUserMenuPublicId>{user.publicId}</ConsoleUserMenuPublicId>
          <ConsoleUserMenuRole>
            {await getTenantRoleLabel(user.role, locale)}
          </ConsoleUserMenuRole>
        </ConsoleUserMenuIdentity>
        <ConsoleUserMenuSeparator />
        <ConsoleUserMenuAccountLink href="/settings/account">
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <Message message="admin.shell.account_settings" />
          </Suspense>
        </ConsoleUserMenuAccountLink>
        <ConsoleUserMenuLogout action={logoutAction.bind(null, tenantId)}>
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

const AdminMobileNavigation = async () => {
  const locale = await getLocale(await getTenantId());
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

/**
 * The sidebar names the tenant either way: as its own mark when it has one,
 * and as the brand text when it does not. The platform name never appears in
 * tenant chrome.
 */
export const AdminSidebarBrandMark = async () => {
  const [tenantName, logoVariant] = await Promise.all([
    getConsoleTenantName(),
    getConsoleLogo(),
  ]);

  return logoVariant ? (
    <Suspense fallback={<Skeleton className="h-8 w-[10rem]" />}>
      <AdminBrandLogo
        className="h-8 max-w-[10rem]"
        tenantName={tenantName}
        variant={logoVariant}
      />
    </Suspense>
  ) : (
    <ConsoleSidebarBrandName>{tenantName}</ConsoleSidebarBrandName>
  );
};

/** The tenant name under a logo, which the brand text already is otherwise. */
export const AdminSidebarContext = async () => {
  const [tenantName, logoVariant] = await Promise.all([
    getConsoleTenantName(),
    getConsoleLogo(),
  ]);

  return logoVariant ? (
    <ConsoleSidebarContext>{tenantName}</ConsoleSidebarContext>
  ) : null;
};

export const AdminHeaderBrand = async () => {
  const [tenantName, logoVariant] = await Promise.all([
    getConsoleTenantName(),
    getConsoleLogo(),
  ]);

  return logoVariant ? (
    <Suspense fallback={<Skeleton className="h-6 w-[7rem]" />}>
      <AdminBrandLogo priority tenantName={tenantName} variant={logoVariant} />
    </Suspense>
  ) : null;
};

export const AdminHeaderTenantName = async () => await getConsoleTenantName();

/**
 * The console chrome around every protected screen.
 *
 * It reads nothing itself, so the sidebar navigation, the header, and
 * `children` are in the static shell. Each part that names the tenant, shows
 * its logo, or needs the session waits behind a boundary of its own.
 */
export const AdminLayout = ({ children }: { children: ReactNode }) => (
  <ConsoleLayout>
    <Suspense fallback={null}>
      <AdminMobileNavigation />
    </Suspense>
    <ConsoleSidebar>
      <ConsoleSidebarBrand>
        <Suspense fallback={<SkeletonLine className="h-7 w-32" />}>
          <AdminSidebarBrandMark />
        </Suspense>
      </ConsoleSidebarBrand>
      <Suspense fallback={null}>
        <AdminSidebarContext />
      </Suspense>
      <AdminNavigation />
    </ConsoleSidebar>

    <ConsoleLayoutContent>
      <ConsoleHeader>
        <ConsoleHeaderContext>
          <Suspense fallback={null}>
            <AdminHeaderBrand />
          </Suspense>
          <ConsoleHeaderText>
            <ConsoleHeaderLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                <AdminHeaderTenantName />
              </Suspense>
            </ConsoleHeaderLabel>
          </ConsoleHeaderText>
        </ConsoleHeaderContext>
        <ConsoleHeaderActions>
          <Suspense fallback={<Skeleton className="size-9 rounded-control" />}>
            <AdminLocaleSwitcher />
          </Suspense>
          <NotificationBellErrorBoundary>
            <Suspense fallback={<NotificationBellSkeleton />}>
              <NotificationBell />
            </Suspense>
          </NotificationBellErrorBoundary>
          <Suspense fallback={<ConsoleHeaderUserSkeleton />}>
            <AdminUser />
          </Suspense>
        </ConsoleHeaderActions>
      </ConsoleHeader>
      <ConsoleLayoutMain>{children}</ConsoleLayoutMain>
    </ConsoleLayoutContent>
  </ConsoleLayout>
);
