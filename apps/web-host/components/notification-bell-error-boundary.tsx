"use client";

import { catchError } from "next/error";

import { NotificationBell } from "./notification-bell";

/**
 * Header chrome: an unexpected unread-count failure must not take down the
 * rest of the site. The empty bell still links to `/notifications`, which
 * is the source of truth. Classified count failures already render this same
 * empty bell; this boundary only catches the throw path.
 */
const notificationBellErrorFallback = ({ label }: { label: string }) => (
  <NotificationBell label={label} unreadCount={0} />
);

export const NotificationBellErrorBoundary = catchError(
  notificationBellErrorFallback
);
