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
  ConsoleSidebarBrandLabel,
  ConsoleSidebarBrandName,
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
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import type { ReactNode } from "react";

import { getPlatformCurrentOperator } from "../lib/auth";
import { redirectToLoginIfSessionRejected } from "../lib/auth-session";
import { getPlatformLocale, loadPlatformMessages } from "../lib/locale";
import { logoutAction } from "../lib/logout-action";
import {
  countUnreadNotifications,
  listNotifications,
} from "../lib/notification";
import { getOperatorRoleLabel } from "../lib/operator-labels";
import { PlatformLocaleSwitcher } from "./locale-switcher";
import { Message } from "./message";
import {
  NotificationBell,
  NotificationBellContent,
  NotificationBellEmpty,
  NotificationBellEmptyDescription,
  NotificationBellEmptyTitle,
  NotificationBellError,
  NotificationBellHeader,
  NotificationBellItem,
  NotificationBellItemDescription,
  NotificationBellItemState,
  NotificationBellItemTitle,
  NotificationBellList,
  NotificationBellMore,
  NotificationBellSkeleton,
  NotificationBellTrigger,
} from "./notification-bell";
import { NotificationBellErrorBoundary } from "./notification-bell-error-boundary";
import { navigation } from "./platform-navigation";

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
  const messages = await loadPlatformMessages(locale);

  return (
    <ConsoleHeaderUser>
      <ConsoleUserMenuTrigger
        ariaLabel={getMessage(messages, "platform.shell.account_menu", {
          name: result.operator.name,
        })}
      >
        <ConsoleUserMenuInitial>{result.operator.name}</ConsoleUserMenuInitial>
      </ConsoleUserMenuTrigger>
      <ConsoleUserMenuContent>
        <ConsoleUserMenuIdentity>
          <ConsoleUserMenuName>{result.operator.name}</ConsoleUserMenuName>
          <ConsoleUserMenuPublicId>
            {result.operator.publicId}
          </ConsoleUserMenuPublicId>
          <ConsoleUserMenuRole>
            {getOperatorRoleLabel(result.operator.role, messages)}
          </ConsoleUserMenuRole>
        </ConsoleUserMenuIdentity>
        <ConsoleUserMenuSeparator />
        <ConsoleUserMenuAccountLink href="/settings/account">
          {getMessage(messages, "platform.shell.account_settings")}
        </ConsoleUserMenuAccountLink>
        <ConsoleUserMenuLogout
          action={logoutAction}
          ariaLabel={getMessage(messages, "platform.shell.logout")}
        >
          {getMessage(messages, "platform.shell.logout")}
        </ConsoleUserMenuLogout>
      </ConsoleUserMenuContent>
    </ConsoleHeaderUser>
  );
};

export const PlatformNotificationBell = async () => {
  const locale = await getPlatformLocale();
  const [list, unread, messages] = await Promise.all([
    listNotifications(locale, { limit: notificationMenuLimit }),
    countUnreadNotifications(locale),
    loadPlatformMessages(locale),
  ]);
  const count = Math.max(0, unread.unreadCount);
  const ariaLabel =
    count > 0
      ? getMessage(messages, "platform.shell.notifications_unread", {
          count,
        })
      : getMessage(messages, "platform.shell.notifications_none");
  let notificationContent = (
    <NotificationBellError>
      <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
        <Message message="platform.notifications.list_error" />
      </Suspense>
    </NotificationBellError>
  );

  if (list.ok && list.notifications.length === 0) {
    notificationContent = (
      <NotificationBellEmpty>
        <NotificationBellEmptyTitle>
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <Message message="platform.notifications.empty_title" />
          </Suspense>
        </NotificationBellEmptyTitle>
        <NotificationBellEmptyDescription>
          <Suspense fallback={<SkeletonLine className="mt-1 h-4 w-56" />}>
            <Message message="platform.notifications.empty_description" />
          </Suspense>
        </NotificationBellEmptyDescription>
      </NotificationBellEmpty>
    );
  }

  if (list.ok && list.notifications.length > 0) {
    notificationContent = (
      <NotificationBellList>
        {list.notifications.map((notification) => (
          <NotificationBellItem
            href={notification.href}
            isRead={notification.isRead}
            key={notification.id}
          >
            <NotificationBellItemState>
              <Suspense fallback={null}>
                <Message
                  message={
                    notification.isRead
                      ? "platform.notifications.read"
                      : "platform.notifications.unread"
                  }
                />
              </Suspense>
            </NotificationBellItemState>
            <NotificationBellItemTitle>
              {notification.title}
            </NotificationBellItemTitle>
            <NotificationBellItemDescription>
              {notification.description}
            </NotificationBellItemDescription>
          </NotificationBellItem>
        ))}
      </NotificationBellList>
    );
  }

  return (
    <NotificationBell>
      <NotificationBellTrigger unreadCount={unread.unreadCount}>
        {ariaLabel}
      </NotificationBellTrigger>
      <NotificationBellContent>
        <NotificationBellHeader unreadCount={unread.unreadCount}>
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="platform.notifications.title" />
          </Suspense>
        </NotificationBellHeader>
        {notificationContent}
        <NotificationBellMore href="/notifications">
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="platform.notifications.menu_more" />
          </Suspense>
        </NotificationBellMore>
      </NotificationBellContent>
    </NotificationBell>
  );
};

const PlatformMobileNavigation = async () => {
  const locale = await getPlatformLocale();
  const messages = await loadPlatformMessages(locale);

  return (
    <>
      <ConsoleMobileNavigation>
        <ConsoleMobileNavigationCloseButton
          ariaLabel={getMessage(messages, "platform.shell.navigation_close")}
        />
      </ConsoleMobileNavigation>
      <ConsoleMobileNavigationOpenButton
        ariaLabel={getMessage(messages, "platform.shell.navigation_open")}
      />
    </>
  );
};

export const PlatformLayout = ({ children }: { children: ReactNode }) => (
  <ConsoleLayout theme="platform">
    <Suspense fallback={null}>
      <PlatformMobileNavigation />
    </Suspense>
    <ConsoleSidebar>
      <ConsoleSidebarBrand>
        <ConsoleSidebarBrandName>Publira</ConsoleSidebarBrandName>
        <ConsoleSidebarBrandLabel>Platform Console</ConsoleSidebarBrandLabel>
      </ConsoleSidebarBrand>
      <ConsoleSidebarContext>
        <div className="flex items-start justify-between gap-3">
          <div className="grid gap-1">
            <p className="text-sm font-medium text-foreground">
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="platform.shell.status_title" />
              </Suspense>
            </p>
            <p className="text-xs leading-5 text-muted-foreground">
              <Suspense fallback={<SkeletonLine className="h-3 w-48" />}>
                <Message message="platform.shell.status_body" />
              </Suspense>
            </p>
          </div>
          <StatusChip status="success">
            <Suspense fallback={<SkeletonLine className="h-3 w-12" />}>
              <Message message="platform.shell.status_online" />
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
                <ConsoleSidebarNavigationItem href={item.href} key={item.href}>
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
          <ConsoleHeaderText>
            <ConsoleHeaderEyebrow>
              <Suspense fallback={<SkeletonLine className="h-3 w-36" />}>
                <Message message="platform.shell.eyebrow" />
              </Suspense>
            </ConsoleHeaderEyebrow>
            <ConsoleHeaderLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
                <Message message="platform.shell.context" />
              </Suspense>
            </ConsoleHeaderLabel>
          </ConsoleHeaderText>
        </ConsoleHeaderContext>
        <ConsoleHeaderActions>
          <Suspense
            fallback={<SkeletonLine className="h-9 w-24 rounded-full" />}
          >
            <PlatformLocaleSwitcher />
          </Suspense>
          <NotificationBellErrorBoundary>
            <Suspense fallback={<NotificationBellSkeleton />}>
              <PlatformNotificationBell />
            </Suspense>
          </NotificationBellErrorBoundary>
          <Suspense fallback={<ConsoleHeaderUserSkeleton />}>
            <PlatformUser />
          </Suspense>
        </ConsoleHeaderActions>
      </ConsoleHeader>
      <ConsoleLayoutMain>{children}</ConsoleLayoutMain>
    </ConsoleLayoutContent>
  </ConsoleLayout>
);
