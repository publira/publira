import { CollectionIcon, DashboardIcon, SettingsIcon } from "@publira/icons";
import type { NavSection } from "@publira/layouts/navigation";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "./message";
import type { AdminMessageKey } from "./message";

const navText = (message: AdminMessageKey, skeletonClassName: string) => (
  <Suspense fallback={<SkeletonLine className={skeletonClassName} />}>
    <Message message={message} />
  </Suspense>
);

export const navigation: NavSection[] = [
  {
    id: "operations",
    items: [
      {
        description: navText("admin.nav.dashboard_description", "h-3 w-40"),
        href: "/",
        icon: DashboardIcon,
        label: navText("admin.nav.dashboard_label", "h-4 w-24"),
      },
      {
        description: navText("admin.nav.labels_description", "h-3 w-32"),
        href: "/labels",
        icon: CollectionIcon,
        label: navText("admin.nav.labels_label", "h-4 w-16"),
      },
      {
        description: navText("admin.nav.creators_description", "h-3 w-32"),
        href: "/creators",
        icon: CollectionIcon,
        label: navText("admin.nav.creators_label", "h-4 w-12"),
      },
      {
        description: navText("admin.nav.series_description", "h-3 w-40"),
        href: "/series",
        icon: CollectionIcon,
        label: navText("admin.nav.series_label", "h-4 w-20"),
      },
      {
        description: navText("admin.nav.pages_description", "h-3 w-44"),
        href: "/pages",
        icon: CollectionIcon,
        label: navText("admin.nav.pages_label", "h-4 w-16"),
      },
      {
        description: navText("admin.nav.announcements_description", "h-3 w-40"),
        href: "/announcements",
        icon: CollectionIcon,
        label: navText("admin.nav.announcements_label", "h-4 w-20"),
      },
      {
        description: navText(
          "admin.nav.access_tickets_description",
          "h-3 w-44"
        ),
        href: "/access-tickets",
        icon: CollectionIcon,
        label: navText("admin.nav.access_tickets_label", "h-4 w-28"),
      },
    ],
    title: navText("admin.nav.operations", "h-3 w-12"),
  },
  {
    id: "administration",
    items: [
      {
        description: navText("admin.nav.audit_description", "h-3 w-36"),
        href: "/audit-logs",
        icon: CollectionIcon,
        label: navText("admin.nav.audit_label", "h-4 w-16"),
      },
      {
        description: navText("admin.nav.settings_description", "h-3 w-44"),
        href: "/settings",
        icon: SettingsIcon,
        label: navText("admin.nav.settings_label", "h-4 w-12"),
      },
    ],
    title: navText("admin.nav.administration", "h-3 w-12"),
  },
];
