"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useEffectEvent, useState } from "react";

import { AdminHeader } from "./admin-header";
import { AdminSidebar } from "./admin-sidebar";

export interface AdminLayoutProps {
  children: ReactNode;
}

export const AdminLayout = ({ children }: AdminLayoutProps) => {
  const pathname = usePathname();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const closeMobileNav = useEffectEvent(() => {
    setMobileNavOpen(false);
  });
  const openMobileNav = useEffectEvent(() => {
    setMobileNavOpen(true);
  });

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  return (
    <div className="relative min-h-dvh bg-background text-foreground">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(15,124,130,0.12),transparent_28%),radial-gradient(circle_at_top_right,rgba(217,111,74,0.13),transparent_30%),linear-gradient(180deg,rgba(255,253,248,0.78),rgba(246,242,233,0.98))]"
      />

      <div className="relative flex min-h-dvh">
        <AdminSidebar
          mobileNavOpen={mobileNavOpen}
          onClose={closeMobileNav}
          pathname={pathname}
        />

        <div className="flex min-w-0 flex-1 flex-col lg:pl-0">
          <AdminHeader
            mobileNavOpen={mobileNavOpen}
            onOpenMobileNav={openMobileNav}
          />

          <main className="flex-1 overflow-x-hidden">{children}</main>
        </div>
      </div>
    </div>
  );
};
