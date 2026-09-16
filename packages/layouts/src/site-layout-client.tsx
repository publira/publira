"use client";

import { Collapsible } from "@base-ui/react/collapsible";
import { Drawer as BaseDrawer } from "@base-ui/react/drawer";
import { ChevronDownIcon, CloseIcon, MenuIcon } from "@publira/icons";
import { LinkButton } from "@publira/ui-components/button";
import Link from "next/link";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";

interface SiteMobileNavigationContextValue {
  close: () => void;
}

const SiteMobileNavigationContext =
  createContext<SiteMobileNavigationContextValue | null>(null);

const useSiteMobileNavigation = (): SiteMobileNavigationContextValue => {
  const value = useContext(SiteMobileNavigationContext);
  if (!value) {
    throw new Error(
      "Site mobile navigation slots must be rendered inside SiteLayout."
    );
  }
  return value;
};

/**
 * The shell, and the drawer the band opens below `md`.
 *
 * A phone band holds the brand, the account controls, and the menu button; the
 * catalog field, the navigation, the language, and the signed-out account
 * actions are inside the drawer. Every one of them navigates, and the layout
 * stays mounted across a navigation within the same locale, so each closes the
 * drawer on its way out — which is what the context here carries.
 */
export const SiteLayoutClient = ({ children }: { children: ReactNode }) => {
  const [open, setOpen] = useState(false);

  const close = useCallback(() => {
    setOpen(false);
  }, []);

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);
  }, []);

  const mobileNavigation = useMemo(() => ({ close }), [close]);

  return (
    <BaseDrawer.Root
      modal
      onOpenChange={handleOpenChange}
      open={open}
      swipeDirection="right"
    >
      <SiteMobileNavigationContext value={mobileNavigation}>
        <div className="flex min-h-dvh flex-col bg-background text-foreground">
          {children}
        </div>
      </SiteMobileNavigationContext>
    </BaseDrawer.Root>
  );
};

/**
 * The band's last control below `md`, and the only way to the four the band
 * stops drawing there.
 */
export const SiteLayoutMobileNavigationOpenButton = ({
  "aria-label": ariaLabel,
}: {
  /** Names the button that opens the navigation drawer. */
  "aria-label": string;
}) => (
  <BaseDrawer.Trigger
    aria-label={ariaLabel}
    className="inline-flex size-9 shrink-0 items-center justify-center rounded-control border border-input text-foreground transition-colors duration-state ease-state hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:hidden"
  >
    <MenuIcon className="size-5" />
  </BaseDrawer.Trigger>
);

export const SiteLayoutMobileNavigation = ({
  children,
}: {
  children: ReactNode;
}) => (
  <BaseDrawer.Portal>
    <BaseDrawer.Backdrop className="fixed inset-0 z-30 bg-foreground/20 md:hidden" />
    {/* Viewport is what Base UI binds swipe and touch scroll locking to. */}
    <BaseDrawer.Viewport className="fixed inset-0 z-40 md:hidden">
      <BaseDrawer.Popup className="fixed inset-y-0 right-0 z-40 flex w-72 max-w-[86vw] flex-col gap-6 overflow-y-auto border-l border-border bg-surface px-4 py-4 shadow-floating md:hidden">
        {children}
      </BaseDrawer.Popup>
    </BaseDrawer.Viewport>
  </BaseDrawer.Portal>
);

export const SiteLayoutMobileNavigationHeader = ({
  children,
}: {
  children: ReactNode;
}) => <div className="flex items-center justify-between gap-4">{children}</div>;

export const SiteLayoutMobileNavigationTitle = ({
  children,
}: {
  children: ReactNode;
}) => (
  <BaseDrawer.Title className="font-serif text-base font-medium text-foreground">
    {children}
  </BaseDrawer.Title>
);

export const SiteLayoutMobileNavigationCloseButton = ({
  "aria-label": ariaLabel,
}: {
  /** Names the button that closes the navigation drawer. */
  "aria-label": string;
}) => (
  <BaseDrawer.Close
    aria-label={ariaLabel}
    className="inline-flex size-9 shrink-0 items-center justify-center rounded-control border border-input text-muted-foreground transition-colors duration-state ease-state hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
  >
    <CloseIcon className="size-4" />
  </BaseDrawer.Close>
);

/**
 * The catalog field inside the drawer. Submitting it is a navigation to the
 * results, which the drawer would otherwise stay open over, so the submit
 * closes it — the event reaches here because a submit bubbles.
 */
export const SiteLayoutMobileNavigationSearch = ({
  children,
}: {
  children: ReactNode;
}) => {
  const { close } = useSiteMobileNavigation();

  return <div onSubmit={close}>{children}</div>;
};

/**
 * The drawer's link list. It takes no name of its own: the region is inside a
 * dialog the title names, and a name here would be a string the caller has to
 * resolve before the list — a static structure — could be drawn at all.
 */
export const SiteLayoutMobileNavigationLinks = ({
  children,
}: {
  children: ReactNode;
}) => <nav className="grid gap-1">{children}</nav>;

/**
 * A row of the drawer that holds rows of its own behind it.
 *
 * The drawer is already a panel, so a choice offered from inside it cannot be
 * a second panel floating over the first. It collapses into the drawer
 * instead: one row until the reader asks for it, and the options underneath
 * the row that asked.
 */
export const SiteLayoutMobileNavigationDisclosure = ({
  children,
}: {
  children: ReactNode;
}) => <Collapsible.Root className="grid gap-1">{children}</Collapsible.Root>;

/**
 * The one row the disclosure occupies while closed. It reads as the rows
 * beside it and adds the caret that says there is more behind it.
 */
export const SiteLayoutMobileNavigationDisclosureTrigger = ({
  children,
}: {
  children: ReactNode;
}) => (
  <Collapsible.Trigger className="group flex w-full items-center justify-between gap-2 rounded-control px-3 py-2 text-left text-sm text-foreground transition-colors duration-state ease-state hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none data-panel-open:bg-muted">
    {children}
    <ChevronDownIcon
      aria-hidden="true"
      className="size-4 shrink-0 text-muted-foreground transition-transform duration-state ease-state group-data-panel-open:rotate-180 motion-reduce:transition-none"
    />
  </Collapsible.Trigger>
);

/**
 * What the trigger opens onto, at the height Base UI measures for it, with the
 * rows indented so they read as belonging to the row above. The grid is the
 * element inside the panel rather than the panel itself, which keeps the panel
 * free of a `display` that would outrank the `hidden` Base UI sets on it while
 * it is closed.
 */
export const SiteLayoutMobileNavigationDisclosurePanel = ({
  children,
}: {
  children: ReactNode;
}) => (
  <Collapsible.Panel className="h-[var(--collapsible-panel-height)] overflow-hidden transition-[height] duration-state ease-state data-ending-style:h-0 data-starting-style:h-0 motion-reduce:transition-none">
    <div className="grid gap-1 pl-3">{children}</div>
  </Collapsible.Panel>
);

export const SiteLayoutMobileNavigationLink = ({
  children,
  current = false,
  href,
  hrefLang,
  lang,
}: {
  children: ReactNode;
  /** Whether this link is the one in effect: the page being read, or the locale being served. */
  current?: boolean;
  href: string;
  /** The language behind the link, where it is not the language of the page. */
  hrefLang?: string;
  /** The language the label itself is written in, where it is not the page's. */
  lang?: string;
}) => {
  const { close } = useSiteMobileNavigation();

  return (
    <Link
      aria-current={current ? "true" : undefined}
      className="rounded-control px-3 py-2 text-sm text-foreground transition-colors duration-state ease-state hover:bg-muted focus-visible:bg-muted focus-visible:outline-hidden aria-[current=true]:bg-muted aria-[current=true]:font-medium"
      href={href}
      hrefLang={hrefLang}
      lang={lang}
      onClick={close}
    >
      {children}
    </Link>
  );
};

/** The account actions, at the foot of the drawer and the width of it. */
export const SiteLayoutMobileNavigationActions = ({
  children,
}: {
  children: ReactNode;
}) => <div className="mt-auto grid gap-2">{children}</div>;

export const SiteLayoutMobileNavigationPrimaryAction = ({
  children,
  href,
}: {
  children: ReactNode;
  href: string;
}) => {
  const { close } = useSiteMobileNavigation();

  return (
    <LinkButton
      className="w-full"
      onClick={close}
      render={<Link href={href} />}
      variant="ink"
    >
      {children}
    </LinkButton>
  );
};

export const SiteLayoutMobileNavigationSecondaryAction = ({
  children,
  href,
}: {
  children: ReactNode;
  href: string;
}) => {
  const { close } = useSiteMobileNavigation();

  return (
    <LinkButton
      className="w-full"
      onClick={close}
      render={<Link href={href} />}
      variant="outline"
    >
      {children}
    </LinkButton>
  );
};
