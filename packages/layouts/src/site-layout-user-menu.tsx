"use client";

import { Menu } from "@base-ui/react/menu";
import { LogoutIcon, UserIcon } from "@publira/icons";
import Link from "next/link";
import type { ReactNode } from "react";

const itemClassName =
  "flex w-full cursor-default items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-foreground outline-hidden select-none data-highlighted:bg-muted/70 data-highlighted:text-foreground";

/** A compact account menu for a public site's header. */
export const SiteLayoutUserMenu = ({ children }: { children: ReactNode }) => (
  <Menu.Root>{children}</Menu.Root>
);

export const SiteLayoutUserMenuTrigger = ({
  ariaLabel,
}: {
  /** Already-resolved `aria-label` for the account menu trigger. */
  ariaLabel: string;
}) => (
  <Menu.Trigger
    aria-label={ariaLabel}
    className="inline-flex size-9 items-center justify-center rounded-full border border-border/70 bg-card text-foreground transition-colors hover:border-border hover:bg-muted data-popup-open:bg-muted"
  >
    <UserIcon aria-hidden="true" className="size-4" />
  </Menu.Trigger>
);

export const SiteLayoutUserMenuContent = ({
  children,
}: {
  children: ReactNode;
}) => (
  <Menu.Portal>
    <Menu.Positioner align="end" className="z-40 outline-hidden" sideOffset={8}>
      <Menu.Popup className="w-52 max-w-[calc(100vw-2rem)] origin-[var(--transform-origin)] rounded-2xl border border-border bg-card p-1.5 text-card-foreground shadow-lg outline-hidden">
        {children}
      </Menu.Popup>
    </Menu.Positioner>
  </Menu.Portal>
);

export const SiteLayoutUserMenuMyPageLink = ({
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
    <UserIcon aria-hidden="true" className="size-4 text-muted-foreground" />
    {children}
  </Menu.LinkItem>
);

export const SiteLayoutUserMenuSeparator = () => (
  <Menu.Separator className="my-1.5 h-px bg-border/70" />
);

export const SiteLayoutUserMenuLogout = ({
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
    {/* The item stays mounted through submit so its Server Action can run. */}
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
