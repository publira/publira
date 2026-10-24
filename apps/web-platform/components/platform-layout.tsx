import * as ConsoleHeader from "@publira/layouts/admin/console-header";
import * as ConsoleLayout from "@publira/layouts/admin/console-layout";
import * as ConsoleSidebar from "@publira/layouts/admin/console-sidebar";
import * as ConsoleUserMenu from "@publira/layouts/admin/console-user-menu";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import type { ReactNode } from "react";

import { getMessagesFor } from "#lib/messages";

import { getPlatformCurrentOperator } from "../lib/auth";
import { redirectToLoginIfSessionRejected } from "../lib/auth-session";
import { getPlatformLocale } from "../lib/locale";
import { logoutAction } from "../lib/logout-action";
import {
  countUnreadNotifications,
  listNotifications,
} from "../lib/notification";
import { getOperatorRoleLabel } from "../lib/operator-labels";
import { PlatformLocaleSwitcher } from "./locale-switcher";
import { Message } from "./message";
import * as NotificationBell from "./notification-bell";
import { NotificationBellErrorBoundary } from "./notification-bell-error-boundary";
import { PlatformNavigation } from "./platform-navigation";

const notificationMenuLimit = 5;

export const PlatformUser = async () => {
  const result = await getPlatformCurrentOperator();
  if (!result.ok) {
    // The proxy let this request in on a cookie the API has since rejected, so
    // the console asks for the session again — with the path to come back to,
    // and the marker that makes the proxy drop the cookie.
    await redirectToLoginIfSessionRejected(result);
    redirect("/login");
  }

  const locale = await getPlatformLocale();
  const t = await getMessagesFor(locale);

  return (
    <ConsoleUserMenu.Root>
      <ConsoleUserMenu.Trigger
        aria-label={t("platform.shell.account_menu", {
          name: result.operator.name,
        })}
      >
        <ConsoleUserMenu.Initial>
          {result.operator.name}
        </ConsoleUserMenu.Initial>
      </ConsoleUserMenu.Trigger>
      <ConsoleUserMenu.Content>
        <ConsoleUserMenu.Identity>
          <ConsoleUserMenu.Name>{result.operator.name}</ConsoleUserMenu.Name>
          <ConsoleUserMenu.PublicId>
            {result.operator.publicId}
          </ConsoleUserMenu.PublicId>
          <ConsoleUserMenu.Role>
            {await getOperatorRoleLabel(result.operator.role, locale)}
          </ConsoleUserMenu.Role>
        </ConsoleUserMenu.Identity>
        <ConsoleUserMenu.Separator />
        <ConsoleUserMenu.AccountLink href="/account">
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <Message message="platform.shell.account_settings" />
          </Suspense>
        </ConsoleUserMenu.AccountLink>
        <ConsoleUserMenu.Logout action={logoutAction}>
          <ConsoleUserMenu.LogoutButton>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="platform.shell.logout" />
            </Suspense>
          </ConsoleUserMenu.LogoutButton>
        </ConsoleUserMenu.Logout>
      </ConsoleUserMenu.Content>
    </ConsoleUserMenu.Root>
  );
};

export const PlatformNotificationBell = async () => {
  const locale = await getPlatformLocale();
  const [list, unread, t] = await Promise.all([
    listNotifications(locale, { limit: notificationMenuLimit }),
    countUnreadNotifications(locale),
    getMessagesFor(locale),
  ]);
  const count = Math.max(0, unread.unreadCount);
  const ariaLabel =
    count > 0
      ? t("platform.shell.notifications_unread", {
          count,
        })
      : t("platform.shell.notifications_none");
  let notificationContent = (
    <NotificationBell.Error>
      <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
        <Message message="platform.notifications.list_error" />
      </Suspense>
    </NotificationBell.Error>
  );

  if (list.ok && list.notifications.length === 0) {
    notificationContent = (
      <NotificationBell.Empty>
        <NotificationBell.EmptyTitle>
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <Message message="platform.notifications.empty_title" />
          </Suspense>
        </NotificationBell.EmptyTitle>
        <NotificationBell.EmptyDescription>
          <Suspense fallback={<SkeletonLine className="mt-1 h-4 w-56" />}>
            <Message message="platform.notifications.empty_description" />
          </Suspense>
        </NotificationBell.EmptyDescription>
      </NotificationBell.Empty>
    );
  }

  if (list.ok && list.notifications.length > 0) {
    notificationContent = (
      <NotificationBell.List>
        {list.notifications.map((notification) => (
          <NotificationBell.Item
            href={notification.href}
            isRead={notification.isRead}
            key={notification.id}
          >
            <NotificationBell.ItemState>
              <Suspense fallback={null}>
                {notification.isRead ? (
                  <Message message="platform.notifications.read" />
                ) : (
                  <Message message="platform.notifications.unread" />
                )}
              </Suspense>
            </NotificationBell.ItemState>
            <NotificationBell.ItemTitle>
              {notification.title}
            </NotificationBell.ItemTitle>
            <NotificationBell.ItemDescription>
              {notification.description}
            </NotificationBell.ItemDescription>
          </NotificationBell.Item>
        ))}
      </NotificationBell.List>
    );
  }

  return (
    <NotificationBell.Root>
      <NotificationBell.Trigger unreadCount={unread.unreadCount}>
        {ariaLabel}
      </NotificationBell.Trigger>
      <NotificationBell.Content>
        <NotificationBell.Header unreadCount={unread.unreadCount}>
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="platform.notifications.title" />
          </Suspense>
        </NotificationBell.Header>
        {notificationContent}
        <NotificationBell.More href="/notifications">
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="platform.notifications.menu_more" />
          </Suspense>
        </NotificationBell.More>
      </NotificationBell.Content>
    </NotificationBell.Root>
  );
};

const PlatformMobileNavigation = async () => {
  const locale = await getPlatformLocale();
  const t = await getMessagesFor(locale);

  return (
    <>
      <ConsoleLayout.MobileNavigation>
        <ConsoleLayout.MobileNavigationCloseButton
          aria-label={t("platform.shell.navigation_close")}
        />
      </ConsoleLayout.MobileNavigation>
      <ConsoleLayout.MobileNavigationOpenButton
        aria-label={t("platform.shell.navigation_open")}
      />
    </>
  );
};

export const PlatformLayout = ({ children }: { children: ReactNode }) => (
  <ConsoleLayout.Root>
    <Suspense fallback={null}>
      <PlatformMobileNavigation />
    </Suspense>
    <ConsoleSidebar.Root>
      <ConsoleSidebar.Brand>
        <ConsoleSidebar.BrandName>Publira</ConsoleSidebar.BrandName>
      </ConsoleSidebar.Brand>
      <ConsoleSidebar.Context>
        <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
          <Message message="platform.shell.name" />
        </Suspense>
      </ConsoleSidebar.Context>
      <PlatformNavigation />
    </ConsoleSidebar.Root>

    <ConsoleLayout.Content>
      <ConsoleHeader.Root>
        <ConsoleHeader.Context>
          <ConsoleHeader.Text>
            <ConsoleHeader.Label>
              <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
                <Message message="platform.shell.context" />
              </Suspense>
            </ConsoleHeader.Label>
          </ConsoleHeader.Text>
        </ConsoleHeader.Context>
        <ConsoleHeader.Actions>
          <Suspense
            fallback={
              <SkeletonLine className="size-9 rounded-control pointer-coarse:size-11" />
            }
          >
            <PlatformLocaleSwitcher />
          </Suspense>
          <NotificationBellErrorBoundary>
            <Suspense fallback={<NotificationBell.Skeleton />}>
              <PlatformNotificationBell />
            </Suspense>
          </NotificationBellErrorBoundary>
          <Suspense fallback={<ConsoleHeader.UserSkeleton />}>
            <PlatformUser />
          </Suspense>
        </ConsoleHeader.Actions>
      </ConsoleHeader.Root>
      <ConsoleLayout.Main>{children}</ConsoleLayout.Main>
    </ConsoleLayout.Content>
  </ConsoleLayout.Root>
);
