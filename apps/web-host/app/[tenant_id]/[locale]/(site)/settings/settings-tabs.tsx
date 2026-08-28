"use client";

import { usePathname } from "next/navigation";

import { LocaleLink } from "#components/locale-link";
import { toBarePathname } from "#lib/locale-path";

const tabs = [
  { href: "/settings", id: "basic" },
  { href: "/settings/follows", id: "follows" },
  { href: "/settings/notifications", id: "notifications" },
  { href: "/settings/security", id: "security" },
] as const;

type TabId = (typeof tabs)[number]["id"];

const isTabActive = (pathname: string, href: string): boolean => {
  if (href === "/settings") {
    return pathname === "/settings";
  }
  return pathname.startsWith(href);
};

/**
 * The labels arrive resolved: the active tab is decided from the pathname, a
 * client-only value, so the copy cannot be a server-rendered node here.
 */
export const SettingsTabs = ({ labels }: { labels: Record<TabId, string> }) => {
  // The tabs compare against bare `/settings*` paths, so the tenant id and the
  // locale come off first: a prerendered shell reports the rewritten pathname
  // while the browser reports the public one, and only the bare form is the
  // same on both sides of hydration.
  const pathname = toBarePathname(usePathname());

  return (
    <nav className="flex gap-1 overflow-x-auto">
      {tabs.map((tab) => {
        const active = isTabActive(pathname, tab.href);

        return (
          <LocaleLink
            key={tab.id}
            href={tab.href}
            className={`border-b-2 px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors ${
              active
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {labels[tab.id]}
          </LocaleLink>
        );
      })}
    </nav>
  );
};
