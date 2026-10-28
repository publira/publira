"use client";

import { SunMoonIcon } from "@publira/icons/sun-moon-icon";
import * as SiteLayout from "@publira/layouts/site-layout";
import * as Popover from "@publira/ui-components/popover";
import type { ReactNode } from "react";

import { ClientMessage, useClientMessages } from "#components/client-message";
import {
  parseThemePreference,
  THEME_PREFERENCE_STORAGE_KEY,
} from "#lib/theme-preference";
import type { ThemePreference } from "#lib/theme-preference";
import { useWebStorage, writeWebStorage } from "#lib/web-storage";

/**
 * Stores a choice. `<DocumentTheme>` subscribes to the same key, so storing it
 * is what repaints the page.
 */
const choose = (preference: ThemePreference) => {
  writeWebStorage("local", THEME_PREFERENCE_STORAGE_KEY, preference);
};

/**
 * The stored choice. The server render and hydration answer `system`, and the
 * stored choice replaces it right after: only which option is marked can
 * change, and the options are out of sight until the switch is opened.
 */
const useThemePreference = (): ThemePreference =>
  parseThemePreference(useWebStorage("local", THEME_PREFERENCE_STORAGE_KEY));

interface ThemeSwitchOptionProps {
  children: ReactNode;
  /** The choice in effect, which this option is marked against. */
  current: ThemePreference;
  preference: ThemePreference;
}

/** One choice in the header's popover. */
const ThemeSwitchOption = ({
  children,
  current,
  preference,
}: ThemeSwitchOptionProps) => (
  <button
    aria-pressed={preference === current}
    className="rounded-control px-3 py-2 text-left text-sm text-muted-foreground transition-colors duration-state ease-state hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:outline-hidden aria-pressed:bg-muted aria-pressed:font-medium aria-pressed:text-foreground pointer-coarse:py-3"
    onClick={() => {
      choose(preference);
    }}
    type="button"
  >
    {children}
  </button>
);

/** One choice among the drawer's rows, drawn as the rows beside it are. */
const ThemeSwitchDisclosureOption = ({
  children,
  current,
  preference,
}: ThemeSwitchOptionProps) => (
  <button
    aria-pressed={preference === current}
    className="rounded-control px-3 py-2 text-left text-sm text-foreground transition-colors duration-state ease-state hover:bg-muted focus-visible:bg-muted focus-visible:outline-hidden aria-pressed:bg-muted aria-pressed:font-medium pointer-coarse:py-3"
    onClick={() => {
      choose(preference);
    }}
    type="button"
  >
    {children}
  </button>
);

/**
 * Header control for light, dark, or the system setting, beside the locale
 * switcher and drawn the way it is. A choice repaints the page in place, so
 * the popover stays open on it.
 */
const ThemeSwitch = () => {
  const preference = useThemePreference();
  const t = useClientMessages();
  const label = t("storefront.nav.theme_switch");

  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label={label}
        className="inline-flex size-9 items-center justify-center rounded-control border border-input bg-card text-foreground transition-colors duration-state ease-state hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none data-popup-open:bg-muted pointer-coarse:size-11"
      >
        <SunMoonIcon aria-hidden="true" className="size-5" />
      </Popover.Trigger>
      <Popover.Content align="end" className="w-56" sideOffset={8}>
        <Popover.Title className="px-2 py-1.5 text-sm font-medium text-foreground">
          {label}
        </Popover.Title>
        <div className="grid gap-0.5">
          <ThemeSwitchOption current={preference} preference="light">
            {t("storefront.nav.theme_light")}
          </ThemeSwitchOption>
          <ThemeSwitchOption current={preference} preference="dark">
            {t("storefront.nav.theme_dark")}
          </ThemeSwitchOption>
          <ThemeSwitchOption current={preference} preference="system">
            {t("storefront.nav.theme_system")}
          </ThemeSwitchOption>
        </div>
      </Popover.Content>
    </Popover.Root>
  );
};

/**
 * The same choice {@link ThemeSwitch} offers, as rows behind one row of the
 * phone header's drawer, the way the locale switcher sits there. A choice
 * keeps the drawer open: the page behind it is what changed.
 */
const ThemeSwitchDisclosure = () => {
  const preference = useThemePreference();

  return (
    <SiteLayout.MobileNavigationDisclosure>
      <SiteLayout.MobileNavigationDisclosureTrigger>
        <ClientMessage message="storefront.nav.theme_switch" />
      </SiteLayout.MobileNavigationDisclosureTrigger>
      <SiteLayout.MobileNavigationDisclosurePanel>
        <ThemeSwitchDisclosureOption current={preference} preference="light">
          <ClientMessage message="storefront.nav.theme_light" />
        </ThemeSwitchDisclosureOption>
        <ThemeSwitchDisclosureOption current={preference} preference="dark">
          <ClientMessage message="storefront.nav.theme_dark" />
        </ThemeSwitchDisclosureOption>
        <ThemeSwitchDisclosureOption current={preference} preference="system">
          <ClientMessage message="storefront.nav.theme_system" />
        </ThemeSwitchDisclosureOption>
      </SiteLayout.MobileNavigationDisclosurePanel>
    </SiteLayout.MobileNavigationDisclosure>
  );
};

export { ThemeSwitchDisclosure as Disclosure, ThemeSwitch as Root };
