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
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import type { ReactNode } from "react";

import { getPlatformCurrentOperator } from "../lib/auth";
import { redirectToLoginIfSessionRejected } from "../lib/auth-session";
import { getPlatformLocale, loadPlatformMessages } from "../lib/locale";
import { logoutAction } from "../lib/logout-action";
import { countUnreadNotifications } from "../lib/notification";
import { getOperatorRoleLabel } from "../lib/operator-labels";
import { Message } from "./message";
import {
  NotificationBell,
  NotificationBellSkeleton,
} from "./notification-bell";
import { NotificationBellErrorBoundary } from "./notification-bell-error-boundary";
import { navigation } from "./platform-navigation";

const platformGradient =
  "bg-[radial-gradient(circle_at_top_left,rgba(21,121,194,0.11),transparent_28%),radial-gradient(circle_at_top_right,rgba(24,149,118,0.11),transparent_30%),linear-gradient(180deg,rgba(248,252,255,0.82),rgba(240,247,250,0.96))]";

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
    <ConsoleHeaderUser
      accountHref="/settings/account"
      currentUser={result.operator}
      logoutAction={logoutAction}
      roleLabel={getOperatorRoleLabel(result.operator.role, messages)}
      userMenuCopy={{
        accountMenuAriaLabel: getMessage(
          messages,
          "platform.shell.account_menu"
        ),
        accountSettings: getMessage(
          messages,
          "platform.shell.account_settings"
        ),
        logout: getMessage(messages, "platform.shell.logout"),
        logoutAriaLabel: getMessage(messages, "platform.shell.logout"),
      }}
    />
  );
};

export const PlatformNotificationBell = async () => {
  const [unread, locale] = await Promise.all([
    countUnreadNotifications(),
    getPlatformLocale(),
  ]);
  const messages = await loadPlatformMessages(locale);
  const count = Math.max(0, unread.unreadCount);
  const ariaLabel =
    count > 0
      ? getMessage(messages, "platform.shell.notifications_unread", {
          count,
        })
      : getMessage(messages, "platform.shell.notifications_none");

  return (
    <NotificationBell ariaLabel={ariaLabel} unreadCount={unread.unreadCount} />
  );
};

export const PlatformLayout = ({ children }: { children: ReactNode }) => (
  <ConsoleLayout gradient={platformGradient}>
    <ConsoleSidebar logoLabel="Platform Console" navigation={navigation}>
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
    </ConsoleSidebar>

    <ConsoleLayoutContent>
      <ConsoleHeader
        contextLabel={
          <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
            <Message message="platform.shell.context" />
          </Suspense>
        }
        eyebrow={
          <Suspense fallback={<SkeletonLine className="h-3 w-36" />}>
            <Message message="platform.shell.eyebrow" />
          </Suspense>
        }
      >
        <NotificationBellErrorBoundary>
          <Suspense fallback={<NotificationBellSkeleton />}>
            <PlatformNotificationBell />
          </Suspense>
        </NotificationBellErrorBoundary>
        <Suspense fallback={<ConsoleHeaderUserSkeleton />}>
          <PlatformUser />
        </Suspense>
      </ConsoleHeader>
      <ConsoleLayoutMain>{children}</ConsoleLayoutMain>
    </ConsoleLayoutContent>
  </ConsoleLayout>
);
