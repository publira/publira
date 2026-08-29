"use client";

import { Popover } from "@base-ui/react/popover";
import { BellIcon } from "@publira/icons";
import { Skeleton } from "@publira/ui-components/skeleton";
import Link from "next/link";

export interface HeaderNotification {
  description: string;
  href?: string;
  id: string;
  isRead: boolean;
  title: string;
}

export interface NotificationBellCopy {
  emptyDescription: string;
  emptyTitle: string;
  errorDescription: string;
  heading: string;
  loadingDescription: string;
  more: string;
  read: string;
  unread: string;
}

export type NotificationBellStatus = "error" | "loading" | "ready";

const noNotifications: readonly HeaderNotification[] = [];

export const NotificationBellSkeleton = () => (
  <span
    aria-hidden="true"
    className="inline-flex size-9 items-center justify-center"
  >
    <Skeleton className="size-5 rounded" />
  </span>
);

export const NotificationBell = ({
  copy,
  label,
  moreHref,
  notifications = noNotifications,
  unreadCount,
  status = "ready",
}: {
  copy: NotificationBellCopy;
  /** `aria-label` of the bell, already resolved by the caller. */
  label: string;
  /** Locale-prefixed link to the complete notification history. */
  moreHref: string;
  /** The newest notifications, with locale-prefixed content links. */
  notifications?: readonly HeaderNotification[];
  unreadCount: number;
  /** The state of the header's short notification read. */
  status?: NotificationBellStatus;
}) => {
  const count = Math.max(0, unreadCount);

  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label={label}
        className="relative inline-flex size-9 items-center justify-center rounded-md text-foreground transition-colors hover:bg-muted data-popup-open:bg-muted"
      >
        <BellIcon aria-hidden="true" className="size-5" />
        {count > 0 ? (
          <span className="absolute -top-1 -right-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-xs leading-none font-medium text-destructive-foreground">
            {count > 99 ? "99+" : count}
          </span>
        ) : null}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          align="end"
          className="z-40 outline-hidden"
          sideOffset={8}
        >
          <Popover.Popup className="w-80 max-w-[calc(100vw-2rem)] origin-[var(--transform-origin)] rounded-2xl border border-border bg-card p-1.5 text-card-foreground shadow-lg outline-hidden">
            <div className="flex items-center justify-between gap-3 px-2.5 pt-2 pb-1.5">
              <Popover.Title className="text-sm font-semibold">
                {copy.heading}
              </Popover.Title>
              {count > 0 ? (
                <span className="text-xs text-muted-foreground">
                  {count > 99 ? "99+" : count}
                </span>
              ) : null}
            </div>

            {status === "loading" ? (
              <output className="px-2.5 py-4 text-sm text-muted-foreground">
                {copy.loadingDescription}
              </output>
            ) : null}

            {status === "error" ? (
              <p
                className="px-2.5 py-4 text-sm text-muted-foreground"
                role="alert"
              >
                {copy.errorDescription}
              </p>
            ) : null}

            {status === "ready" && notifications.length === 0 ? (
              <div className="px-2.5 py-4 text-sm text-muted-foreground">
                <p className="font-medium text-foreground">{copy.emptyTitle}</p>
                <p className="mt-1">{copy.emptyDescription}</p>
              </div>
            ) : null}

            {status === "ready" && notifications.length > 0 ? (
              <div className="grid gap-1">
                {notifications.map((notification) =>
                  notification.href ? (
                    <Link
                      className="block cursor-default rounded-xl px-2.5 py-2.5 text-left outline-hidden select-none data-highlighted:bg-muted/70"
                      href={notification.href}
                      key={notification.id}
                    >
                      <span className="flex items-start gap-2">
                        <span
                          aria-hidden="true"
                          className={
                            notification.isRead
                              ? "mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground/50"
                              : "mt-1.5 size-1.5 shrink-0 rounded-full bg-primary"
                          }
                        />
                        <span className="min-w-0">
                          <span className="sr-only">
                            {notification.isRead ? copy.read : copy.unread}
                          </span>
                          <span className="block truncate text-sm font-medium">
                            {notification.title}
                          </span>
                          <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
                            {notification.description}
                          </span>
                        </span>
                      </span>
                    </Link>
                  ) : (
                    <div
                      className="rounded-xl px-2.5 py-2.5 text-left"
                      key={notification.id}
                    >
                      <span className="flex items-start gap-2">
                        <span
                          aria-hidden="true"
                          className={
                            notification.isRead
                              ? "mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground/50"
                              : "mt-1.5 size-1.5 shrink-0 rounded-full bg-primary"
                          }
                        />
                        <span className="min-w-0">
                          <span className="sr-only">
                            {notification.isRead ? copy.read : copy.unread}
                          </span>
                          <span className="block truncate text-sm font-medium">
                            {notification.title}
                          </span>
                          <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
                            {notification.description}
                          </span>
                        </span>
                      </span>
                    </div>
                  )
                )}
              </div>
            ) : null}

            <div className="my-1.5 h-px bg-border/70" />
            <Link
              className="flex items-center justify-center rounded-xl px-3 py-2 text-sm font-medium text-foreground underline underline-offset-4 outline-hidden hover:bg-muted"
              href={moreHref}
            >
              {copy.more}
            </Link>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
};
