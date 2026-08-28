"use client";

import { Menu } from "@base-ui/react/menu";
import { LogoutIcon, SettingsIcon, UserIcon } from "@publira/icons";
import { StatusChip } from "@publira/ui-components/badge";
import Link from "next/link";
import type { ReactNode } from "react";

const itemClassName =
  "flex w-full cursor-default items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-foreground outline-hidden select-none data-highlighted:bg-muted/70 data-highlighted:text-foreground";

export const ConsoleHeaderUser = ({ children }: { children: ReactNode }) => (
  <Menu.Root>{children}</Menu.Root>
);

/** Alias for the composed account menu. */
export const ConsoleUserMenu = ConsoleHeaderUser;

export const ConsoleUserMenuTrigger = ({
  ariaLabel,
  children,
}: {
  /** Already-resolved `aria-label` for the account menu trigger. */
  ariaLabel: string;
  children?: ReactNode;
}) => (
  <Menu.Trigger
    aria-label={ariaLabel}
    className="inline-flex size-9 items-center justify-center rounded-full border border-border/70 bg-card text-sm font-medium text-foreground transition-colors hover:border-border hover:bg-muted data-popup-open:bg-muted"
  >
    {children ?? (
      <UserIcon aria-hidden="true" className="size-4 text-foreground" />
    )}
  </Menu.Trigger>
);

export const ConsoleUserMenuInitial = ({ children }: { children: string }) => {
  const [initial] = [...children.trim()];

  return initial ? initial.toUpperCase() : null;
};

export const ConsoleUserMenuContent = ({
  children,
}: {
  children: ReactNode;
}) => (
  <Menu.Portal>
    <Menu.Positioner align="end" className="z-40 outline-hidden" sideOffset={8}>
      <Menu.Popup className="w-64 max-w-[calc(100vw-2rem)] origin-[var(--transform-origin)] rounded-2xl border border-border bg-card p-1.5 text-card-foreground shadow-lg outline-hidden">
        {children}
      </Menu.Popup>
    </Menu.Positioner>
  </Menu.Portal>
);

export const ConsoleUserMenuIdentity = ({
  children,
}: {
  children: ReactNode;
}) => (
  <div className="grid justify-items-start gap-1 px-3 py-2">{children}</div>
);

export const ConsoleUserMenuName = ({ children }: { children: ReactNode }) => (
  <p className="max-w-full truncate text-sm font-medium text-foreground">
    {children}
  </p>
);

export const ConsoleUserMenuPublicId = ({
  children,
}: {
  children: ReactNode;
}) => (
  <p className="max-w-full truncate text-xs text-muted-foreground">
    {children}
  </p>
);

export const ConsoleUserMenuRole = ({ children }: { children: ReactNode }) => (
  <StatusChip status="info">{children}</StatusChip>
);

export const ConsoleUserMenuSeparator = () => (
  <Menu.Separator className="my-1.5 h-px bg-border/70" />
);

export const ConsoleUserMenuAccountLink = ({
  children,
  href,
}: {
  children: ReactNode;
  href: string;
}) => (
  <Menu.LinkItem
    className={itemClassName}
    closeOnClick
    render={<Link href={href} />}
  >
    <SettingsIcon aria-hidden="true" className="size-4 text-muted-foreground" />
    {children}
  </Menu.LinkItem>
);

export const ConsoleUserMenuLogout = ({
  action,
  ariaLabel,
  children,
}: {
  action: (formData: FormData) => void | Promise<void>;
  /** Already-resolved `aria-label` for the sign-out control. */
  ariaLabel: string;
  children: ReactNode;
}) => (
  <form action={action}>
    {/* The item stays mounted through the submit: closing the menu on click
        would unmount the form the Action is submitting. */}
    <Menu.Item
      className={itemClassName}
      closeOnClick={false}
      nativeButton
      render={<button aria-label={ariaLabel} type="submit" />}
    >
      <LogoutIcon aria-hidden="true" className="size-4 text-muted-foreground" />
      {children}
    </Menu.Item>
  </form>
);
