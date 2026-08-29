"use client";

import { catchError } from "next/error";

import { NotificationBell } from "./notification-bell";
import type { NotificationBellCopy } from "./notification-bell";

/**
 * Header chrome: an unexpected notification-read failure must not take down
 * the rest of the site. The complete history remains reachable from the error
 * popover, so a failed short read never removes the header control.
 */
const notificationBellErrorFallback = ({
  copy,
  label,
  moreHref,
}: {
  copy: NotificationBellCopy;
  label: string;
  moreHref: string;
}) => (
  <NotificationBell
    copy={copy}
    label={label}
    moreHref={moreHref}
    status="error"
    unreadCount={0}
  />
);

export const NotificationBellErrorBoundary = catchError(
  notificationBellErrorFallback
);
