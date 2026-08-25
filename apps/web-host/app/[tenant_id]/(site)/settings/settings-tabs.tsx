"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { href: "/settings", id: "basic", label: "基本設定" },
  { href: "/settings/follows", id: "follows", label: "フォロー" },
  { href: "/settings/notifications", id: "notifications", label: "通知" },
  { href: "/settings/security", id: "security", label: "セキュリティ" },
];

const isTabActive = (pathname: string, href: string): boolean => {
  if (href === "/settings") {
    return pathname === "/settings";
  }
  return pathname.startsWith(href);
};

export const SettingsTabs = () => {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 overflow-x-auto">
      {tabs.map((tab) => {
        const active = isTabActive(pathname, tab.href);

        return (
          <Link
            key={tab.id}
            href={tab.href}
            className={`border-b-2 px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors ${
              active
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
};
