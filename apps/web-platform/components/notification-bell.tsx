import { BellIcon } from "@publira/icons";
import { Skeleton } from "@publira/ui-components/skeleton";
import Link from "next/link";
import type { ReactNode } from "react";

export const NotificationBellSkeleton = () => (
  <span
    aria-hidden="true"
    className="inline-flex size-9 items-center justify-center"
  >
    <Skeleton className="size-5 rounded" />
  </span>
);

export const NotificationBell = ({
  ariaLabel,
  unreadCount,
}: {
  ariaLabel: ReactNode;
  unreadCount: number;
}) => {
  const count = Math.max(0, unreadCount);

  return (
    <Link
      className="relative inline-flex size-9 items-center justify-center rounded-md text-foreground transition-colors hover:bg-muted"
      href="/notifications"
    >
      <span className="sr-only">{ariaLabel}</span>
      <BellIcon aria-hidden="true" className="size-5" />
      {count > 0 ? (
        <span
          aria-hidden="true"
          className="absolute -top-1 -right-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-xs leading-none font-medium text-destructive-foreground"
        >
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </Link>
  );
};
