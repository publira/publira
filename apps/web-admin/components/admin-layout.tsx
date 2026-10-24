import * as ConsoleHeader from "@publira/layouts/admin/console-header";
import * as ConsoleLayout from "@publira/layouts/admin/console-layout";
import * as ConsoleSidebar from "@publira/layouts/admin/console-sidebar";
import * as ConsoleUserMenu from "@publira/layouts/admin/console-user-menu";
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
import * as NotificationBell from "./notification-bell";
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
    <ConsoleUserMenu.Root>
      <ConsoleUserMenu.Trigger
        aria-label={t("admin.shell.account_menu", {
          name: user.name,
        })}
      >
        <ConsoleUserMenu.Initial>{user.name}</ConsoleUserMenu.Initial>
      </ConsoleUserMenu.Trigger>
      <ConsoleUserMenu.Content>
        <ConsoleUserMenu.Identity>
          <ConsoleUserMenu.Name>{user.name}</ConsoleUserMenu.Name>
          <ConsoleUserMenu.PublicId>{user.publicId}</ConsoleUserMenu.PublicId>
          <ConsoleUserMenu.Role>
            {await getTenantRoleLabel(user.role, locale)}
          </ConsoleUserMenu.Role>
        </ConsoleUserMenu.Identity>
        <ConsoleUserMenu.Separator />
        <ConsoleUserMenu.AccountLink href="/settings/account">
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <Message message="admin.shell.account_settings" />
          </Suspense>
        </ConsoleUserMenu.AccountLink>
        <ConsoleUserMenu.Logout action={logoutAction.bind(null, tenantId)}>
          <ConsoleUserMenu.LogoutButton>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.shell.logout" />
            </Suspense>
          </ConsoleUserMenu.LogoutButton>
        </ConsoleUserMenu.Logout>
      </ConsoleUserMenu.Content>
    </ConsoleUserMenu.Root>
  );
};

const AdminMobileNavigation = async () => {
  const locale = await getLocale(await getTenantId());
  const t = await getMessagesFor(locale);

  return (
    <>
      <ConsoleLayout.MobileNavigation>
        <ConsoleLayout.MobileNavigationCloseButton
          aria-label={t("admin.shell.navigation_close")}
        />
      </ConsoleLayout.MobileNavigation>
      <ConsoleLayout.MobileNavigationOpenButton
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
    <ConsoleSidebar.BrandName>{tenantName}</ConsoleSidebar.BrandName>
  );
};

/** The tenant name under a logo, which the brand text already is otherwise. */
export const AdminSidebarContext = async () => {
  const [tenantName, logoVariant] = await Promise.all([
    getConsoleTenantName(),
    getConsoleLogo(),
  ]);

  return logoVariant ? (
    <ConsoleSidebar.Context>{tenantName}</ConsoleSidebar.Context>
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
  <ConsoleLayout.Root>
    <Suspense fallback={null}>
      <AdminMobileNavigation />
    </Suspense>
    <ConsoleSidebar.Root>
      <ConsoleSidebar.Brand>
        <Suspense fallback={<SkeletonLine className="h-7 w-32" />}>
          <AdminSidebarBrandMark />
        </Suspense>
      </ConsoleSidebar.Brand>
      <Suspense fallback={null}>
        <AdminSidebarContext />
      </Suspense>
      <AdminNavigation />
    </ConsoleSidebar.Root>

    <ConsoleLayout.Content>
      <ConsoleHeader.Root>
        <ConsoleHeader.Context>
          <Suspense fallback={null}>
            <AdminHeaderBrand />
          </Suspense>
          <ConsoleHeader.Text>
            <ConsoleHeader.Label>
              <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                <AdminHeaderTenantName />
              </Suspense>
            </ConsoleHeader.Label>
          </ConsoleHeader.Text>
        </ConsoleHeader.Context>
        <ConsoleHeader.Actions>
          <Suspense
            fallback={
              <Skeleton className="size-9 rounded-control pointer-coarse:size-11" />
            }
          >
            <AdminLocaleSwitcher />
          </Suspense>
          <NotificationBellErrorBoundary>
            <Suspense fallback={<NotificationBell.Skeleton />}>
              <NotificationBell.Root />
            </Suspense>
          </NotificationBellErrorBoundary>
          <Suspense fallback={<ConsoleHeader.UserSkeleton />}>
            <AdminUser />
          </Suspense>
        </ConsoleHeader.Actions>
      </ConsoleHeader.Root>
      <ConsoleLayout.Main>{children}</ConsoleLayout.Main>
    </ConsoleLayout.Content>
  </ConsoleLayout.Root>
);
