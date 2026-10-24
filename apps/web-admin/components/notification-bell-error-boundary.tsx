import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import type { ReactNode } from "react";
import { Suspense } from "react";

import { Message } from "./message";
import * as NotificationBell from "./notification-bell";
import { NotificationBellErrorCatch } from "./notification-bell-error-catch";

const NotificationBellErrorFallback = () => (
  <NotificationBell.Menu>
    <NotificationBell.Trigger unreadCount={0}>
      <Suspense fallback={null}>
        <Message message="admin.shell.notifications_none" />
      </Suspense>
    </NotificationBell.Trigger>
    <NotificationBell.Content>
      <NotificationBell.Header unreadCount={0}>
        <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
          <Message message="admin.notifications.title" />
        </Suspense>
      </NotificationBell.Header>
      <NotificationBell.Error>
        <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
          <Message message="admin.notifications.list_failed" />
        </Suspense>
      </NotificationBell.Error>
      <NotificationBell.More href="/notifications">
        <Suspense fallback={<Skeleton className="h-4 w-16" />}>
          <Message message="admin.notifications.menu_more" />
        </Suspense>
      </NotificationBell.More>
    </NotificationBell.Content>
  </NotificationBell.Menu>
);

/**
 * An unexpected notification read must not remove header chrome. This Server
 * Component owns its generic fallback copy; the client catch boundary only
 * receives rendered slots.
 */
export const NotificationBellErrorBoundary = ({
  children,
}: {
  children: ReactNode;
}) => (
  <NotificationBellErrorCatch fallback={<NotificationBellErrorFallback />}>
    {children}
  </NotificationBellErrorCatch>
);
