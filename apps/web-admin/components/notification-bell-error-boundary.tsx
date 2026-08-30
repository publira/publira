import { Skeleton } from "@publira/ui-components/skeleton";
import type { ReactNode } from "react";
import { Suspense } from "react";

import { Message } from "./message";
import { NotificationBellErrorCatch } from "./notification-bell-error-catch";
import {
  NotificationBellContent,
  NotificationBellError,
  NotificationBellHeader,
  NotificationBellMenu,
  NotificationBellMore,
  NotificationBellTrigger,
} from "./notification-bell-menu";

const NotificationBellErrorFallback = () => (
  <NotificationBellMenu>
    <NotificationBellTrigger unreadCount={0}>
      <Suspense fallback={null}>
        <Message message="admin.shell.notifications_none" />
      </Suspense>
    </NotificationBellTrigger>
    <NotificationBellContent>
      <NotificationBellHeader unreadCount={0}>
        <Suspense fallback={<Skeleton className="h-4 w-16" />}>
          <Message message="admin.notifications.title" />
        </Suspense>
      </NotificationBellHeader>
      <NotificationBellError>
        <Suspense fallback={<Skeleton className="h-4 w-64" />}>
          <Message message="admin.notifications.list_failed" />
        </Suspense>
      </NotificationBellError>
      <NotificationBellMore href="/notifications">
        <Suspense fallback={<Skeleton className="h-4 w-16" />}>
          <Message message="admin.notifications.menu_more" />
        </Suspense>
      </NotificationBellMore>
    </NotificationBellContent>
  </NotificationBellMenu>
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
