"use client";

import { Drawer as BaseDrawer } from "@base-ui/react/drawer";
import { CloseIcon, MenuIcon } from "@publira/icons";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  createContext,
  Suspense,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";

import { isCurrentPath, toConsolePathname } from "../navigation";

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
    <BaseDrawer.Backdrop className="fixed inset-0 z-30 bg-foreground/20 lg:hidden" />
    <BaseDrawer.Popup className="fixed inset-y-0 left-0 z-40 flex w-60 max-w-[86vw] flex-col border-r border-border bg-surface px-3 py-4 shadow-floating lg:hidden">
      {children}
    </BaseDrawer.Popup>
  </BaseDrawer.Portal>
);

export const ConsoleMobileNavigationCloseButton = ({
  "aria-label": ariaLabel,
}: {
  /** Names the button that closes the mobile navigation drawer. */
  "aria-label": string;
}) => {
  const { close } = useConsoleMobileNavigation();

  return (
    <button
      aria-label={ariaLabel}
      className="inline-flex size-9 items-center justify-center rounded-control border border-input text-muted-foreground transition-colors duration-state ease-state hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      onClick={close}
      type="button"
    >
      <CloseIcon className="size-4" />
    </button>
  );
};

export const ConsoleMobileNavigationOpenButton = ({
  "aria-label": ariaLabel,
}: {
  /** Names the button that opens the mobile navigation drawer. */
  "aria-label": string;
}) => {
  const { open } = useConsoleMobileNavigation();

  return (
    <button
      aria-label={ariaLabel}
      className="fixed right-4 bottom-4 z-50 inline-flex size-11 items-center justify-center rounded-control bg-primary text-primary-foreground shadow-floating focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none lg:hidden"
      onClick={open}
      type="button"
    >
      <MenuIcon className="size-5" />
    </button>
  );
};

/**
 * Every href the surrounding navigation offers, so an item can tell whether a
 * more specific sibling has claimed the current path — `/tenants` stays
 * inactive on `/tenants/new`. An item rendered outside a
 * {@link ConsoleSidebarNavigation} sees none and falls back to matching its own
 * prefix.
 */
const ConsoleNavigationHrefsContext = createContext<readonly string[]>([]);

export const ConsoleSidebarNavigation = ({
  children,
  hrefs,
}: {
  children: ReactNode;
  /** `navigationHrefs(sections)` from `@publira/layouts/navigation`. */
  hrefs: readonly string[];
}) => (
  <ConsoleNavigationHrefsContext value={hrefs}>
    <nav className="mt-6 flex-1 overflow-y-auto">
      <div className="grid gap-6">{children}</div>
    </nav>
  </ConsoleNavigationHrefsContext>
);

const ConsoleSidebarNavigationLink = ({
  children,
  current,
  href,
}: {
  children: ReactNode;
  current: boolean;
  href: string;
}) => (
  <Link
    aria-current={current ? "page" : undefined}
    className="group flex items-center gap-2 border-l-[3px] border-transparent py-2 pr-3 pl-[calc(0.75rem-3px)] text-sm text-foreground transition-colors duration-state ease-state hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-[current=page]:border-primary aria-[current=page]:bg-accent aria-[current=page]:text-accent-foreground"
    href={href}
  >
    {children}
  </Link>
);

/**
 * The console shell cannot read the URL it is serving, so which item is current
 * is decided in the browser, from `usePathname()` normalised through
 * {@link toConsolePathname} — which erases the tenant id `web-admin`'s proxy
 * rewrites in, so the answer does not change when the shell hydrates.
 */
const ConsoleSidebarNavigationCurrentLink = ({
  children,
  href,
}: {
  children: ReactNode;
  href: string;
}) => {
  const hrefs = useContext(ConsoleNavigationHrefsContext);
  const current = isCurrentPath(toConsolePathname(usePathname()), href, hrefs);

  return (
    <ConsoleSidebarNavigationLink current={current} href={href}>
      {children}
    </ConsoleSidebarNavigationLink>
  );
};

/**
 * One row of the sidebar: an icon and a label, with the current page marked by
 * a rule down its left edge and the accent wash. `aria-current` is what carries
 * that state — it names the page for a screen reader, and the icon and the row
 * style themselves off it.
 *
 * The row itself is the fallback of its own boundary, so a console prerenders
 * with its navigation already drawn and only the mark on the current item
 * streams in: reading the pathname is URL data, which would otherwise keep the
 * whole shell out of the static prerender.
 */
export const ConsoleSidebarNavigationItem = ({
  children,
  href,
}: {
  children: ReactNode;
  href: string;
}) => (
  <Suspense
    fallback={
      <ConsoleSidebarNavigationLink current={false} href={href}>
        {children}
      </ConsoleSidebarNavigationLink>
    }
  >
    <ConsoleSidebarNavigationCurrentLink href={href}>
      {children}
    </ConsoleSidebarNavigationCurrentLink>
  </Suspense>
);

export const ConsoleLayoutClient = ({ children }: { children: ReactNode }) => {
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
        <div className="flex min-h-dvh bg-background text-foreground">
          {children}
        </div>
      </ConsoleMobileNavigationContext>
    </BaseDrawer.Root>
  );
};
