"use client";

import { Drawer as BaseDrawer } from "@base-ui/react/drawer";
import { CloseIcon, MenuIcon } from "@publira/icons";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";

import { consoleBackgroundClassName } from "./console-theme";
import type { ConsoleTheme } from "./console-theme";

export interface ConsoleLayoutClientProps {
  children: ReactNode;
  theme: ConsoleTheme;
}

interface ConsoleMobileNavigationContextValue {
  close: () => void;
  open: () => void;
}

const ConsoleMobileNavigationContext =
  createContext<ConsoleMobileNavigationContextValue | null>(null);

const useConsoleMobileNavigation = (): ConsoleMobileNavigationContextValue => {
  const value = useContext(ConsoleMobileNavigationContext);
  if (!value) {
    throw new Error(
      "Console mobile navigation slots must be rendered inside ConsoleLayout."
    );
  }
  return value;
};

export const ConsoleMobileNavigation = ({
  children,
}: {
  children: ReactNode;
}) => (
  <BaseDrawer.Portal>
    <BaseDrawer.Backdrop className="fixed inset-0 z-30 bg-foreground/20 backdrop-blur-xs lg:hidden" />
    <BaseDrawer.Popup className="fixed inset-y-0 left-0 z-40 flex w-74 max-w-[86vw] flex-col border-r border-border/70 bg-card/95 px-4 py-4 shadow-2xl backdrop-blur lg:hidden">
      {children}
    </BaseDrawer.Popup>
  </BaseDrawer.Portal>
);

export const ConsoleMobileNavigationCloseButton = ({
  ariaLabel,
}: {
  ariaLabel: string;
}) => {
  const { close } = useConsoleMobileNavigation();

  return (
    <button
      aria-label={ariaLabel}
      className="inline-flex size-10 items-center justify-center rounded-md border border-border/70 text-muted-foreground transition-colors hover:border-border hover:bg-muted/60 hover:text-foreground"
      onClick={close}
      type="button"
    >
      <CloseIcon className="size-4" />
    </button>
  );
};

export const ConsoleMobileNavigationOpenButton = ({
  ariaLabel,
}: {
  ariaLabel: string;
}) => {
  const { open } = useConsoleMobileNavigation();

  return (
    <button
      aria-label={ariaLabel}
      className="fixed right-4 bottom-4 z-50 inline-flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground lg:hidden"
      onClick={open}
      type="button"
    >
      <MenuIcon className="size-5" />
    </button>
  );
};

export const ConsoleLayoutClient = ({
  children,
  theme,
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

  const mobileNavigation = useMemo(
    () => ({ close: onCloseMobileNav, open: onOpenMobileNav }),
    [onCloseMobileNav, onOpenMobileNav]
  );

  return (
    <BaseDrawer.Root modal open={mobileNavOpen} onOpenChange={handleOpenChange}>
      <ConsoleMobileNavigationContext value={mobileNavigation}>
        <div className="relative min-h-dvh bg-background text-foreground">
          <div
            aria-hidden="true"
            className={consoleBackgroundClassName}
            data-console-theme={theme}
          />
          <div className="relative flex min-h-dvh">{children}</div>
        </div>
      </ConsoleMobileNavigationContext>
    </BaseDrawer.Root>
  );
};
