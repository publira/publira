"use client";

import { Menu } from "@base-ui/react/menu";
import { LogoutIcon, SettingsIcon, UserIcon } from "@publira/icons";
import { StatusChip } from "@publira/ui-components/badge";
import Link from "next/link";

export interface ConsoleUserMenuProps {
  accountHref: string;
  logoutAction: (formData: FormData) => void | Promise<void>;
  name: string;
  publicId: string;
  roleLabel: string;
}

const itemClassName =
  "flex w-full cursor-default items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-foreground outline-hidden select-none data-highlighted:bg-muted/70 data-highlighted:text-foreground";

const toInitial = (name: string): string | null => {
  const [initial] = [...name.trim()];

  return initial ? initial.toUpperCase() : null;
};

export const ConsoleUserMenu = ({
  accountHref,
  logoutAction,
  name,
  publicId,
  roleLabel,
}: ConsoleUserMenuProps) => {
  const initial = toInitial(name);

  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={`${name}のアカウントメニュー`}
        className="inline-flex size-9 items-center justify-center rounded-full border border-border/70 bg-card text-sm font-medium text-foreground transition-colors hover:border-border hover:bg-muted data-popup-open:bg-muted"
      >
        {initial ?? (
          <UserIcon aria-hidden="true" className="size-4 text-foreground" />
        )}
      </Menu.Trigger>

      <Menu.Portal>
        <Menu.Positioner
          align="end"
          className="z-40 outline-hidden"
          sideOffset={8}
        >
          <Menu.Popup className="w-64 max-w-[calc(100vw-2rem)] origin-[var(--transform-origin)] rounded-2xl border border-border bg-card p-1.5 text-card-foreground shadow-lg outline-hidden">
            <div className="grid justify-items-start gap-1 px-3 py-2">
              <p className="max-w-full truncate text-sm font-medium text-foreground">
                {name}
              </p>
              <p className="max-w-full truncate text-xs text-muted-foreground">
                {publicId}
              </p>
              <StatusChip status="info">{roleLabel}</StatusChip>
            </div>

            <Menu.Separator className="my-1.5 h-px bg-border/70" />

            <Menu.LinkItem
              className={itemClassName}
              closeOnClick
              render={<Link href={accountHref} />}
            >
              <SettingsIcon
                aria-hidden="true"
                className="size-4 text-muted-foreground"
              />
              アカウント設定
            </Menu.LinkItem>

            <form action={logoutAction}>
              {/* The item stays mounted through the submit: closing the menu on
                  click would unmount the form the Action is submitting. */}
              <Menu.Item
                className={itemClassName}
                closeOnClick={false}
                nativeButton
                render={<button aria-label="ログアウト" type="submit" />}
              >
                <LogoutIcon
                  aria-hidden="true"
                  className="size-4 text-muted-foreground"
                />
                ログアウト
              </Menu.Item>
            </form>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
};
