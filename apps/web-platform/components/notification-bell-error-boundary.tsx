import { Skeleton } from "@publira/ui-components/skeleton";
import type { ReactNode } from "react";
import { Suspense } from "react";

import { Message } from "./message";
import {
  NotificationBell,
  NotificationBellContent,
  NotificationBellError,
  NotificationBellHeader,
  NotificationBellMore,
  NotificationBellTrigger,
} from "./notification-bell";
import { NotificationBellErrorCatch } from "./notification-bell-error-catch";

const NotificationBellErrorFallback = () => (
  <NotificationBell>
    <NotificationBellTrigger unreadCount={0}>
      <Suspense fallback={null}>
        <Message message="platform.shell.notifications_none" />
      </Suspense>
    </NotificationBellTrigger>
    <NotificationBellContent>
      <NotificationBellHeader unreadCount={0}>
        <Suspense fallback={<Skeleton className="h-4 w-16" />}>
          <Message message="platform.notifications.title" />
        </Suspense>
      </NotificationBellHeader>
      <NotificationBellError>
        <Suspense fallback={<Skeleton className="h-4 w-64" />}>
          <Message message="platform.notifications.list_failed" />
        </Suspense>
      </NotificationBellError>
      <NotificationBellMore href="/notifications">
        <Suspense fallback={<Skeleton className="h-4 w-16" />}>
          <Message message="platform.notifications.menu_more" />
        </Suspense>
      </NotificationBellMore>
    </NotificationBellContent>
  </NotificationBell>
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
