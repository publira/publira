import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import type { ReactNode } from "react";
import { Suspense } from "react";

import { Message } from "#components/message";

import * as NotificationBell from "./notification-bell";
import { NotificationBellErrorCatch } from "./notification-bell-error-catch";

const NotificationBellErrorFallback = ({ moreHref }: { moreHref: string }) => (
  <NotificationBell.Root>
    <NotificationBell.Trigger unreadCount={0}>
      <Suspense fallback={null}>
        <Message message="storefront.nav.notifications_none" />
      </Suspense>
    </NotificationBell.Trigger>
    <NotificationBell.Content>
      <NotificationBell.Header unreadCount={0}>
        <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
          <Message message="storefront.notifications.list_heading" />
        </Suspense>
      </NotificationBell.Header>
      <NotificationBell.Error>
        <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
          <Message message="storefront.notifications.list_failed" />
        </Suspense>
      </NotificationBell.Error>
      <NotificationBell.More href={moreHref}>
        <Suspense fallback={<Skeleton className="h-4 w-16" />}>
          <Message message="storefront.notifications.menu_more" />
        </Suspense>
      </NotificationBell.More>
    </NotificationBell.Content>
  </NotificationBell.Root>
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
