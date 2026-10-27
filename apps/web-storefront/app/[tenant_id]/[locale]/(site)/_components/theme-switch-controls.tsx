"use client";

import { SunMoonIcon } from "@publira/icons/sun-moon-icon";
import * as SiteLayout from "@publira/layouts/site-layout";
import * as Popover from "@publira/ui-components/popover";

import { ClientMessage, useClientMessages } from "#components/client-message";
import type { StorefrontClientMessageKey } from "#lib/messages";
import {
  parseThemePreference,
  THEME_PREFERENCE_STORAGE_KEY,
  THEME_PREFERENCES,
} from "#lib/theme-preference";
import type { ThemePreference } from "#lib/theme-preference";
import { useWebStorage, writeWebStorage } from "#lib/web-storage";

const preferenceLabel: Record<ThemePreference, StorefrontClientMessageKey> = {
  dark: "storefront.nav.theme_dark",
  light: "storefront.nav.theme_light",
  system: "storefront.nav.theme_system",
};

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
          {THEME_PREFERENCES.map((option) => (
            <button
              aria-pressed={option === preference}
              className="rounded-control px-3 py-2 text-left text-sm text-muted-foreground transition-colors duration-state ease-state hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:outline-hidden aria-pressed:bg-muted aria-pressed:font-medium aria-pressed:text-foreground pointer-coarse:py-3"
              key={option}
              onClick={() => {
                choose(option);
              }}
              type="button"
            >
              {t(preferenceLabel[option])}
            </button>
          ))}
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
        {THEME_PREFERENCES.map((option) => (
          <button
            aria-pressed={option === preference}
            className="rounded-control px-3 py-2 text-left text-sm text-foreground transition-colors duration-state ease-state hover:bg-muted focus-visible:bg-muted focus-visible:outline-hidden aria-pressed:bg-muted aria-pressed:font-medium pointer-coarse:py-3"
            key={option}
            onClick={() => {
              choose(option);
            }}
            type="button"
          >
            <ClientMessage message={preferenceLabel[option]} />
          </button>
        ))}
      </SiteLayout.MobileNavigationDisclosurePanel>
    </SiteLayout.MobileNavigationDisclosure>
  );
};

export { ThemeSwitchDisclosure as Disclosure, ThemeSwitch as Root };
