"use client";

import { catchError } from "next/error";
import { Suspense } from "react";

import { ClientMessage } from "./client-message";
import {
  NotificationBell,
  NotificationBellSkeleton,
} from "./notification-bell";

/**
 * Header chrome: an unexpected unread-count failure must not take down the
 * rest of the console. The empty bell still links to `/notifications`, which
 * is the source of truth. Classified count failures already render this same
 * empty bell; this boundary only catches the throw path.
 */
const notificationBellErrorFallback = () => (
  <Suspense fallback={<NotificationBellSkeleton />}>
    <NotificationBell
      ariaLabel={<ClientMessage message="platform.shell.notifications_none" />}
      unreadCount={0}
    />
  </Suspense>
);

export const NotificationBellErrorBoundary = catchError(
  notificationBellErrorFallback
);
