"use client";

import { Drawer as BaseDrawer } from "@base-ui/react/drawer";
import { CloseIcon, MenuIcon } from "@publira/icons";
import { cn } from "@publira/utils";
import { useCallback, useState } from "react";
import type { ReactNode } from "react";

const DEFAULT_GRADIENT =
  "bg-[radial-gradient(circle_at_top_left,rgba(15,124,130,0.12),transparent_28%),radial-gradient(circle_at_top_right,rgba(217,111,74,0.13),transparent_30%),linear-gradient(180deg,rgba(255,253,248,0.78),rgba(246,242,233,0.98))]";

export interface ConsoleLayoutClientProps {
  children: ReactNode;
  gradient?: string;
}

export const ConsoleLayoutClient = ({
  children,
  gradient = DEFAULT_GRADIENT,
}: ConsoleLayoutClientProps) => {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const onCloseMobileNav = useCallback(() => {
    setMobileNavOpen(false);
  }, []);

  const onOpenMobileNav = useCallback(() => {
    setMobileNavOpen(true);
  }, []);

  const handleOpenChange = useCallback((open: boolean) => {
    setMobileNavOpen(open);
  }, []);

  return (
    <BaseDrawer.Root modal open={mobileNavOpen} onOpenChange={handleOpenChange}>
      <div className="relative min-h-dvh bg-background text-foreground">
        <div
          aria-hidden="true"
          className={cn("pointer-events-none absolute inset-0", gradient)}
        />
        <div className="relative flex min-h-dvh">{children}</div>
      </div>

      <BaseDrawer.Portal>
        <BaseDrawer.Backdrop className="fixed inset-0 z-30 bg-foreground/20 backdrop-blur-xs lg:hidden" />
        <BaseDrawer.Popup className="fixed inset-y-0 left-0 z-40 flex w-74 max-w-[86vw] flex-col border-r border-border/70 bg-card/95 px-4 py-4 shadow-2xl backdrop-blur lg:hidden">
          <button
            aria-label="ナビゲーションを閉じる"
            className="inline-flex size-10 items-center justify-center rounded-md border border-border/70 text-muted-foreground transition-colors hover:border-border hover:bg-muted/60 hover:text-foreground"
            onClick={onCloseMobileNav}
            type="button"
          >
            <CloseIcon className="size-4" />
          </button>
        </BaseDrawer.Popup>
      </BaseDrawer.Portal>

      <button
        aria-label="ナビゲーションを開く"
        className="fixed right-4 bottom-4 z-50 inline-flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground lg:hidden"
        onClick={onOpenMobileNav}
        type="button"
      >
        <MenuIcon className="size-5" />
      </button>
    </BaseDrawer.Root>
  );
};
