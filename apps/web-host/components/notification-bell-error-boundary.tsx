import { Skeleton } from "@publira/ui-components/skeleton";
import type { ReactNode } from "react";
import { Suspense } from "react";

import { Message } from "#components/message";

import {
  NotificationBell,
  NotificationBellContent,
  NotificationBellError,
  NotificationBellHeader,
  NotificationBellMore,
  NotificationBellTrigger,
} from "./notification-bell";
import { NotificationBellErrorCatch } from "./notification-bell-error-catch";

const NotificationBellErrorFallback = ({ moreHref }: { moreHref: string }) => (
  <NotificationBell>
    <NotificationBellTrigger unreadCount={0}>
      <Suspense fallback={null}>
        <Message message="host.nav.notifications_none" />
      </Suspense>
    </NotificationBellTrigger>
    <NotificationBellContent>
      <NotificationBellHeader unreadCount={0}>
        <Suspense fallback={<Skeleton className="h-4 w-16" />}>
          <Message message="host.notifications.list_heading" />
        </Suspense>
      </NotificationBellHeader>
      <NotificationBellError>
        <Suspense fallback={<Skeleton className="h-4 w-64" />}>
          <Message message="host.notifications.list_failed" />
        </Suspense>
      </NotificationBellError>
      <NotificationBellMore href={moreHref}>
        <Suspense fallback={<Skeleton className="h-4 w-16" />}>
          <Message message="host.notifications.menu_more" />
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
  moreHref,
}: {
  children: ReactNode;
  moreHref: string;
}) => (
  <NotificationBellErrorCatch
    fallback={<NotificationBellErrorFallback moreHref={moreHref} />}
  >
    {children}
  </NotificationBellErrorCatch>
);
