"use client";

import { BellIcon } from "@publira/icons";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@publira/ui-components/popover";
import { Skeleton } from "@publira/ui-components/skeleton";
import Link from "next/link";
import { createContext, useCallback, useContext, useState } from "react";
import type { ReactNode } from "react";

const NotificationBellCloseContext = createContext<(() => void) | null>(null);

const useNotificationBellClose = () => {
  const close = useContext(NotificationBellCloseContext);
  if (!close) {
    throw new Error(
      "NotificationBell links must be rendered inside NotificationBell"
    );
  }

  return close;
};

export const NotificationBellSkeleton = () => (
  <span
    aria-hidden="true"
    className="inline-flex size-9 items-center justify-center"
  >
    <Skeleton className="size-5 rounded" />
  </span>
);

/**
 * Header notification menu frame. Its trigger, state, and rows are explicit
 * child slots so callers keep copy and loading boundaries at their call sites.
 */
export const NotificationBellMenu = ({ children }: { children: ReactNode }) => {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  return (
    <NotificationBellCloseContext.Provider value={close}>
      <Popover onOpenChange={setOpen} open={open}>
        {children}
      </Popover>
    </NotificationBellCloseContext.Provider>
  );
};

export const NotificationBellTrigger = ({
  children,
  unreadCount,
}: {
  children: ReactNode;
  unreadCount: number;
}) => {
  const count = Math.max(0, unreadCount);

  return (
    <PopoverTrigger className="relative inline-flex size-9 items-center justify-center rounded-md text-foreground transition-colors hover:bg-muted data-popup-open:bg-muted">
      <BellIcon aria-hidden="true" className="size-5" />
      <span className="sr-only">{children}</span>
      {count > 0 ? (
        <span
          aria-hidden="true"
          className="absolute -top-1 -right-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-xs leading-none font-medium text-destructive-foreground"
        >
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </PopoverTrigger>
  );
};

export const NotificationBellContent = ({
  children,
}: {
  children: ReactNode;
}) => (
  <PopoverContent align="end" className="w-80" sideOffset={8}>
    {children}
  </PopoverContent>
);

export const NotificationBellHeader = ({
  children,
  unreadCount,
}: {
  children: ReactNode;
  unreadCount: number;
}) => (
  <div className="flex items-center justify-between gap-3 px-2.5 pt-2 pb-1.5">
    <PopoverTitle className="text-sm font-semibold">{children}</PopoverTitle>
    {unreadCount > 0 ? (
      <span className="text-xs text-muted-foreground">
        {unreadCount > 99 ? "99+" : unreadCount}
      </span>
    ) : null}
  </div>
);

export const NotificationBellLoading = ({
  children,
}: {
  children: ReactNode;
}) => <p className="px-2.5 py-4 text-sm text-muted-foreground">{children}</p>;

export const NotificationBellError = ({
  children,
}: {
  children: ReactNode;
}) => (
  <p className="px-2.5 py-4 text-sm text-muted-foreground" role="alert">
    {children}
  </p>
);

export const NotificationBellEmpty = ({
  children,
}: {
  children: ReactNode;
}) => (
  <div className="px-2.5 py-4 text-sm text-muted-foreground">{children}</div>
);

export const NotificationBellEmptyTitle = ({
  children,
}: {
  children: ReactNode;
}) => <p className="font-medium text-foreground">{children}</p>;

export const NotificationBellEmptyDescription = ({
  children,
}: {
  children: ReactNode;
}) => <p className="mt-1">{children}</p>;

export const NotificationBellList = ({ children }: { children: ReactNode }) => (
  <div className="grid gap-1">{children}</div>
);

export const NotificationBellItem = ({
  children,
  href,
  isRead,
}: {
  children: ReactNode;
  href?: string;
  isRead: boolean;
}) => {
  const close = useNotificationBellClose();
  const content = (
    <span className="flex items-start gap-2">
      <span
        aria-hidden="true"
        className={
          isRead
            ? "mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground/50"
            : "mt-1.5 size-1.5 shrink-0 rounded-full bg-primary"
        }
      />
      <span className="min-w-0">{children}</span>
    </span>
  );

  return href ? (
    <Link
      className="block cursor-default rounded-xl px-2.5 py-2.5 text-left outline-hidden select-none data-highlighted:bg-muted/70"
      href={href}
      onClick={close}
    >
      {content}
    </Link>
  ) : (
    <div className="rounded-xl px-2.5 py-2.5 text-left">{content}</div>
  );
};

export const NotificationBellItemState = ({
  children,
}: {
  children: ReactNode;
}) => <span className="sr-only">{children}</span>;

export const NotificationBellItemTitle = ({
  children,
}: {
  children: ReactNode;
}) => <span className="block truncate text-sm font-medium">{children}</span>;

export const NotificationBellItemDescription = ({
  children,
}: {
  children: ReactNode;
}) => (
  <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
    {children}
  </span>
);

export const NotificationBellMore = ({
  children,
  href,
}: {
  children: ReactNode;
  href: string;
}) => {
  const close = useNotificationBellClose();

  return (
    <>
      <div className="my-1.5 h-px bg-border/70" />
      <Link
        className="flex items-center justify-center rounded-xl px-3 py-2 text-sm font-medium text-foreground underline underline-offset-4 outline-hidden hover:bg-muted"
        href={href}
        onClick={close}
      >
        {children}
      </Link>
    </>
  );
};
